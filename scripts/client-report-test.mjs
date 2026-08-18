// Choosing the top videos of a period, and describing it honestly.
//
// Every rule here came from a document already sent to a paying client, so a
// wrong one is a wrong number in front of that client. Two are worth stating
// because both are counter-intuitive and both were verified against live data
// rather than assumed:
//
//   RANK BY GAIN, DISPLAY LIFETIME. A top-3 ranked on lifetime views gets
//   position 3 wrong on BOTH of Entree's platforms. Ranked on views gained
//   inside the period it reproduces the published order exactly.
//
//   SELECT BY ACTIVITY, NOT PUBLICATION. Entree's number 3 on both platforms
//   went out on 30 June -- before the month the report covers. Filtering on
//   publish date drops the video the report is partly about.
const C = await import("../src/lib/clientReport.ts");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const JULY = { start: "2026-07-01", end: "2026-07-31" };
const snap = (day, views) => ({ capturedAt: `${day}T09:00:00.000Z`, views });
const post = (o) => ({
  postId: o.postId,
  contentItemId: o.contentItemId ?? `item-${o.postId}`,
  platform: o.platform ?? "tiktok",
  title: o.title ?? o.postId,
  postedAtTs: o.postedAtTs ?? null,
  likes: o.likes ?? 0,
  snapshots: o.snapshots ?? [],
});

/* -- Ranking ---------------------------------------------------------------- */

{
  // THE CASE THAT MOTIVATED THE RULE. "big" has far more lifetime views, but
  // earned almost none of them this month; "riser" earned more inside the
  // period. Lifetime ranking puts them the wrong way round.
  const { top } = C.pickTopVideos(
    [
      post({ postId: "big",   snapshots: [snap("2026-06-30", 1_000_000), snap("2026-07-31", 1_010_000)] }),
      post({ postId: "riser", snapshots: [snap("2026-06-30", 5_000),     snap("2026-07-31", 205_000)] }),
    ],
    JULY,
  );
  eq("the video that GAINED most ranks first", top[0].postId, "riser");
  eq("and its gain is the measured difference", top[0].gained, 200_000);
  // The printed figure is still what the client sees on their own screen.
  eq("but the number shown is lifetime at period end", top[0].views, 205_000);
  eq("the bigger lifetime count ranks second", top[1].postId, "big");
  eq("with its own small gain", top[1].gained, 10_000);
}

{
  // Published 30 June, still climbing through July. Selecting on publish date
  // would drop it; this is Entree's real number 3 on both platforms.
  const { top } = C.pickTopVideos(
    [
      post({ postId: "june30", postedAtTs: "2026-06-30T18:00:00.000Z",
             snapshots: [snap("2026-06-30", 1_000), snap("2026-07-31", 90_000)] }),
      post({ postId: "july10", postedAtTs: "2026-07-10T12:00:00.000Z",
             snapshots: [snap("2026-07-31", 40_000)] }),
    ],
    JULY,
  );
  eq("a video published before the period still competes", top[0].postId, "june30");
  eq("counting only what it earned inside", top[0].gained, 89_000);
  eq("both are ranked", top.length, 2);
}

{
  // Published inside the period, so there is nothing before it by definition.
  // Its whole count was earned in the period -- measured, not a fallback.
  const { top } = C.pickTopVideos(
    [post({ postId: "new", postedAtTs: "2026-07-05T09:00:00.000Z", snapshots: [snap("2026-07-31", 12_000)] })],
    JULY,
  );
  eq("a video born in the period counts its whole life as gain", top[0].gained, 12_000);
  eq("and that is measured, not a fallback", top[0].basis, "measured");
}

{
  // Published the day before the period, so essentially its whole life ran
  // inside. Entree's real number 3 on BOTH platforms went out on 30 June and
  // the published report is right to include it.
  const { top } = C.pickTopVideos(
    [post({ postId: "jun30", postedAtTs: "2026-06-30T18:00:00.000Z", snapshots: [snap("2026-07-29", 13_180)] })],
    JULY,
  );
  eq("a video published just before the period may use lifetime", top[0].gained, 13_180);
  eq("and is marked so the preview can say so", top[0].basis, "lifetime");
}

{
  // THE ONE THAT PRODUCED A WRONG REPORT. Entree's 14 June Reel had reached
  // 2.49M by July with no pre-July reading. Letting lifetime stand in ranked
  // June's viral post as JULY's best video, above every video the month
  // actually produced. Lifetime is not this video's period gain; it is its
  // whole history, and there is no honest number to print.
  const { top, unmeasurable } = C.pickTopVideos(
    [
      post({ postId: "viral-june", postedAtTs: "2026-06-14T10:00:00.000Z", snapshots: [snap("2026-07-29", 2_493_679)] }),
      post({ postId: "real-july",  postedAtTs: "2026-07-08T10:00:00.000Z", snapshots: [snap("2026-07-29", 46_774)] }),
    ],
    JULY,
  );
  eq("a video published long before the period is not ranked on lifetime", top.length, 1);
  eq("the month's own video wins", top[0].postId, "real-july");
  eq("and the old one is reported, not silently dropped", unmeasurable[0].reason, "published-before-history");
}

{
  // No publish instant at all: we cannot tell how much of its life sat inside
  // the period, so it cannot be ranked on lifetime either.
  const { top, unmeasurable } = C.pickTopVideos(
    [post({ postId: "undated", postedAtTs: null, snapshots: [snap("2026-07-20", 8_000)] })],
    JULY,
  );
  eq("a post with no publish date is not ranked on lifetime", top.length, 0);
  eq("and says why", unmeasurable[0].reason, "published-before-history");
}

/* -- What must never be silently dropped ------------------------------------ */

{
  // Published 30 July, first measured 9 August. It was PUBLISHED in the
  // period, so its first reading is everything it earned since going out --
  // which begins inside the period. Dropping it produced empty reports for
  // every month before our snapshot history began, while real videos with
  // real numbers sat in the database.
  const { top, unmeasurable } = C.pickTopVideos(
    [
      post({ postId: "late", postedAtTs: "2026-07-30T20:00:00.000Z", snapshots: [snap("2026-08-09", 50_000)] }),
      post({ postId: "ok",   snapshots: [snap("2026-06-30", 0), snap("2026-07-31", 10)] }),
    ],
    JULY,
  );
  eq("a post published in the period is used even if measured later", top.length, 2);
  eq("and is labelled for what the figure actually is", top.find((t) => t.postId === "late").basis, "since-publication");
  eq("nothing is left unmeasurable", unmeasurable.length, 0);
  // THE TIER RULE. An estimate covers a longer window than a measured gain, so
  // it must not outrank one on the strength of a bigger number.
  eq("a measured row outranks an estimate despite a smaller figure", top[0].postId, "ok");
}

{
  // Published BEFORE the period and first measured after it: nothing here is
  // attributable to the period and there is no honest number to print.
  const { top, unmeasurable } = C.pickTopVideos(
    [post({ postId: "older", postedAtTs: "2026-05-01T10:00:00.000Z", snapshots: [snap("2026-08-09", 90_000)] })],
    JULY,
  );
  eq("a post published before the period is still not ranked", top.length, 0);
  eq("and says why", unmeasurable[0].reason, "no-reading-by-period-end");
}

{
  // The case that produced a blank June: our snapshot history starts
  // 2026-07-29, so every June video was first measured after June closed.
  const JUNE = { start: "2026-06-01", end: "2026-06-30" };
  const { top } = C.pickTopVideos(
    [
      post({ postId: "jun-a", postedAtTs: "2026-06-05T10:00:00.000Z", snapshots: [snap("2026-07-29", 82_085)] }),
      post({ postId: "jun-b", postedAtTs: "2026-06-18T10:00:00.000Z", snapshots: [snap("2026-07-29", 52_733)] }),
    ],
    JUNE,
  );
  eq("a month entirely before our history still produces a report", top.length, 2);
  eq("ordered by what they have earned", top[0].postId, "jun-a");
  eq("every row labelled as an estimate", top.every((t) => t.basis === "since-publication"), true);
}

{
  const { top, unmeasurable } = C.pickTopVideos([post({ postId: "never", snapshots: [] })], JULY);
  eq("a post with no readings at all is not ranked", top.length, 0);
  eq("and is reported separately", unmeasurable[0].reason, "no-readings-at-all");
}

{
  const { top } = C.pickTopVideos(
    [post({ postId: "nulls", snapshots: [{ capturedAt: "2026-07-31T09:00:00.000Z", views: null }] })],
    JULY,
  );
  eq("a null view count is not treated as zero views", top.length, 0);
}

/* -- Cross-posts stay apart -------------------------------------------------- */

{
  const { top } = C.pickTopVideos(
    [
      post({ postId: "tt", platform: "tiktok",    title: "same video", snapshots: [snap("2026-06-30", 0), snap("2026-07-31", 100)] }),
      post({ postId: "ig", platform: "instagram", title: "same video", snapshots: [snap("2026-06-30", 0), snap("2026-07-31", 90)] }),
    ],
    JULY,
  );
  // Two posts, two audiences. The app refuses to pool them anywhere else and
  // the report must not either.
  eq("a cross-post is two rows, never merged", top.length, 2);
  eq("each keeping its own platform", top.map((t) => t.platform).join(","), "tiktok,instagram");
}

/* -- Determinism and shape --------------------------------------------------- */

{
  const mk = () => [
    post({ postId: "b", snapshots: [snap("2026-06-30", 0), snap("2026-07-31", 100)] }),
    post({ postId: "a", snapshots: [snap("2026-06-30", 0), snap("2026-07-31", 100)] }),
  ];
  const one = C.pickTopVideos(mk(), JULY).top.map((t) => t.postId).join(",");
  const two = C.pickTopVideos(mk().reverse(), JULY).top.map((t) => t.postId).join(",");
  check("equal gains break ties the same way every time", one === two, `${one} vs ${two}`);
}

eq("the limit is honoured",
  C.pickTopVideos(
    ["a","b","c","d"].map((id, i) => post({ postId: id, snapshots: [snap("2026-06-30", 0), snap("2026-07-31", 100 - i)] })),
    JULY, 3,
  ).top.length, 3);

eq("no posts is not an error", C.pickTopVideos([], JULY).top.length, 0);

/* -- Blockers ---------------------------------------------------------------- */

{
  const b = C.reportBlockers({
    period: JULY,
    accounts: [{ handle: "entree_london", platform: "instagram", lastDiscoveredAt: "2026-07-20T00:00:00Z" }],
    confirmedHandles: ["entree_london"],
  });
  // Discovery decides which posts EXIST; stale discovery means missing videos,
  // and a report with a video missing looks complete.
  eq("discovery older than the period end blocks generation", b[0]?.code, "stale-discovery");
  check("and the message names the fix", /Run a sync/.test(b[0].message), b[0].message);
}

eq("discovery after the period end does not block",
  C.reportBlockers({
    period: JULY,
    accounts: [{ handle: "x", platform: "tiktok", lastDiscoveredAt: "2026-08-02T00:00:00Z" }],
    confirmedHandles: ["x"],
  }).length, 0);

eq("an account never discovered blocks",
  C.reportBlockers({
    period: JULY,
    accounts: [{ handle: "x", platform: "youtube", lastDiscoveredAt: null }],
    confirmedHandles: ["x"],
  })[0].code, "never-discovered");

eq("no confirmed period blocks",
  C.reportBlockers({ period: JULY, accounts: [], confirmedHandles: [] })[0].code, "no-confirmed-period");

/* -- Narrative --------------------------------------------------------------- */

eq("the sentence matches the live report's shape",
  C.platformNarrative({ platformLabel: "TikTok", views: 166690, likes: 20978, netFollowers: 1600,
    followerNoun: "followers", viewsDeltaPct: 140 }),
  "TikTok delivered exceptional performance this month, generating 166,690 views, gaining 1,600 new followers, and receiving 20,978 likes.");

eq("a platform with no follower figure simply omits that clause",
  C.platformNarrative({ platformLabel: "Instagram", views: 284900, likes: 18406, netFollowers: null,
    followerNoun: "followers", viewsDeltaPct: 30 }),
  "Instagram delivered strong performance this month, generating 284,900 views and receiving 18,406 likes.");

// A null is a gap in what we know. It must never render as "0 views", which is
// a different claim and a false one.
eq("a missing number is never printed as zero",
  C.platformNarrative({ platformLabel: "YouTube", views: null, likes: null, netFollowers: null,
    followerNoun: "subscribers", viewsDeltaPct: null }),
  "No YouTube figures were recorded for this period.");

eq("subscribers are called subscribers",
  C.platformNarrative({ platformLabel: "YouTube", views: 88200, likes: 3164, netFollowers: 1100,
    followerNoun: "subscribers", viewsDeltaPct: 10 }),
  "YouTube delivered improved performance this month, generating 88,200 views, gaining 1,100 new subscribers, and receiving 3,164 likes.");

// The word and the numbers can never disagree -- "exceptional" over a decline
// is what makes generated prose obviously generated.
check("a decline does not get an enthusiastic adjective",
  /notably quieter/.test(C.platformNarrative({ platformLabel: "Instagram", views: 100, likes: 1,
    netFollowers: null, followerNoun: "followers", viewsDeltaPct: -60 })), "ok");

check("a loss of followers is stated as a loss",
  /losing 200 followers/.test(C.platformNarrative({ platformLabel: "TikTok", views: 10, likes: 1,
    netFollowers: -200, followerNoun: "followers", viewsDeltaPct: 0 })), "ok");

check("with no prior period the language stays flat",
  /steady/.test(C.platformNarrative({ platformLabel: "TikTok", views: 10, likes: 1,
    netFollowers: null, followerNoun: "followers", viewsDeltaPct: null })), "ok");

/* -- Deltas ------------------------------------------------------------------ */

eq("a normal delta", C.deltaPct(150, 100), 50);
eq("a decline is negative", C.deltaPct(50, 100), -50);
// Both of these are claims about a comparison that did not happen.
eq("no prior period yields null, not zero", C.deltaPct(100, null), null);
eq("a zero prior yields null, not infinity", C.deltaPct(100, 0), null);
eq("a missing current yields null", C.deltaPct(null, 100), null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
