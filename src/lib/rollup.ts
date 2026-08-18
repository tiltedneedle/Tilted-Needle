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
  /**
   * Identity of the real post behind this row: `platform|external_id`.
   *
   * Optional, and only the workspace-level total uses it. One post can
   * legitimately reach us more than once -- an Instagram collab appears on
   * both collaborators' feeds, so the sync creates a row under each account,
   * each with the SAME external_id and the same view count, because it is
   * literally the same post being counted by Instagram once.
   */
  postKey?: string | null;
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
 * The same totals, counting each real post once.
 *
 * For the WORKSPACE headline only. Per-client and per-account figures must
 * keep using totalsByPlatform: an Instagram collab genuinely appears on both
 * collaborators' feeds, so each client's own reach legitimately includes it,
 * and each account's baseline should too.
 *
 * Rolled up across the whole workspace it is a different question -- "how far
 * did our work travel" -- and there the same post counted twice is simply
 * wrong. On live data three collab posts (one 1.05M-view Reel, one 318K, one
 * small) sat under both @tiltedneedle and @yusufnik8, overstating the
 * workspace Instagram row by 1,372,117 views, 101,256 likes and 3 posts:
 * 14.5% of a figure someone would reconcile against Instagram's own dashboard
 * and find no explanation for.
 *
 * Rows with no postKey are always kept. An absent key means "we cannot tell",
 * and dropping rows on a guess would understate reach, which is the worse of
 * the two errors here.
 */
export function totalsByPlatformUnique(rows: MetricRow[]): PlatformTotals[] {
  const seen = new Set<string>();
  const unique: MetricRow[] = [];
  for (const r of rows) {
    if (!r.postKey) {
      unique.push(r);
      continue;
    }
    if (seen.has(r.postKey)) continue;
    seen.add(r.postKey);
    unique.push(r);
  }
  return totalsByPlatform(unique);
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
