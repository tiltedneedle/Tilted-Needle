/**
 * Competitor sampling: what other people's videos can and cannot tell us.
 *
 * THE ONE RULE. A raw view count from somebody else's account is not
 * comparable to anything in this product. A rival with 10M followers doing
 * 1M views is performing WORSE, against themselves, than a client with 5k
 * followers doing 50k. Cross-account raw counts measure audience size, not
 * craft, and every "competitor benchmark" that quotes them is really a
 * follower-count leaderboard wearing a performance label.
 *
 * So a competitor's post is only ever read as a ratio against that
 * competitor's OWN median -- the same normalisation perfIndex has always
 * applied to clients. "8x their own normal" survives the follower gap;
 * "1M views" does not. `relIndex` is the only figure downstream code should
 * touch, and `views` is kept beside it purely so a human can sanity-check the
 * ratio against the number it came from.
 *
 * WHAT THIS IS FOR, AND WHAT IT IS NOT FOR. It feeds idea generation: here is
 * a format that broke out for someone chasing the same audience. It does NOT
 * feed reports, rankings, the inference engine, or any client-facing figure
 * -- competitor rows live in their own tables precisely so that no rollup can
 * reach them by accident.
 */

/** Below this a median is not a baseline, it is one of two numbers. */
export const MIN_POSTS_FOR_BASELINE = 5;

export type CompetitorPostLike = { views: number | null };

/**
 * Reduce a pasted handle to its canonical form.
 *
 * People paste three things: a bare handle, an @handle, and the profile URL
 * from their address bar. The table's unique key is (client, platform,
 * handle), so without one canonical form the same rival becomes three rows
 * and every count over them is wrong.
 *
 * Kept here rather than only in the server action so tests can reach it
 * without pulling in Next's server runtime.
 */
export function normaliseHandle(raw: string): string {
  let s = (raw ?? "").trim();
  if (!s) return "";
  const url = s.match(/^https?:\/\/[^/]+\/(.+)$/i);
  if (url) {
    s = url[1].split(/[?#]/)[0].replace(/\/+$/, "");
    const parts = s.split("/").filter(Boolean);
    // tiktok and youtube put the handle in an @segment; instagram uses the
    // first path segment. Prefer an @segment wherever one exists.
    s = parts.find((p) => p.startsWith("@")) ?? parts[0] ?? "";
  }
  return s.replace(/^@+/, "").trim().toLowerCase();
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export type Indexed<T> = T & { relIndex: number | null };

/**
 * Score every sampled post against its own account's median.
 *
 * MEDIAN, NOT MEAN, and for the reason that recurs throughout this codebase:
 * one viral post drags a mean far enough that every ordinary post reads as a
 * failure. On a six-post sample ending in a 3000-view breakout, the mean is
 * 750 and the median is 350 -- under the mean, four of six posts look bad.
 *
 * Posts with no view figure, or zero, are excluded from the baseline AND get
 * no index. Treating an unmeasured post as zero would drag the median down
 * and then flatter every other post against it.
 */
export function relativeIndex<T extends CompetitorPostLike>(
  posts: T[],
): { baseline: number | null; scored: Indexed<T>[] } {
  const usable = posts
    .map((p) => p.views)
    .filter((v): v is number => typeof v === "number" && v > 0);

  const baseline = usable.length >= MIN_POSTS_FOR_BASELINE ? median(usable) : null;

  return {
    baseline,
    scored: posts.map((p) => ({
      ...p,
      relIndex:
        baseline && typeof p.views === "number" && p.views > 0
          ? p.views / baseline
          : null,
    })),
  };
}

/**
 * The posts worth learning from, best-relative-first.
 *
 * Sorting by raw views would hand back whichever competitor has the largest
 * audience, every time, which is the failure this module exists to prevent.
 * Unscored posts sort last rather than being dropped: a competitor with too
 * few samples still belongs on the list, just not at the top of it.
 */
export function topByRelative<T extends { relIndex: number | null }>(
  posts: T[],
  limit: number,
): T[] {
  return [...posts]
    .sort((a, b) => {
      if ((a.relIndex == null) !== (b.relIndex == null)) return a.relIndex == null ? 1 : -1;
      return (b.relIndex ?? 0) - (a.relIndex ?? 0);
    })
    .slice(0, Math.max(0, limit));
}
