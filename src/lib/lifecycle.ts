/**
 * How a post has behaved over its life, read from the snapshot history.
 *
 * Pure and dependency-free so Node's native loader can test it directly. Two
 * properties of the underlying data drive every decision here, and both are
 * easy to get wrong:
 *
 * 1. SNAPSHOTS ARE CHANGE POINTS, NOT SAMPLES. syncRunner deliberately skips
 *    writing a row when nothing moved, so a gap in the series means "we
 *    looked and it was flat", not "we have no data". It follows that the
 *    current rate must be measured against the last time we ACTUALLY LOOKED
 *    (`observedUntil`), never against the last row. A video that stopped
 *    growing a week ago still has a recent-looking final snapshot; dividing
 *    by the interval between its last two rows would report the velocity it
 *    had on the day it died.
 *
 * 2. THE WINDOW IS SHORTER THAN THE LIVES IT DESCRIBES. Snapshot history
 *    starts when this system started, not when the videos were published, so
 *    most posts are observed for a slice in the middle of a life that began
 *    months earlier. Half-life and "spike vs evergreen" in the textbook sense
 *    need the birth of the curve, which for most posts we simply do not have.
 *    Rather than fabricate them, this module reports what a mid-life slice
 *    genuinely supports, and says plainly (via `coverage`) when it is not
 *    enough.
 *
 * The classifier that works on a partial window is MOMENTUM: the share of a
 * post's lifetime views earned inside the observed window, compared to the
 * share a perfectly flat accumulation would have produced over the same days.
 * A six-month-old video that earned 15% of its views in the last ten days is
 * plainly still working; one that earned 0.1% is finished. That comparison
 * needs only the current total, the gain, and the age -- all of which we have
 * for every post.
 */

export type LifecycleShape =
  /** Not enough observation -- or not enough views -- to say anything. */
  | "unknown"
  /** Observed, and it has not gained a single view. */
  | "dormant"
  /** Seen from publication and still in its opening run. */
  | "launching"
  /** Earning materially faster than its own lifetime average. Notable. */
  | "rising"
  /** Still earning at roughly its lifetime average -- the evergreen case. */
  | "steady"
  /**
   * Earning below its lifetime average: the ordinary long tail.
   *
   * Named carefully. An earlier revision called this "decayed" and the live
   * data showed why that was wrong: three-week-old TikToks were being flagged
   * as failures for doing exactly what social video does, which is earn most
   * of its views in the first days. The flat-accumulation baseline that
   * `momentum` uses is a neutral reference point, NOT a target -- almost
   * every maturing post sits below it, and a label implying fault would have
   * had the team chasing normal behaviour.
   */
  | "tail";

export type Coverage =
  /** We watched this post from publication: full-curve figures are real. */
  | "from-birth"
  /** We joined mid-life: rates and momentum are real, half-life is not. */
  | "partial"
  /** Fewer than two readings, or no measurable window. */
  | "insufficient";

export type LifecycleReading = {
  shape: LifecycleShape;
  coverage: Coverage;
  /** Views gained between the first reading and the last time we looked. */
  gainInWindow: number;
  /** Days between the first reading and the last time we looked. */
  windowDays: number;
  /** Views per day across that window. Zero is a real answer, not a gap. */
  dailyRate: number;
  /** Days since publication, when the post carries a date. */
  ageDays: number | null;
  /** Share of its current lifetime views earned inside the window. */
  recentShare: number | null;
  /**
   * `recentShare` divided by the share a perfectly flat accumulation would
   * predict. 1.0 means "earning at its lifetime average right now".
   */
  momentum: number | null;
  /**
   * Days from publication to half its current views. Only computable when
   * `coverage === "from-birth"` -- otherwise the curve's start is unobserved
   * and any number would be invented.
   */
  halfLifeDays: number | null;
};

export type SeriesPoint = { at: number; views: number };

const DAY_MS = 86_400_000;

/** Momentum at or above this reads as genuinely re-accelerating. */
const RISING_AT = 1.5;
/** Below this, the post has settled into its long tail. */
const TAIL_BELOW = 0.5;
/** Inside this many days of publication, a post is still in its opening run. */
const LAUNCH_WINDOW_DAYS = 14;
/**
 * Lifetime views below which momentum is noise rather than signal. A post
 * with eight views that gained six is not "earning 75% of its life this
 * week" in any sense worth printing -- live data produced exactly that.
 */
const MIN_VIEWS_TO_CLASSIFY = 100;

/**
 * @param series          Change points, ascending by time. Non-null views only.
 * @param observedUntil   When we last actually polled this post's account.
 *                        Anything after the final change point is known-flat
 *                        time, and counts toward the window.
 * @param postedAt        Publication date (YYYY-MM-DD), when known.
 */
export function readLifecycle({
  series,
  observedUntil,
  postedAt,
  now = Date.now(),
}: {
  series: SeriesPoint[];
  observedUntil: number | null;
  postedAt: string | null;
  now?: number;
}): LifecycleReading {
  const empty = (shape: LifecycleShape, coverage: Coverage): LifecycleReading => ({
    shape,
    coverage,
    gainInWindow: 0,
    windowDays: 0,
    dailyRate: 0,
    ageDays: ageIn(postedAt, now),
    recentShare: null,
    momentum: null,
    halfLifeDays: null,
  });

  if (series.length < 2) return empty("unknown", "insufficient");

  const first = series[0];
  const last = series[series.length - 1];

  // Known-flat time counts. Guard against a stale or missing sync stamp by
  // never letting the window end before the final reading.
  const windowEnd = Math.max(last.at, observedUntil ?? 0);
  const windowMs = windowEnd - first.at;
  if (windowMs <= 0) return empty("unknown", "insufficient");

  const windowDays = windowMs / DAY_MS;
  const gainInWindow = last.views - first.views;
  const dailyRate = gainInWindow / windowDays;
  const currentViews = last.views;
  const ageDays = ageIn(postedAt, now);

  // Did we see this post's whole life? Its first reading must land close to
  // publication -- one sync interval of slack, since the first snapshot lands
  // whenever the sync next ran, not the instant it was published.
  const firstReadingAgeDays =
    postedAt != null ? (first.at - dateMs(postedAt)) / DAY_MS : Number.POSITIVE_INFINITY;
  const fromBirth = firstReadingAgeDays <= 2;
  const coverage: Coverage = fromBirth ? "from-birth" : "partial";

  const recentShare = currentViews > 0 ? gainInWindow / currentViews : null;

  // What share would a perfectly flat accumulation have put in this window?
  // Capped at 1: a window longer than the post's age cannot exceed its life.
  const expectedShare =
    ageDays != null && ageDays > 0 ? Math.min(1, windowDays / ageDays) : null;
  const momentum =
    recentShare != null && expectedShare != null && expectedShare > 0
      ? recentShare / expectedShare
      : null;

  const halfLifeDays = fromBirth ? halfLifeFrom(series, postedAt) : null;

  return {
    shape: classify({ gainInWindow, momentum, ageDays, fromBirth, currentViews }),
    coverage,
    gainInWindow,
    windowDays,
    dailyRate,
    ageDays,
    recentShare,
    momentum,
    halfLifeDays,
  };
}

function classify({
  gainInWindow,
  momentum,
  ageDays,
  fromBirth,
  currentViews,
}: {
  gainInWindow: number;
  momentum: number | null;
  ageDays: number | null;
  fromBirth: boolean;
  currentViews: number;
}): LifecycleShape {
  // Nothing moved across everything we watched. Unambiguous, and it does not
  // depend on knowing the age or on having many views.
  if (gainInWindow <= 0) return "dormant";

  // Too few views for any ratio to mean anything.
  if (currentViews < MIN_VIEWS_TO_CLASSIFY) return "unknown";

  // Seen from publication and still young: whatever it becomes, it is not
  // there yet, and calling a three-day-old video "settled" because its first
  // day dominated would be wrong.
  if (fromBirth && ageDays != null && ageDays <= LAUNCH_WINDOW_DAYS) return "launching";

  // Without an age there is no lifetime average to compare against.
  if (momentum == null) return "unknown";

  if (momentum >= RISING_AT) return "rising";
  if (momentum < TAIL_BELOW) return "tail";
  return "steady";
}

/**
 * Days from publication until the post had half the views it has now.
 * Linearly interpolated between the two readings that straddle the halfway
 * mark -- the series is a step function of observations, not a continuous
 * curve, and pretending otherwise would imply precision we cannot support.
 */
function halfLifeFrom(series: SeriesPoint[], postedAt: string | null): number | null {
  if (postedAt == null || series.length < 2) return null;
  const birth = dateMs(postedAt);
  const target = series[series.length - 1].views / 2;
  if (!(target > 0)) return null;

  for (let i = 0; i < series.length; i++) {
    if (series[i].views < target) continue;
    if (i === 0) {
      // Already past halfway at the first reading: the crossing happened
      // before we were watching, so the honest answer is "at most this".
      return Math.max(0, (series[0].at - birth) / DAY_MS);
    }
    const prev = series[i - 1];
    const cur = series[i];
    const span = cur.views - prev.views;
    const frac = span > 0 ? (target - prev.views) / span : 0;
    const at = prev.at + (cur.at - prev.at) * frac;
    return Math.max(0, (at - birth) / DAY_MS);
  }
  return null;
}

function dateMs(isoDate: string): number {
  // Dubai is the business timezone throughout this system (fixed UTC+4).
  return new Date(`${isoDate}T00:00:00+04:00`).getTime();
}

function ageIn(postedAt: string | null, now: number): number | null {
  if (!postedAt) return null;
  const age = (now - dateMs(postedAt)) / DAY_MS;
  return age >= 0 ? age : null;
}

/** Compact label + tone for the UI. Data in, presentation out; no JSX here. */
export const SHAPE_LABEL: Record<LifecycleShape, string> = {
  unknown: "Not enough history",
  dormant: "Not moving",
  launching: "Launching",
  rising: "Rising",
  steady: "Holding",
  tail: "Long tail",
};

export const SHAPE_HINT: Record<LifecycleShape, string> = {
  unknown: "Needs two readings across a measurable window, and enough views to be meaningful",
  dormant: "No views gained across everything we have watched",
  launching: "Seen from publication and still in its opening run",
  rising: "Earning faster than its own lifetime average — something is driving it again",
  steady: "Still earning at about its lifetime average — the evergreen case",
  tail: "Settled into its long tail, which is where most posts end up",
};

/**
 * How much attention each shape deserves. Only `rising` is genuinely
 * remarkable on an older post; `tail` is the common case and must never be
 * styled like a problem.
 */
export const SHAPE_TONE: Record<LifecycleShape, "good" | "neutral" | "quiet"> = {
  unknown: "quiet",
  dormant: "quiet",
  launching: "good",
  rising: "good",
  steady: "neutral",
  tail: "neutral",
};

/**
 * Liveliest first, for rolling several platforms' readings into the single
 * glyph a dense list can afford -- the question that glyph answers is "is
 * this still working ANYWHERE".
 *
 * Lives here, beside the shape union, deliberately: an earlier revision kept
 * this table in dashboards.ts, and renaming a shape left it keyed on a value
 * that no longer existed. Every lookup silently returned undefined, every
 * comparison against it was false, and 76 posts collapsed into "unknown" on
 * screen while every unit test still passed.
 */
export const SHAPE_RANK: Record<LifecycleShape, number> = {
  rising: 5,
  launching: 4,
  steady: 3,
  tail: 2,
  dormant: 1,
  unknown: 0,
};

/** The liveliest shape across a set of readings. */
export function bestShape(shapes: LifecycleShape[]): LifecycleShape {
  return shapes.reduce<LifecycleShape>(
    (best, s) => (SHAPE_RANK[s] > SHAPE_RANK[best] ? s : best),
    "unknown",
  );
}
