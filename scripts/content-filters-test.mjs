// Tests for the Content filter parser -- PRD v0.5 §2.1's core promise:
// a filter state is a declarative set, so parameter order, comma order,
// duplicates, and junk must never change the parsed state.
//   npm run test:filters
const F = await import("../src/lib/contentFilters.ts");

let pass = 0,
  fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

const NOW = new Date("2026-08-07T10:00:00Z"); // 14:00 Dubai, a Friday

/* ---- Order-independence: the headline guarantee ------------------------- */
{
  // The same constraints as URL strings in shuffled parameter orders AND
  // shuffled comma orders. Every permutation must parse identically.
  const urls = [
    "client=a,b&person=x,y&platform=youtube&from=2026-08-01&to=2026-08-14&status=published&q=hi",
    "q=hi&status=published&to=2026-08-14&from=2026-08-01&platform=youtube&person=y,x&client=b,a",
    "person=x,y&client=b,a&q=hi&from=2026-08-01&platform=youtube&status=published&to=2026-08-14",
    "to=2026-08-14&client=a,b&status=published&person=y,x&q=hi&platform=youtube&from=2026-08-01",
    // Duplicates and empty segments are noise, not meaning.
    "client=a,b,a,,b&person=,y,x,x&platform=youtube&from=2026-08-01&to=2026-08-14&status=published&q=hi",
  ];
  const states = urls.map((u) =>
    JSON.stringify(F.parseFilters(Object.fromEntries(new URLSearchParams(u)), NOW)),
  );
  check("every permutation parses to the identical state",
    states.every((s) => s === states[0]));
  check("id lists are normalised (sorted, deduped)",
    JSON.parse(states[0]).clientIds.join(",") === "a,b" &&
      JSON.parse(states[0]).personIds.join(",") === "x,y");
}

/* ---- Malformed input degrades to unset, never throws -------------------- */
{
  const s = F.parseFilters(
    { from: "garbage", to: "2026-02-31", status: "hacked", period: "NaN", q: "  " },
    NOW,
  );
  check("garbage from is unset", s.from === null);
  check("impossible calendar date is unset", s.to === null);
  check("unknown status is unset", s.status === null);
  check("whitespace q is unset", s.q === null);
  check("nothing threw", true);
}

/* ---- Inverted range swaps rather than matching nothing ------------------ */
{
  const s = F.parseFilters({ from: "2026-08-14", to: "2026-08-01" }, NOW);
  check("inverted range swaps", s.from === "2026-08-01" && s.to === "2026-08-14");
}

/* ---- Legacy period= links keep working ---------------------------------- */
{
  const s = F.parseFilters({ period: "30" }, NOW);
  check("period=30 becomes an open-ended from 30 days back",
    s.from === "2026-07-08" && s.to === null, `from=${s.from}`);
  const explicit = F.parseFilters({ period: "30", from: "2026-08-01" }, NOW);
  check("explicit from beats the legacy shim", explicit.from === "2026-08-01");
}

/* ---- Presets ------------------------------------------------------------ */
{
  const today = F.rangeForPreset("today", NOW);
  check("today preset", today.from === "2026-08-07" && today.to === "2026-08-07");
  const d7 = F.rangeForPreset("7d", NOW);
  check("last 7 days is 7 inclusive days", d7.from === "2026-08-01" && d7.to === "2026-08-07");
  const d14 = F.rangeForPreset("14d", NOW);
  check("last 2 weeks is 14 inclusive days", d14.from === "2026-07-25" && d14.to === "2026-08-07");
  const wk = F.rangeForPreset("week", NOW);
  check("this week starts Monday Dubai", wk.from === "2026-08-03" && wk.to === "2026-08-07");
  const mo = F.rangeForPreset("month", NOW);
  check("this month starts on the 1st", mo.from === "2026-08-01" && mo.to === "2026-08-07");
  const lm = F.rangeForPreset("lastmonth", NOW);
  check("last month is the full previous month",
    lm.from === "2026-07-01" && lm.to === "2026-07-31");
  check("all is open on both sides",
    F.rangeForPreset("all", NOW).from === null && F.rangeForPreset("all", NOW).to === null);
}

/* ---- Round trip: presetForRange recognises its own output ---------------- */
{
  for (const p of ["today", "7d", "14d", "week", "month", "lastmonth", "all"]) {
    const r = F.rangeForPreset(p, NOW);
    const recognised = F.presetForRange(r.from, r.to, NOW);
    // Two presets can legitimately describe the same span (on Aug 7, "this
    // month" IS "last 7 days"); the guarantee is that the recognised preset
    // maps back to the same range, not that names survive the round trip.
    const rr = recognised === "custom" ? null : F.rangeForPreset(recognised, NOW);
    check(`round trip: ${p}`, !!rr && rr.from === r.from && rr.to === r.to,
      `${p} -> ${recognised}`);
  }
  check("an arbitrary span reads as custom",
    F.presetForRange("2026-01-03", "2026-02-11", NOW) === "custom");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
