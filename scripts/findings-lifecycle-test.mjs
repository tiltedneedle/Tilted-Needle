// Looking less often is a correctness fix, and a retracted claim must be said aloud.
//   npm run test:findings
//
// THE FAILURE THIS GUARDS AGAINST IS INVISIBLE IN PRODUCTION
//
// Benjamini-Hochberg controls the false-discovery rate WITHIN one run. It says
// nothing about running 52 times. Re-testing weekly does not error, does not
// slow anything down, and does not look wrong in a log -- it just produces
// confident, well-formatted findings that are false about one time in ten per
// look, and a marketer who accumulates memory across weeks watches them appear,
// vanish and contradict each other.
//
// The old rule was a pure seven-day time gate with no data check, on libraries
// gaining about one scored video a week.
import { readFileSync } from "node:fs";
import {
  isDue, reconcile, falseFindingRisk,
  REGROWTH_THRESHOLD, MAX_DAYS_BETWEEN_RUNS,
} from "../src/lib/analysis/findings.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

const NOW = new Date("2026-08-22T00:00:00Z");
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

/* ---- The arithmetic that justifies the change --------------------------- */
{
  const weekly = falseFindingRisk(52);
  const gated = falseFindingRisk(6);
  console.log(`\nP(>=1 false finding for one client in a year)`);
  console.log(`  weekly, 52 runs   ${weekly.toFixed(3)}`);
  console.log(`  data-gated, ~6    ${gated.toFixed(3)}`);
  console.log(`  across 13 clients ${(1 - (1 - weekly) ** 13).toFixed(4)} vs ${(1 - (1 - gated) ** 13).toFixed(4)}`);

  check("weekly re-testing is close to a coin flip per client per year",
    weekly > 0.99, weekly.toFixed(3));
  check("the data gate cuts it several-fold", gated < weekly / 2,
    `${gated.toFixed(3)} against ${weekly.toFixed(3)}`);
  check("and across the whole roster the difference is the product",
    1 - (1 - gated) ** 13 < 1 - (1 - weekly) ** 13);
}

/* ---- The gate ----------------------------------------------------------- */
{
  check("a client never tested is due",
    isDue(null, 30, NOW).due && isDue(null, 30, NOW).reason === "never_run");

  check("no growth and no time means not due",
    isDue({ clientId: "c", scoredPostsAtRun: 30, lastRunAt: daysAgo(7) }, 31, NOW).due === false,
    isDue({ clientId: "c", scoredPostsAtRun: 30, lastRunAt: daysAgo(7) }, 31, NOW).reason);

  // One video a week from 29 is ~3% growth. The old gate fired anyway.
  check("a week's worth of new videos does NOT trigger a re-test",
    isDue({ clientId: "c", scoredPostsAtRun: 29, lastRunAt: daysAgo(7) }, 30, NOW).due === false,
    "this single case is the whole fix");

  check("20% growth does",
    isDue({ clientId: "c", scoredPostsAtRun: 30, lastRunAt: daysAgo(7) }, 36, NOW).due === true);
  check("19% growth does not",
    isDue({ clientId: "c", scoredPostsAtRun: 100, lastRunAt: daysAgo(7) }, 119, NOW).due === false);

  check("a quiet client is still re-tested after 90 days",
    isDue({ clientId: "c", scoredPostsAtRun: 30, lastRunAt: daysAgo(91) }, 30, NOW).due === true,
    "so a client that stops posting is not frozen forever");
  check("89 days is not enough on its own",
    isDue({ clientId: "c", scoredPostsAtRun: 30, lastRunAt: daysAgo(89) }, 31, NOW).due === false);

  // Division by zero: a client with nothing at the last run.
  check("a client that had zero posts is due as soon as it has any",
    isDue({ clientId: "c", scoredPostsAtRun: 0, lastRunAt: daysAgo(1) }, 5, NOW).due === true);
  check("but not while it still has none",
    isDue({ clientId: "c", scoredPostsAtRun: 0, lastRunAt: daysAgo(1) }, 0, NOW).due === false,
    "0 -> 0 must not read as infinite growth");

  // Shrinking libraries: a video deleted or unapproved.
  check("a shrinking library does not trigger a re-test",
    isDue({ clientId: "c", scoredPostsAtRun: 40, lastRunAt: daysAgo(3) }, 35, NOW).due === false,
    "negative growth is not growth");
}

/* ---- Simulating a year under each cadence ------------------------------- */
/* The point stated as behaviour rather than as a formula: how many times would
   a real client actually be looked at? */
{
  let posts = 29;
  let state = { clientId: "c", scoredPostsAtRun: posts, lastRunAt: daysAgo(0) };
  let runs = 0;
  let at = NOW.getTime();
  for (let week = 1; week <= 52; week++) {
    at += 7 * 86_400_000;
    posts += 1;                                   // ~1 scored video a week
    const d = isDue(state, posts, new Date(at));
    if (d.due) {
      runs++;
      state = { clientId: "c", scoredPostsAtRun: posts, lastRunAt: new Date(at).toISOString() };
    }
  }
  console.log(`\na client gaining 1 video/week from 29 is re-tested ${runs}x/year`);
  check("a year of weekly growth produces a handful of runs, not 52",
    runs >= 3 && runs <= 10, `${runs} runs`);
}

/* ---- Retraction --------------------------------------------------------- */
{
  const stored = [
    { hypothesisId: "h_title_question", status: "active", state: "acting", multiplier: 1.4 },
    { hypothesisId: "h_hook_greeting", status: "active", state: "holds", multiplier: 0.8 },
    { hypothesisId: "h_cta_present", status: "retracted", state: "acting", multiplier: 1.2 },
  ];

  // The claim stops clearing BH on the bigger library.
  const lost = reconcile(stored, [
    { hypothesisId: "h_title_question", significant: false, state: "none", multiplier: 1.05 },
    { hypothesisId: "h_hook_greeting", significant: true, state: "holds", multiplier: 0.82 },
  ]);
  const retraction = lost.find((t) => t.hypothesisId === "h_title_question");
  check("a claim that loses significance is RETRACTED, not dropped",
    retraction?.kind === "retracted", retraction?.kind);
  check("and it carries a reason a human can read",
    /false-discovery/.test(retraction?.reason ?? ""), retraction?.reason);
  check("a claim that still holds is confirmed",
    lost.find((t) => t.hypothesisId === "h_hook_greeting")?.kind === "confirmed");
  check("an already-retracted finding is not retracted twice",
    !lost.some((t) => t.hypothesisId === "h_cta_present"));

  // A hypothesis that could not run at all this time.
  const vanished = reconcile(stored, []);
  check("a hypothesis that could not be tested retracts with that reason",
    /could not be tested/.test(
      vanished.find((t) => t.hypothesisId === "h_title_question")?.reason ?? ""));

  // The client's own posterior moves into the no-difference band.
  const moved = reconcile(stored, [
    { hypothesisId: "h_title_question", significant: true, state: "holds", multiplier: 1.02 },
    { hypothesisId: "h_hook_greeting", significant: true, state: "holds", multiplier: 0.82 },
  ]);
  const sup = moved.find((t) => t.hypothesisId === "h_title_question");
  check("a state change is superseded rather than retracted",
    sup?.kind === "superseded" && sup.from === "acting" && sup.to === "holds",
    `${sup?.from} -> ${sup?.to}`);

  // Something genuinely new.
  const fresh = reconcile(stored, [
    { hypothesisId: "h_title_question", significant: true, state: "acting", multiplier: 1.4 },
    { hypothesisId: "h_hook_greeting", significant: true, state: "holds", multiplier: 0.8 },
    { hypothesisId: "h_loop_marker", significant: true, state: "acting", multiplier: 1.6 },
  ]);
  check("a newly supported finding is reported as new",
    fresh.find((t) => t.hypothesisId === "h_loop_marker")?.kind === "new");
  check("an unsupported new result is NOT news",
    !reconcile([], [{ hypothesisId: "h_x", significant: false, state: "none", multiplier: 1 }]).length,
    "most hypotheses are 'none' most of the time; that is not a finding");
}

/* ---- The gate is really wired in --------------------------------------- */
{
  const enq = readFileSync("./worker/enqueue.mjs", "utf8");
  const live = enq.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  check("the weekly-read planner consults the data gate",
    /isDue|REGROWTH_THRESHOLD/.test(live),
    "a pure time gate re-tests 52x a year on data that has not moved");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
