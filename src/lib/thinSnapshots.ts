/**
 * Which old snapshots can go without changing the shape of a curve.
 *
 * WHY THIS EXISTS
 *
 * Storage is not a problem today -- roughly 84 MB/year against a 500 MB
 * ceiling, and the sync already declines to write a reading that has not
 * changed. But the series only ever grows, and the cost of adding this later
 * is the same as adding it now while there is nothing to lose.
 *
 * THE RULE
 *
 * Recent history is never touched: every reading inside KEEP_ALL_DAYS survives
 * exactly as recorded, because that is the window the product actually reads
 * for growth, velocity and lifecycle.
 *
 * Beyond it, a point is removable only when it sits on the straight line
 * between its neighbours -- within a tolerance. Three readings of 100, 200,
 * 300 say the same thing as 100 and 300; the middle one is predictable from
 * the other two, so removing it loses nothing. Three readings of 100, 105,
 * 300 do NOT: the middle one is where the curve bends, and that bend is the
 * entire signal this product exists to catch.
 *
 * That is the difference between this and a hard cap. "Keep the newest 200"
 * throws away whichever points happen to be oldest, which on a video that went
 * viral eighteen months ago is precisely the interesting part. Collinearity
 * throws away flatness instead -- and a flat stretch is exactly the thing you
 * can reconstruct from its endpoints.
 *
 * NEVER REMOVED, whatever the arithmetic says:
 *   - the first reading, which anchors the series to its baseline
 *   - the last reading, which is the current number
 *   - anything inside KEEP_ALL_DAYS
 *   - either neighbour of a point already removed in this pass, so a long
 *     smooth run thins to alternating points rather than collapsing to two
 */

export type Snap = {
  id: string;
  capturedAt: number;
  views: number | null;
};

/** Readings newer than this are never candidates. */
export const KEEP_ALL_DAYS = 90;

/**
 * How far off the straight line a point may sit and still count as redundant,
 * as a fraction of the span its neighbours cover.
 *
 * 2% is deliberately tight. The risk of being too eager is losing a real
 * inflection; the risk of being too shy is keeping rows that cost almost
 * nothing. Those are not symmetric, so this errs toward keeping.
 */
export const FLAT_TOLERANCE = 0.02;

/**
 * A floor on how short a series may become, however flat it looks.
 *
 * Thinning is idempotent per pass but not across passes: feed the survivors
 * back in and a perfectly straight line thins again, and again. Measured, a
 * synthetic 40-point straight line collapses to its two endpoints in six
 * passes. That is arithmetically defensible -- a line IS its endpoints -- and
 * still the wrong thing to keep in a table someone will one day plot.
 *
 * Real data is never that straight, so this rail should almost never bind.
 * It exists so that "almost never" is not the same as "never checked".
 */
export const MIN_KEEP = 12;

export function thinSnapshots(
  snaps: Snap[],
  now: number = Date.now(),
  keepAllDays: number = KEEP_ALL_DAYS,
  tolerance: number = FLAT_TOLERANCE,
): string[] {
  // Oldest first; the caller may hand these over in any order.
  const s = [...snaps].sort((a, b) => a.capturedAt - b.capturedAt);
  if (s.length < 3) return [];
  // Already at or below the floor: nothing to give.
  if (s.length <= MIN_KEEP) return [];

  const cutoff = now - keepAllDays * 86400000;
  const remove = new Set<string>();

  for (let i = 1; i < s.length - 1; i++) {
    const prev = s[i - 1];
    const cur = s[i];
    const next = s[i + 1];

    // Recent readings are off limits.
    if (cur.capturedAt >= cutoff) continue;

    // A null reading carries no value to interpolate, and its absence is
    // itself information (the platform did not answer). Left alone.
    if (cur.views == null || prev.views == null || next.views == null) continue;

    // Never drop two in a row: if the previous point went, this one is now a
    // neighbour of a gap, and removing it too would widen that gap without
    // anything checking the shape across it.
    if (remove.has(prev.id)) continue;

    const dt = next.capturedAt - prev.capturedAt;
    if (dt <= 0) continue;

    // Where a straight line between the neighbours would put this reading.
    const t = (cur.capturedAt - prev.capturedAt) / dt;
    const expected = prev.views + (next.views - prev.views) * t;
    const error = Math.abs(cur.views - expected);

    // Scale the tolerance to the span being covered. On a video that moved
    // from 100 to 100,000 an absolute threshold would either delete
    // everything or nothing.
    const span = Math.max(Math.abs(next.views - prev.views), Math.abs(prev.views), 1);
    if (error / span <= tolerance) remove.add(cur.id);

    // Stop as soon as taking another would breach the floor. Checked inside
    // the loop rather than by trimming the result afterwards, so the points
    // that survive are the LATER ones -- a truncated result set would keep
    // whichever happened to be found first, which is the oldest and least
    // useful end of the series.
    if (s.length - remove.size <= MIN_KEEP) break;
  }

  return [...remove];
}

/**
 * Groups a flat snapshot list by post and returns everything thinnable.
 *
 * Kept here rather than in the caller so the whole policy -- what a series is,
 * what may go from it -- lives in one tested place, and the caller is only
 * responsible for reading rows and deleting ids.
 */
export function thinnableIds(
  rows: { id: string; platform_post_id: string; captured_at: string; views: number | null }[],
  now: number = Date.now(),
): string[] {
  const byPost = new Map<string, Snap[]>();
  for (const r of rows) {
    if (!byPost.has(r.platform_post_id)) byPost.set(r.platform_post_id, []);
    byPost.get(r.platform_post_id)!.push({
      id: r.id,
      capturedAt: new Date(r.captured_at).getTime(),
      views: r.views,
    });
  }
  const out: string[] = [];
  for (const series of byPost.values()) out.push(...thinSnapshots(series, now));
  return out;
}
