import "server-only";
import { cachedContentData } from "@/lib/cachedContentData";
import {
  loadPlatformMomentum,
  loadWeekMovers,
  type ItemRow,
  type MoverVideo,
  type PlatformMomentum,
  type PostRow,
  type SnapRow,
} from "@/lib/homeData";

/**
 * Both reach cards, from ONE read of the workspace.
 *
 * They used to load themselves: momentum paged 30 days of `post_snapshots`
 * and movers paged 7, and each fetched the whole `platform_posts` table
 * alongside. Measured on a production build, that was 7.4s and 5.5s of a
 * 8.3s Home render -- essentially the entire page, spent fetching one table
 * twice over a window that nests inside the other.
 *
 * Three things were wrong and this fixes all three:
 *
 *   - The 7-day window is a SUBSET of the 30-day one, so the second fetch
 *     could never return a row the first had not already returned.
 *   - `platform_posts` was fetched twice, identically.
 *   - Neither read was cached, while /content was already holding the same
 *     rows warm under the "content" tag.
 *
 * So both now run off `cachedContentData`, which /content keeps warm and
 * which the sync route already busts. The arithmetic is untouched: filtering
 * the full history down to a window yields exactly the rows the windowed
 * query returned, in the same `captured_at, id` order, so the deltas are
 * identical -- including the rule that the first reading inside a window has
 * no predecessor and therefore contributes no gain.
 *
 * The shared read also removes a way for the page to lie. Two independent
 * fetches straddling a running sync could show a mover whose gain did not
 * appear in any momentum bar.
 */
export async function loadReachCards(
  ws: string,
  excludeItemIds: Set<string> = new Set(),
  { days = 30, moverLimit = 5 }: { days?: number; moverLimit?: number } = {},
): Promise<{ momentum: PlatformMomentum[]; movers: MoverVideo[] }> {
  const raw = await cachedContentData(ws);
  const posts = raw.posts as PostRow[];
  const snaps = raw.snapshots as SnapRow[];
  const items = raw.items as ItemRow[];
  return {
    momentum: loadPlatformMomentum(posts, snaps, days, excludeItemIds),
    movers: loadWeekMovers(posts, snaps, items, moverLimit, excludeItemIds),
  };
}
