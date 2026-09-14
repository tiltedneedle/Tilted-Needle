/**
 * Growth over time, for the client report.
 *
 * The report stated one period and one percentage. A client reading "22,003
 * views" has no way to see whether that is a climb or a slide, and a single
 * "+12% vs last month" is a number without a shape. This gives the document a
 * time axis: the trailing six months, per platform, as three series.
 *
 * THREE SERIES, EACH LABELLED BY WHAT IT ACTUALLY IS, because they are not
 * equally knowable:
 *
 *   published    videos published in the month. Publish dates go back years,
 *                so this is complete for every month drawn.
 *   viewsGained  views the tracked videos GAINED inside the month -- the same
 *                measurePlatform() the rest of the report trusts. The system
 *                has read view counts only since 2026-07-29, so months before
 *                that have no readings and are drawn as UNMEASURED, never as
 *                zero. This series fills in one month at a time from here.
 *   comments     comments received in the month, by the comment's own
 *                timestamp. Complete wherever a comment route exists; absent
 *                (null for every month) on a platform with none.
 *
 * NEVER SUMMED ACROSS PLATFORMS. Each platform gets its own small chart. The
 * report's one combined figure carries its caveat for a reason, and a chart
 * has no room for one.
 *
 * Pure. The builder feeds it posts and comment timestamps; the document draws
 * whatever comes back. Nothing here touches the database, so it is testable
 * with a handful of literals.
 */
import { measurePlatform, type ReportPeriod, type ReportPost } from "@/lib/clientReport";

export type MonthKey = string; // "2026-08"

export type GrowthPoint = {
  month: MonthKey;
  /** "Aug" -- for the axis. */
  label: string;
  /** Null means "not measured", which the chart must draw as such. */
  value: number | null;
  /**
   * Measured, but not for the whole month. The first month readings exist
   * for starts wherever the first reading fell -- 29 July, here -- so only
   * videos published inside it can be attributed and older videos' gains
   * that month are invisible. Drawn outlined, and the note says so.
   */
  partial?: boolean;
};

export type GrowthSeries = {
  key: "published" | "viewsGained" | "comments";
  title: string;
  /** Printed under the chart. Says what the numbers are and where they stop. */
  note: string;
  points: GrowthPoint[];
  /** Latest month against the one before, when both are measured. */
  deltaPct: number | null;
};

export type PlatformGrowth = {
  platform: string;
  platformLabel: string;
  series: GrowthSeries[];
};

export type CommentStamp = { postId: string; publishedAt: string | null };

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function monthLongLabel(key: MonthKey): string {
  return MONTH_LONG[Number(key.slice(5, 7)) - 1] ?? key;
}

/** The `n` months ending with the month the period ends in, oldest first. */
export function trailingMonths(period: ReportPeriod, n = 6): MonthKey[] {
  const [y, m] = period.end.slice(0, 7).split("-").map(Number);
  const out: MonthKey[] = [];
  for (let i = n - 1; i >= 0; i--) {
    // Month arithmetic on integers; no Date, no timezone.
    const total = y * 12 + (m - 1) - i;
    const yy = Math.floor(total / 12);
    const mm = (total % 12) + 1;
    out.push(`${yy}-${String(mm).padStart(2, "0")}`);
  }
  return out;
}

export function monthLabel(key: MonthKey): string {
  return MONTH_ABBR[Number(key.slice(5, 7)) - 1] ?? key;
}

/** Inclusive date bounds of a month, as the report's period type. */
export function monthBounds(key: MonthKey): ReportPeriod {
  const [y, m] = key.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${key}-01`, end: `${key}-${String(last).padStart(2, "0")}` };
}

export function publishedByMonth(posts: ReportPost[], months: MonthKey[]): GrowthPoint[] {
  return months.map((month) => ({
    month,
    label: monthLabel(month),
    value: posts.filter((p) => p.postedAtTs != null && p.postedAtTs.slice(0, 7) === month).length,
  }));
}

/**
 * Views gained inside each month, or null where nothing was measured.
 *
 * `measured` is the count of videos whose gain could be attributed to the
 * month. Zero of them means the system had no readings then -- a fact about
 * our coverage, not about the client's views -- and the honest value is null.
 */
export function viewsGainedByMonth(posts: ReportPost[], months: MonthKey[]): GrowthPoint[] {
  // The day readings began, across every post: a month that started before
  // it can only be partially measured.
  const firstReading = posts
    .flatMap((p) => p.snapshots.map((x) => x.capturedAt))
    .sort()[0] ?? null;
  return months.map((month) => {
    const t = measurePlatform(posts, monthBounds(month));
    const value = t.measured > 0 ? t.viewsGained : null;
    const partial = value != null && firstReading != null && firstReading > `${month}-01`;
    return { month, label: monthLabel(month), value, ...(partial ? { partial: true } : {}) };
  });
}

/**
 * Comments received in each month, by the comment's own timestamp.
 *
 * Returns all-null when the platform has NO stored comments at all: that is a
 * platform without a route, and "0, 0, 0, 0, 0, 0" would read as silence
 * from the audience rather than silence from us.
 */
export function commentsByMonth(
  comments: CommentStamp[],
  postIds: Set<string>,
  months: MonthKey[],
): GrowthPoint[] {
  const mine = comments.filter((c) => postIds.has(c.postId));
  if (mine.length === 0) {
    return months.map((month) => ({ month, label: monthLabel(month), value: null }));
  }
  return months.map((month) => ({
    month,
    label: monthLabel(month),
    value: mine.filter((c) => c.publishedAt != null && c.publishedAt.slice(0, 7) === month).length,
  }));
}

/** Last point against the one before it, when both are measured and the prior is non-zero. */
export function seriesDelta(points: GrowthPoint[]): number | null {
  if (points.length < 2) return null;
  const cur = points[points.length - 1].value;
  const prev = points[points.length - 2].value;
  if (cur == null || prev == null || prev === 0) return null;
  // A full month against a partial one is not a comparison. July measured
  // from its 29th read 142k; August read 22k; "-84%" was the shape of our
  // coverage, not of the client's views.
  if (points[points.length - 2].partial || points[points.length - 1].partial) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

/** First month that carries a measured value, for the note. */
function firstMeasured(points: GrowthPoint[]): GrowthPoint | null {
  return points.find((p) => p.value != null) ?? null;
}

export function platformGrowth(input: {
  platform: string;
  platformLabel: string;
  posts: ReportPost[];
  comments: CommentStamp[];
  period: ReportPeriod;
  months?: number;
}): PlatformGrowth {
  const months = trailingMonths(input.period, input.months ?? 6);
  const postIds = new Set(input.posts.map((p) => p.postId));

  const published = publishedByMonth(input.posts, months);
  const views = viewsGainedByMonth(input.posts, months);
  const comments = commentsByMonth(input.comments, postIds, months);

  /* Short, because three of these sit under three charts on one A4 sheet.
     Each still says what the numbers are and where they stop. */
  const viewsFirst = firstMeasured(views);
  const viewsNote = viewsFirst
    ? `Views gained inside each month, from our own readings. Measured from ${viewsFirst.label}` +
      (viewsFirst.partial ? " (partial: readings began mid-month)" : "") +
      "; earlier months unmeasured."
    : "Views gained inside each month. No readings yet.";

  const commentsNote = firstMeasured(comments)
    ? input.platform === "instagram"
      ? "Comments received, by post date. Instagram: first page per video only."
      : "Comments received, by post date."
    : "No comment route for this platform.";

  return {
    platform: input.platform,
    platformLabel: input.platformLabel,
    series: [
      {
        key: "published",
        title: "Published",
        note: "Videos published each month.",
        points: published,
        deltaPct: seriesDelta(published),
      },
      {
        key: "viewsGained",
        title: "Views gained",
        note: viewsNote,
        points: views,
        deltaPct: seriesDelta(views),
      },
      {
        key: "comments",
        title: "Comments",
        note: commentsNote,
        points: comments,
        deltaPct: seriesDelta(comments),
      },
    ],
  };
}
