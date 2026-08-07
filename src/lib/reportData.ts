/**
 * The database half of the reports (PRD v0.5 §5). Kept apart from
 * lib/reports.ts so that file can stay pure and testable: everything here
 * touches Supabase, everything there is arithmetic.
 */
import { selectAll } from "@/lib/selectAll";
import type { VideoSummary } from "@/lib/dashboards";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

type TimeRow = {
  user_id: string;
  content_item_id: string | null;
  duration_seconds: number | null;
};

/**
 * Tracked seconds per person, counting ONLY time booked against the videos
 * currently in view. Time on a video the filters excluded is real work, but
 * it is not work on what is on screen -- and a person strip that says "12h"
 * next to "2 videos" it did not include is the kind of quiet inconsistency
 * that makes people stop trusting the numbers.
 *
 * Pass `userIds` to narrow the query; omit it for the whole workspace.
 */
export async function secondsByUserOnVideos(
  supabase: Db,
  ws: string,
  userIds: string[] | null,
  videos: VideoSummary[],
): Promise<Map<string, number>> {
  const viewIds = new Set(videos.map((v) => v.id));
  const seconds = new Map<string, number>();
  if (viewIds.size === 0 || (userIds && userIds.length === 0)) return seconds;

  const rows = await selectAll(() => {
    let q = supabase
      .from("time_entries")
      .select("user_id, content_item_id, duration_seconds")
      .eq("workspace_id", ws)
      .not("content_item_id", "is", null)
      .not("ended_at", "is", null)
      .order("id");
    if (userIds) q = q.in("user_id", userIds);
    return q;
  });

  for (const r of (rows.data ?? []) as TimeRow[]) {
    if (!r.content_item_id || !viewIds.has(r.content_item_id)) continue;
    seconds.set(r.user_id, (seconds.get(r.user_id) ?? 0) + (r.duration_seconds ?? 0));
  }
  return seconds;
}
