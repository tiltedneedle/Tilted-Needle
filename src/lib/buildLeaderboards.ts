import "server-only";
import { operatingDate, startOfOperatingDay } from "@/lib/tz";
import { cachedContentData } from "@/lib/cachedContentData";
import { LEADER_WINDOWS, type LeaderRow, type Leaderboards } from "@/lib/leaderboards";

/**
 * Builds both leaderboards over all four windows in one pass.
 *
 * Server-only, because it reads the whole workspace. All four windows are
 * computed together and shipped to the client so switching between them is
 * instant and costs no round trip -- affordable because the expensive half,
 * the workspace read, is already cached and shared with /content.
 */
type Assignment = { content_item_id: string; user_id: string; userName: string };

export async function buildLeaderboards(
  ws: string,
  assignments: Assignment[],
): Promise<Leaderboards> {
  const raw = await cachedContentData(ws);

  const items = raw.items as { id: string; produced_at: string | null }[];
  const posts = raw.posts as {
    content_item_id: string;
    metrics: { views: number | null } | { views: number | null }[] | null;
  }[];

  const producedAt = new Map(items.map((i) => [i.id, i.produced_at]));

  /**
   * Peak views for a video, NOT the sum across its platforms.
   *
   * A view means a different thing on each platform -- an impression on one,
   * roughly thirty seconds watched on another -- so adding them produces a
   * number that is not a quantity of anything. The peak is the largest single
   * honest figure the video earned, and is what the rest of the product uses.
   *
   * Summing those peaks ACROSS videos is fine: those are different videos.
   */
  const peakByItem = new Map<string, number>();
  for (const p of posts) {
    const m = Array.isArray(p.metrics) ? p.metrics[0] : p.metrics;
    const v = m?.views ?? 0;
    const prev = peakByItem.get(p.content_item_id) ?? 0;
    if (v > prev) peakByItem.set(p.content_item_id, v);
  }

  const now = Date.now();
  const out = {} as Leaderboards;

  for (const w of LEADER_WINDOWS) {
    /**
   * The window opens at a LOCAL midnight, not at this moment minus N days.
   *
   * A rolling instant put the boundary at whatever time of day the page
   * happened to be loaded, so "last 7 days" covered a different span every
   * time somebody refreshed, and a video published in the small hours drifted
   * in and out of it. Anchoring to the start of an operating day makes the
   * window mean the same thing all day -- and match the dates it is compared
   * against, which are operating-day strings.
   */
    const cutoff =
      w.days == null
        ? null
        : startOfOperatingDay(
            operatingDate(new Date(now - w.days * 86_400_000)),
          ).getTime();

    // Per user: the distinct videos they are credited on inside this window.
    // A Set because someone credited as both editor AND videographer on one
    // video did one video's work, not two -- otherwise whoever holds the most
    // ROLES outranks whoever did the most work.
    const byUser = new Map<string, { name: string; videos: Set<string> }>();
    for (const a of assignments) {
      const d = producedAt.get(a.content_item_id);
      // A video with no date cannot be placed in a window. It counts only in
      // "All", rather than being silently attributed to the current week.
      if (cutoff != null && (!d || new Date(d).getTime() < cutoff)) continue;
      if (!byUser.has(a.user_id)) byUser.set(a.user_id, { name: a.userName, videos: new Set() });
      byUser.get(a.user_id)!.videos.add(a.content_item_id);
    }

    const rows: LeaderRow[] = [...byUser.entries()].map(([userId, u]) => ({
      userId,
      name: u.name,
      videos: u.videos.size,
      views: [...u.videos].reduce((s, id) => s + (peakByItem.get(id) ?? 0), 0),
    }));

    out[w.key] = {
      // Ties broken by the OTHER metric, so two people on three videos each
      // are not ordered by whatever the Map happened to yield.
      credits: [...rows].sort((a, b) => b.videos - a.videos || b.views - a.views),
      views: [...rows].sort((a, b) => b.views - a.views || b.videos - a.videos),
    };
  }

  return out;
}
