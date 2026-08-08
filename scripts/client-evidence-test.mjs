// Client-evidence tests. Every expectation hand-computed.
//
// The behaviour under test is mostly REFUSAL: this module's job is to decline
// to report patterns the sample cannot support. A split resting on two videos
// is astrology, and shipping it with a caveat is not good enough, because the
// number is what gets remembered and the caveat is not.
//
//   node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/client-evidence-test.mjs
import {
  splitBy, buildClientEvidence, evidenceToPrompt, MIN_PER_SIDE, MIN_LIBRARY,
} from "../src/lib/analysis/clientEvidence.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};
const near = (a, b, eps = 1e-6) => a != null && Math.abs(a - b) < eps;

let seq = 0;
const v = (over = {}) => ({
  id: `v${++seq}`,
  title: "A video",
  clientId: "acme",
  bestIndex: 1,
  lengthSeconds: 60,
  postedAtTs: "2026-08-05T09:00:00Z", // Wednesday, 13:00 Dubai
  platforms: [{ platform: "youtube", views: 100 }],
  ...over,
});

/* ---- splitBy refuses thin evidence -------------------------------------- */
{
  const thin = [
    ...Array.from({ length: 2 }, () => v({ title: "Why?", bestIndex: 3 })),
    ...Array.from({ length: 9 }, () => v({ title: "Plain", bestIndex: 1 })),
  ];
  check("a split with too few on one side returns null",
    splitBy(thin, "question", (x) => x.title.includes("?")) === null,
    `${MIN_PER_SIDE} needed per side`);

  const enough = [
    ...Array.from({ length: 4 }, () => v({ title: "Why?", bestIndex: 3 })),
    ...Array.from({ length: 4 }, () => v({ title: "Plain", bestIndex: 1 })),
  ];
  const s = splitBy(enough, "question", (x) => x.title.includes("?"));
  check("a split with enough on both sides reports", s !== null);
  check("medians are computed from the right groups", s.withMedian === 3 && s.withoutMedian === 1);
  check("the ratio is with over without", s.ratio === 3);
  check("both sample sizes travel with it", s.withN === 4 && s.withoutN === 4);

  // Unscored videos must not silently count as zero.
  const withUnscored = [
    ...Array.from({ length: 4 }, () => v({ title: "Why?", bestIndex: 2 })),
    ...Array.from({ length: 4 }, () => v({ title: "Plain", bestIndex: 2 })),
    ...Array.from({ length: 20 }, () => v({ title: "Why?", bestIndex: null })),
  ];
  const s2 = splitBy(withUnscored, "question", (x) => x.title.includes("?"));
  check("unscored videos are excluded, not counted as zero",
    s2.withN === 4 && near(s2.withMedian, 2), `n=${s2.withN} median=${s2.withMedian}`);
}

/* ---- A small library is characterised as un-characterisable ------------- */
{
  const tiny = Array.from({ length: 5 }, () => v());
  const e = buildClientEvidence("acme", tiny);
  check("a library below the floor reports no splits", e.splits === null);
  check("and says why, with the number needed",
    e.notes.some((n) => n.includes("too few") && n.includes(String(MIN_LIBRARY))));
  check("but still counts what it has", e.scoredCount === 5 && e.videoCount === 5);
}

/* ---- Platform fit -------------------------------------------------------- */
{
  const vids = [
    ...Array.from({ length: 4 }, () => v({
      bestIndex: 3, platforms: [{ platform: "tiktok", views: 10 }],
    })),
    ...Array.from({ length: 5 }, () => v({
      bestIndex: 1, platforms: [{ platform: "youtube", views: 10 }],
    })),
  ];
  const e = buildClientEvidence("acme", vids);
  check("platform fit is ranked best first", e.platformFit[0].platform === "tiktok");
  check("with the median and its n", e.platformFit[0].medianIndex === 3 && e.platformFit[0].n === 4);

  // A platform with one post must not be presented beside one with forty.
  const sparse = buildClientEvidence("acme", [
    ...vids,
    v({ bestIndex: 9, platforms: [{ platform: "facebook", views: 1 }] }),
  ]);
  check("a platform with too few posts is left out entirely",
    !sparse.platformFit.some((p) => p.platform === "facebook"),
    sparse.platformFit.map((p) => p.platform).join(","));
}

/* ---- Length uses the client's OWN median -------------------------------- */
{
  // Medians differ wildly by client; an industry number would be meaningless.
  const vids = [
    ...Array.from({ length: 5 }, () => v({ lengthSeconds: 30, bestIndex: 2 })),
    ...Array.from({ length: 5 }, () => v({ lengthSeconds: 300, bestIndex: 1 })),
  ];
  const e = buildClientEvidence("acme", vids);
  const lengthSplit = e.splits.find((s) => s.label.includes("median"));
  check("the length split is drawn at this client's own median",
    lengthSplit?.label.includes("165s"), lengthSplit?.label);
  check("and shows the shorter group performing better",
    lengthSplit.withMedian === 1 && lengthSplit.withoutMedian === 2);

  check("the best quartile's median length is reported",
    e.lengthHint?.topMedian === 30 && e.lengthHint?.restMedian !== 30,
    JSON.stringify(e.lengthHint));
}

/* ---- Timing needs the timestamp P2 started capturing -------------------- */
{
  const noTimes = Array.from({ length: 10 }, () => v({ postedAtTs: null }));
  const e = buildClientEvidence("acme", noTimes);
  check("without publish times, no timing split is reported",
    !e.splits.some((s) => s.label.includes("weekend") || s.label.includes("noon")));
  check("and the gap is explained rather than silent",
    e.notes.some((n) => n.includes("publish times")));

  const timed = [
    // 2026-08-08 is a Saturday; 04:00Z is 08:00 Dubai.
    ...Array.from({ length: 4 }, () => v({ postedAtTs: "2026-08-08T04:00:00Z", bestIndex: 3 })),
    ...Array.from({ length: 5 }, () => v({ postedAtTs: "2026-08-05T14:00:00Z", bestIndex: 1 })),
  ];
  const e2 = buildClientEvidence("acme", timed);
  const weekend = e2.splits.find((s) => s.label.includes("weekend"));
  check("weekend publishing is detected in Dubai time",
    weekend?.withN === 4 && weekend?.withMedian === 3, JSON.stringify(weekend));
  const morning = e2.splits.find((s) => s.label.includes("noon"));
  check("morning publishing is detected in Dubai time, not UTC",
    morning?.withN === 4, `04:00Z is 08:00 Dubai; n=${morning?.withN}`);
}

/* ---- The prompt carries limits, not just numbers ------------------------ */
{
  const e = buildClientEvidence("acme", Array.from({ length: 4 }, () => v()));
  const p = evidenceToPrompt(e);
  check("the prompt states the limits of the data", p.includes("Limits of this data"));
  check("and the scored count", p.includes("scored against their account baseline"));

  const rich = buildClientEvidence("acme", [
    ...Array.from({ length: 5 }, () => v({ title: "Why?", bestIndex: 3 })),
    ...Array.from({ length: 5 }, () => v({ title: "Plain", bestIndex: 1 })),
  ]);
  const rp = evidenceToPrompt(rich);
  check("comparisons are labelled association, not cause",
    rp.includes("association only, not cause"));
  check("every comparison shows both sample sizes", rp.includes("n=5"));
}

/* ---- One outlier must not become the finding ---------------------------- */
// Straight from live data. A MEAN put one client's TikTok at "66.9x baseline"
// and claimed longer videos performed 19x better. Both were a single viral
// post wearing a statistic, and a team reading it would have gone and made
// longer videos on the strength of one lucky upload.
{
  const typical = Array.from({ length: 6 }, () => v({ title: "Why?", bestIndex: 1 }));
  const viral = v({ title: "Why?", bestIndex: 500 });
  const others = Array.from({ length: 6 }, () => v({ title: "Plain", bestIndex: 1 }));
  const all = [...typical, viral, ...others];

  const s = splitBy(all, "question", (x) => x.title.includes("?"));
  check("one 500x outlier does not drag the typical case upward",
    s.withMedian === 1, `median ${s.withMedian}; a mean would be ~72`);
  check("so the ratio stays honest", s.ratio === 1, `ratio ${s.ratio}`);
  check("but the outlier is still reported, not smoothed away", s.peak === 500);

  const e = buildClientEvidence("acme", all);
  check("platform fit is equally outlier-resistant",
    e.platformFit[0].medianIndex === 1 && e.platformFit[0].peakIndex === 500,
    JSON.stringify(e.platformFit[0]));

  const p = evidenceToPrompt(e);
  check("the prompt says median, never average",
    p.includes("Median boost") && !p.includes("Mean boost"));
  check("and shows the best single post beside it", p.includes("best single post"));
}

/* ---- Hook analysis: only videos we can actually hear ------------------- */
// The payoff of gathering transcripts at all. The trap is treating a video
// with NO transcript as one that "did not ask a question" -- that is
// unobserved, not negative, and counting it would invent a finding out of
// missing data.
{
  const withHook = (text, idx) => v({ hookText: text, bestIndex: idx });

  const mixed = [
    ...Array.from({ length: 4 }, () => withHook("What if I told you this changes everything", 3)),
    ...Array.from({ length: 4 }, () => withHook("Welcome back to the channel guys", 1)),
    // No transcript, and a wildly different score: must not land on either
    // side of a hook split.
    ...Array.from({ length: 20 }, () => v({ hookText: null, bestIndex: 9 })),
  ];
  const e = buildClientEvidence("acme", mixed);

  const q = e.splits.find((s) => s.label.includes("asks a question"));
  check("videos without a transcript are excluded from hook splits",
    q && q.withN === 4 && q.withoutN === 4, `n=${q?.withN}/${q?.withoutN} out of 28 videos`);
  check("and their scores do not leak into the hook medians",
    q.withMedian === 3 && q.withoutMedian === 1,
    `${q?.withMedian} vs ${q?.withoutMedian}; the 20 excluded sit at 9`);

  const greet = e.splits.find((s) => s.label.includes("channel greeting"));
  check("a channel-greeting opening is detected", greet?.withN === 4);
  check("and reads as the weaker opening here", greet?.ratio < 1, `ratio ${greet?.ratio}`);

  // Question marks are unreliable in ASR output, so the wording must match too.
  const noMark = buildClientEvidence("acme", [
    ...Array.from({ length: 4 }, () => withHook("why does nobody talk about this", 2)),
    ...Array.from({ length: 4 }, () => withHook("today we visited the factory", 1)),
  ]);
  check("a spoken question with no question mark still counts",
    noMark.splits.find((s) => s.label.includes("asks a question"))?.withN === 4);
}

/* ---- Nothing to hear yet ------------------------------------------------ */
{
  const none = buildClientEvidence("acme", Array.from({ length: 10 }, () => v({ hookText: null })));
  check("with no transcripts, no opening split is reported",
    !none.splits.some((s) => s.label.includes("Opening")));
  check("and the gap is stated rather than left silent",
    none.notes.some((n) => n.includes("No transcripts yet")));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
