// Reading typed analytics figures, and noticing when they disagree.
//
// Almost every number in a client report is typed by a person copying from a
// platform dashboard, because Instagram publishes no account-level export and
// never will. So the entry layer IS the data quality layer, and each check
// below exists because of a real discrepancy in a report already sent to a
// paying client.
//
// The governing rule: these are WARNINGS. In every real case the right
// response was a person looking at the source again -- never the software
// reconciling the numbers, which would mean inventing one of them.
const P = await import("../src/lib/periodFields.ts");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const has = (ws, field) => ws.some((w) => w.field === field);

/* -- Reading what people actually paste ------------------------------------ */

eq("a plain number", P.readEntry("506590").value, 506590);
eq("thousands separators are fine", P.readEntry("506,590").value, 506590);
eq("so are spaces", P.readEntry("506 590").value, 506590);
eq("surrounding whitespace is trimmed", P.readEntry("  1234  ").value, 1234);
eq("a negative net change is allowed", P.readEntry("-618").value, -618);

// THE DISTINCTION THAT MUST NOT BE LOST. The live report prints "Bio link taps
// 0" because a zero is information the client asked for; a blank is the
// absence of information. Coalescing them would put a fabricated 0 in a report.
eq("blank is null, meaning no source this cycle", P.readEntry("").value, null);
eq("whitespace only is also null", P.readEntry("   ").value, null);
eq("but a typed zero is zero", P.readEntry("0").value, 0);

{
  // "11.4K" is a legitimate thing to copy off TikTok. Expanding it is right;
  // expanding it silently is not.
  const k = P.readEntry("11.4K");
  eq("a K suffix expands", k.value, 11400);
  check("and says so", /Shown as "11.4K" — stored as 11,400/.test(k.note ?? ""), k.note);
  eq("an M suffix expands", P.readEntry("2.1M").value, 2100000);
  eq("lower case works too", P.readEntry("280.8k").value, 280800);
}

{
  const bad = P.readEntry("about 500");
  eq("prose is refused rather than guessed at", bad.value, null);
  check("and says what it saw", /not a number/.test(bad.note ?? ""), bad.note);
}

/* -- The check that came from the live report ------------------------------ */

{
  // Entree's real figures: 828 follows, 195 unfollows, +618 net. 828-195=633.
  const w = P.checkPeriod("instagram", { follows: 828, unfollows: 195, net_followers: 618 });
  check("the live 828/195/618 mismatch is flagged", has(w, "net_followers"), JSON.stringify(w));
  check("and the gap is stated", /gap of 15/.test(w.find((x) => x.field === "net_followers").message), "");
  // Reconciling would mean choosing which of Instagram's three numbers to
  // overwrite, and there is no way to know which one is wrong.
  check("all three are kept as entered", /kept as entered/.test(w[0].message), "");
}

eq("figures that do reconcile are silent",
  P.checkPeriod("instagram", { follows: 800, unfollows: 200, net_followers: 600 }).length, 0);

eq("a missing piece means no comparison, not a warning",
  P.checkPeriod("instagram", { follows: 828, net_followers: 618 }).length, 0);

/* -- Swapped and impossible figures ---------------------------------------- */

check("reach above views is flagged as a likely swap",
  has(P.checkPeriod("instagram", { reach: 247103, views: 100000 }), "reach"), "");

eq("reach below views is normal",
  P.checkPeriod("instagram", { reach: 247103, views: 506590 }).length, 0);

check("a net change larger than the total is flagged",
  has(P.checkPeriod("tiktok", { followers: 2446, net_followers: 90000 }), "net_followers"), "");

eq("a plausible net change is silent",
  P.checkPeriod("tiktok", { followers: 2446, net_followers: 881 }).length, 0);

check("a negative view count is refused",
  has(P.checkPeriod("tiktok", { views: -5 }), "views"), "");

// Net change is the one field that legitimately goes below zero.
eq("a negative net change is not flagged as impossible",
  P.checkPeriod("tiktok", { net_followers: -200 }).length, 0);

/* -- Percentage breakdowns -------------------------------------------------- */

// Both of these are real and both are FINE -- rounding, not error. They should
// still be visible.
eq("Instagram's real 99.3% age split is within tolerance",
  P.checkBreakdown("follower_age", [
    { label: "35-44", value: 35.2 }, { label: "25-34", value: 30.1 },
    { label: "45-54", value: 19.8 }, { label: "55-64", value: 6.8 },
    { label: "18-24", value: 5.2 },  { label: "65+", value: 2.2 },
  ]), null);

eq("TikTok's real 99% gender split is within tolerance",
  P.checkBreakdown("follower_gender", [{ label: "Male", value: 45 }, { label: "Female", value: 54 }]), null);

check("a genuinely missing row is flagged",
  P.checkBreakdown("traffic_source", [{ label: "For You", value: 60 }]) !== null, "");

check("and the actual sum is stated",
  /add up to 60.0%/.test(P.checkBreakdown("traffic_source", [{ label: "For You", value: 60 }]).message), "");

eq("an empty breakdown is not an error -- it means not exported this cycle",
  P.checkBreakdown("follower_age", []), null);

eq("a ranked list with no values is ordering only, not a broken sum",
  P.checkBreakdown("follower_active_days", [{ label: "Sunday", value: null }, { label: "Monday", value: null }]), null);

/* -- The field manifest ------------------------------------------------------ */

{
  const ig = P.fieldsFor("instagram").map((f) => f.key);
  const yt = P.fieldsFor("youtube").map((f) => f.key);
  // The two words are not interchangeable and the reports keep them apart.
  check("Instagram is asked for followers, not subscribers",
    ig.includes("followers") && !ig.includes("subscribers"), ig.join(","));
  check("YouTube is asked for subscribers, not followers",
    yt.includes("subscribers") && !yt.includes("followers"), yt.join(","));
  // Instagram's own combined figure; TikTok has no equivalent to ask for.
  check("only Instagram is asked for its own interactions figure",
    ig.includes("interactions") && !P.fieldsFor("tiktok").map((f) => f.key).includes("interactions"), "");
  check("every platform is asked for views", P.fieldsFor("tiktok").some((f) => f.key === "views"), "");
}

{
  const level = P.PERIOD_FIELDS.filter((f) => f.kind === "level").map((f) => f.key).sort().join(",");
  // A level is a reading at a moment; summing a series of them is nonsense,
  // and this is the list a future importer must never accumulate.
  eq("exactly the totals are levels; everything else is a flow", level, "followers,subscribers");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
