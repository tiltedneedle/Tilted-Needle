/**
 * Shared aggregation for the client and person dashboards.
 *
 * Everything here keeps metrics bucketed by platform. There is deliberately
 * no function that returns a single combined view count: a view is a
 * different unit on every platform, so a total would be a number that looks
 * authoritative and means nothing (PRD 5 Step 2).
 */

export type PlatformTotals = {
  platform: string;
  views: number;
  likes: number;
  comments: number;
  posts: number;
};

export type MetricRow = {
  platform: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
};

/** Sums metrics within each platform, never across them. */
export function totalsByPlatform(rows: MetricRow[]): PlatformTotals[] {
  const map = new Map<string, PlatformTotals>();
  for (const r of rows) {
    if (!map.has(r.platform)) {
      map.set(r.platform, {
        platform: r.platform,
        views: 0,
        likes: 0,
        comments: 0,
        posts: 0,
      });
    }
    const t = map.get(r.platform)!;
    t.views += r.views ?? 0;
    t.likes += r.likes ?? 0;
    t.comments += r.comments ?? 0;
    t.posts += 1;
  }
  return [...map.values()].sort((a, b) => b.views - a.views);
}

/**
 * Hours per 1,000 views, per platform.
 *
 * The cost equivalent needs cost rates, which arrive in Phase 4; hours are the
 * honest version of the same ratio until then. Kept per platform for the same
 * reason as everything else here.
 */
export function hoursPerThousandViews(
  seconds: number,
  views: number,
): number | null {
  if (views <= 0) return null;
  return seconds / 3600 / (views / 1000);
}

export function engagementRate(t: PlatformTotals): number | null {
  if (t.views <= 0) return null;
  return (t.likes + t.comments) / t.views;
}
