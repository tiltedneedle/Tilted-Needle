// Topic velocity: share of slate, not count, plus traction as a separate axis.
//   node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/topic-velocity-test.mjs
import {
  topicTrends, WINDOW_DAYS, MIN_PER_WINDOW,
} from "../src/lib/analysis/topicVelocity.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};
const near = (a, b, eps = 1e-9) => a != null && Math.abs(a - b) < eps;

const NOW = new Date("2026-08-24T00:00:00Z");
const daysAgo = (d) => new Date(NOW.getTime() - d * 86_400_000);
const vids = (topic, n, when, index = 1) =>
  Array.from({ length: n }, () => ({
    topicLabels: [topic], postedAt: daysAgo(when === "recent" ? 30 : 120), index,
  }));
const find = (trends, topic) => trends.find((t) => t.topic === topic);

/* ---- THE CORRECTION THIS MODULE EXISTS FOR ------------------------------
   Raw counts divided by raw counts re-report workspace volume, not topic
   movement. Measured on the real corpus: 467 videos in the recent window
   against 30 in the prior one, so every topic printed a large "rising"
   number regardless of whether it had gained or lost ground. */
{
  /* Output doubles overall, 20 -> 40. Three topics, because with only two
     the shares are complementary and one cannot hold steady while the other
     falls.
       Health   10 -> 20   rides the surge exactly. Share 0.40 -> 0.40.
       Fashion  10 -> 10   flat in COUNT, which against a doubled slate is a
                           halving of share: 0.40 -> 0.20.
       Vehicle   5 -> 20   the genuine riser: 0.20 -> 0.40.
     Every window clears MIN_PER_WINDOW, so nothing here is suppressed as
     thin -- an earlier draft put Vehicle at 2 in the prior window and the
     floor correctly refused to call it anything.

     Health is the case that matters. Its raw count DOUBLED, so the original
     count-based version called it "2x rising" -- while its share did not move
     at all and the honest answer is steady. */
  const { trends, context } = topicTrends([
    ...vids("Health", 20, "recent"), ...vids("Health", 10, "prior"),
    ...vids("Fashion", 10, "recent"), ...vids("Fashion", 10, "prior"),
    ...vids("Vehicle", 20, "recent"), ...vids("Vehicle", 5, "prior"),
  ], NOW);

  check("workspace volume change is reported as context, not buried",
    near(context.volumeRatio, 50 / 25));
  check("a topic whose COUNT doubled with the surge is steady, not rising",
    find(trends, "Health").status === "steady"
    && near(find(trends, "Health").outputRatio, 1),
    `ratio=${find(trends, "Health").outputRatio}`);
  check("a topic flat in count against a doubled slate is FALLING",
    find(trends, "Fashion").status === "falling"
    && near(find(trends, "Fashion").outputRatio, 0.5),
    `ratio=${find(trends, "Fashion").outputRatio}`);
  check("a topic that genuinely took more of the slate is rising",
    find(trends, "Vehicle").status === "rising"
    && near(find(trends, "Vehicle").outputRatio, 2));
  check("shares are of the tagged slate",
    near(find(trends, "Health").recentShare, 0.4)
    && near(find(trends, "Health").priorShare, 0.4));
  check("raw counts are still carried, so the base is visible",
    find(trends, "Health").recentCount === 20
    && find(trends, "Health").priorCount === 10);
}

{
  // Genuine share growth: Health goes from half the slate to three quarters,
  // while total volume is flat.
  const { trends } = topicTrends([
    ...vids("Health", 30, "recent"), ...vids("Health", 10, "prior"),
    ...vids("Lifestyle", 10, "recent"), ...vids("Lifestyle", 10, "prior"),
  ], NOW);
  check("a topic taking more of the slate is rising",
    find(trends, "Health").status === "rising");
  check("and the topic it displaced is falling",
    find(trends, "Lifestyle").status === "falling");
}

/* ---- Output and traction are separate axes -------------------------------- */
{
  // Health doubles its share while its median halves: the divergence case.
  const { trends } = topicTrends([
    ...vids("Health", 30, "recent", 0.5), ...vids("Health", 10, "prior", 1.0),
    ...vids("Lifestyle", 10, "recent", 1), ...vids("Lifestyle", 30, "prior", 1),
  ], NOW);
  const h = find(trends, "Health");
  check("traction is the ratio of medians", near(h.tractionRatio, 0.5));
  check("output and traction are never blended into one score",
    h.outputRatio !== h.tractionRatio);
  check("output up with traction down still reads as rising output",
    h.status === "rising");
  check("output-up-traction-down sorts to the top",
    trends[0].topic === "Health", `got ${trends.map((t) => t.topic).join(",")}`);
}

/* ---- One-sided topics get words, not ratios ------------------------------ */
{
  const { trends } = topicTrends(vids("Motorsport", 6, "recent"), NOW);
  check("a topic with no prior window is new, not infinite",
    trends[0].status === "new" && trends[0].outputRatio === null);

  const dropped = topicTrends(vids("Film", 6, "prior"), NOW).trends[0];
  check("a topic absent from the recent window is dropped",
    dropped.status === "dropped" && dropped.outputRatio === null);
}

/* ---- Floors -------------------------------------------------------------- */
{
  const { trends } = topicTrends([
    ...vids("Food", MIN_PER_WINDOW - 1, "recent", 5),
    ...vids("Food", MIN_PER_WINDOW - 1, "prior", 1),
  ], NOW);
  check("a thin pair is flagged and never called rising",
    trends[0].underpowered === true && trends[0].status === "thin");
  check("traction is withheld when a window is under the floor",
    trends[0].tractionRatio === null);
}

{
  // Enough videos for output, too few SCORED for traction.
  const { trends } = topicTrends([
    ...vids("Society", 2, "recent", 2),
    ...Array.from({ length: 6 }, () => ({
      topicLabels: ["Society"], postedAt: daysAgo(30), index: null,
    })),
    ...vids("Society", 8, "prior", 1),
  ], NOW);
  check("output counts unscored videos", trends[0].recentCount === 8);
  check("traction ignores them and withholds when too few are scored",
    trends[0].tractionRatio === null);
}

/* ---- Coverage drift is surfaced, because it biases every share ------------ */
{
  const { context } = topicTrends([
    ...vids("Health", 3, "recent"),
    ...Array.from({ length: 7 }, () => ({
      topicLabels: [], postedAt: daysAgo(30), index: 1,
    })),
    ...vids("Health", 8, "prior"),
    ...Array.from({ length: 2 }, () => ({
      topicLabels: [], postedAt: daysAgo(120), index: 1,
    })),
  ], NOW);
  check("tagging coverage is reported per window",
    near(context.recentCoverage, 0.3) && near(context.priorCoverage, 0.8));
  check("untagged videos count toward total but not toward tagged",
    context.recentTotal === 10 && context.recentTagged === 3);
}

/* ---- Windows and multi-label ---------------------------------------------- */
{
  const outside = [{ topicLabels: ["Hobby"], postedAt: daysAgo(WINDOW_DAYS * 2 + 30), index: 1 }];
  check("videos older than both windows are ignored",
    topicTrends(outside, NOW).trends.length === 0);
  check("videos with no date are ignored",
    topicTrends([{ topicLabels: ["Hobby"], postedAt: null, index: 1 }], NOW).trends.length === 0);
  check("a video with no labels contributes nothing to any topic",
    topicTrends([{ topicLabels: null, postedAt: daysAgo(30), index: 1 }], NOW).trends.length === 0);
  check("blank labels are not a topic",
    topicTrends([{ topicLabels: ["", "  "], postedAt: daysAgo(30), index: 1 }], NOW).trends.length === 0);

  const { trends: multi } = topicTrends([
    { topicLabels: ["Vehicle", "Motorsport"], postedAt: daysAgo(30), index: 1 },
  ], NOW);
  check("a multi-label video counts under each of its labels",
    multi.length === 2 && multi.every((t) => t.recentCount === 1));

  // A duplicated label must not double-count the same video.
  const { trends: dup } = topicTrends([
    { topicLabels: ["Vehicle", "Vehicle", " Vehicle "], postedAt: daysAgo(30), index: 1 },
  ], NOW);
  check("a repeated label counts the video once",
    dup.length === 1 && dup[0].recentCount === 1);
}

/* ---- The steady band matches the rest of the product ---------------------- */
{
  const { trends } = topicTrends([
    ...vids("Business", 10, "recent"), ...vids("Business", 10, "prior"),
    ...vids("Food", 10, "recent"), ...vids("Food", 10, "prior"),
  ], NOW);
  check("an unchanged slate is steady, not rising",
    trends.every((t) => t.status === "steady"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
