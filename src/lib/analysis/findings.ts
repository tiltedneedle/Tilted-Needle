/**
 * The lifecycle of a finding: when to look again, and what to do when a claim
 * stops being true.
 *
 * WHY LOOKING LESS OFTEN IS A CORRECTNESS FIX, NOT A COST SAVING
 *
 * Benjamini-Hochberg controls the false-discovery rate WITHIN one run. It says
 * nothing about running 52 times. Measured under a pure null with BH applied
 * per report exactly as designed, the probability that a given client is shown
 * at least one false finding:
 *
 *     after 1 run    0.105
 *     after 13 runs  0.293
 *     after 52 runs  0.471, carrying one in a mean of 6.7 separate weeks
 *
 * Across 13 clients over a year: 0.9998. Near certainty that somebody is told
 * something untrue and acts on it.
 *
 * The old rule was a pure time gate -- seven days, no data check -- on
 * libraries gaining roughly one scored video a week. So 52 re-tests a year of
 * almost the same 29 videos. A re-test on data that has not moved cannot learn
 * anything; it can only roll the dice again.
 *
 * The fix is to look when the EVIDENCE changes: 20% growth in scored posts, or
 * 90 days. That is about 6 runs a year instead of 52, which takes P(>=1 false
 * finding per client per year) from 0.471 toward ~0.15 and cuts model spend
 * about eightfold. Both effects come from the same change, but the first is
 * the reason for it.
 */

/** Re-test once a client's scored library has grown by this fraction. */
export const REGROWTH_THRESHOLD = 0.20;
/** ...or after this long, so a quiet client is not frozen forever. */
export const MAX_DAYS_BETWEEN_RUNS = 90;
/** Not recomputed in this long: hidden from reports, kept for audit. */
export const STALE_AFTER_DAYS = 180;

export type ClientRunState = {
  clientId: string;
  scoredPostsAtRun: number;
  lastRunAt: string | null;
};

export type DueDecision =
  | { due: true; reason: "never_run" | "grew" | "aged" }
  | { due: false; reason: string };

/**
 * Should this client be re-tested?
 *
 * Deliberately pure and separately tested, because the failure it guards
 * against is invisible in production: running too often does not error, it
 * produces findings -- confident, well-formatted, and false about one time in
 * ten per look.
 */
export function isDue(
  state: ClientRunState | null,
  scoredPostsNow: number,
  now: Date = new Date(),
): DueDecision {
  if (!state || !state.lastRunAt) return { due: true, reason: "never_run" };

  const base = state.scoredPostsAtRun;
  /* A client that had nothing at the last run is due the moment it has
     anything -- 0 -> 5 is infinite growth, and the ratio below cannot express
     that without dividing by zero. */
  if (base <= 0) {
    return scoredPostsNow > 0
      ? { due: true, reason: "grew" }
      : { due: false, reason: "still has no scored posts" };
  }

  const growth = (scoredPostsNow - base) / base;
  if (growth >= REGROWTH_THRESHOLD) return { due: true, reason: "grew" };

  const days = (now.getTime() - new Date(state.lastRunAt).getTime()) / 86_400_000;
  if (days >= MAX_DAYS_BETWEEN_RUNS) return { due: true, reason: "aged" };

  return {
    due: false,
    reason:
      `${scoredPostsNow} scored posts against ${base} at the last run ` +
      `(${Math.round(growth * 100)}% growth, needs ${Math.round(REGROWTH_THRESHOLD * 100)}%), ` +
      `${Math.round(days)} days ago`,
  };
}

export type StoredFinding = {
  hypothesisId: string;
  status: "active" | "retracted" | "superseded" | "stale";
  state: "acting" | "holds" | "none";
  multiplier: number;
};

export type FreshResult = {
  hypothesisId: string;
  significant: boolean;
  state: "acting" | "holds" | "none";
  multiplier: number;
};

export type Transition =
  | { kind: "new"; hypothesisId: string; state: FreshResult["state"] }
  | { kind: "confirmed"; hypothesisId: string }
  | { kind: "retracted"; hypothesisId: string; reason: string }
  | { kind: "superseded"; hypothesisId: string; from: string; to: string };

/**
 * Compare what a run just found against what the client has already been told.
 *
 * THE RETRACTION IS THE POINT. A system that simply stops mentioning a finding
 * has un-said it silently, and the reader -- who remembers -- is left with a
 * claim we no longer support and no way to know. Saying "we reported that
 * longer videos helped in June; with fifteen more videos it no longer holds"
 * is the honest handling of repeated looks, and it reads as a feature rather
 * than as a hedge.
 */
export function reconcile(
  stored: StoredFinding[],
  fresh: FreshResult[],
): Transition[] {
  const freshById = new Map(fresh.map((f) => [f.hypothesisId, f]));
  const out: Transition[] = [];

  for (const s of stored) {
    if (s.status !== "active") continue;
    const f = freshById.get(s.hypothesisId);

    if (!f || !f.significant || f.state === "none") {
      out.push({
        kind: "retracted",
        hypothesisId: s.hypothesisId,
        reason: !f
          ? "the hypothesis could not be tested in this run (too few clients had both sides)"
          : !f.significant
            ? "it no longer clears the false-discovery threshold on the larger library"
            : "the effect is no longer distinguishable from no difference",
      });
      continue;
    }

    if (f.state !== s.state) {
      out.push({ kind: "superseded", hypothesisId: s.hypothesisId, from: s.state, to: f.state });
      continue;
    }
    out.push({ kind: "confirmed", hypothesisId: s.hypothesisId });
  }

  const known = new Set(stored.filter((s) => s.status === "active").map((s) => s.hypothesisId));
  for (const f of fresh) {
    if (known.has(f.hypothesisId)) continue;
    // Only a supported finding is worth telling anyone about. A fresh "none"
    // is the normal state of most hypotheses and is not news.
    if (f.significant && f.state !== "none") {
      out.push({ kind: "new", hypothesisId: f.hypothesisId, state: f.state });
    }
  }

  return out;
}

/**
 * How often a client would be re-tested under a given cadence, and the
 * resulting chance of showing at least one false finding in a year.
 *
 * Exported so the trade-off can be stated in numbers rather than asserted --
 * the per-look false-positive probability is the BH q, since that is what
 * "expect one in ten of the findings you see to be spurious" means.
 */
export function falseFindingRisk(runsPerYear: number, qPerRun = 0.10): number {
  return 1 - (1 - qPerRun) ** runsPerYear;
}
