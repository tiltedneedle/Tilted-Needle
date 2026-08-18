import "server-only";
import { unstable_cache } from "next/cache";
import { selectAll } from "@/lib/selectAll";
import { serviceClient } from "@/lib/syncRunner";

/**
 * The raw workspace content read, cached per workspace.
 *
 * WHY THIS EXISTS
 *
 * /content took ~4.3s to render and every filter change paid it again. The
 * measurement that located it: a filter matching ZERO videos still cost 3.6s,
 * while the video drill-down -- which skips this load entirely -- cost 1.2s
 * against a 1.0s network baseline. So the time was not in rendering rows or
 * in the filter; it was in loading the whole workspace before any filtering
 * happened.
 *
 * That is by design, and the design is sound: dashboards.ts filters in
 * TypeScript rather than SQL so every filter composes with every other one
 * without a combinatorial explosion of query builders. Its premise was that
 * "the row counts here are small". They were. The workspace now holds 464
 * content items, 371 posts and 3009 snapshots, and the snapshots page 1000 at
 * a time in SEQUENCE.
 *
 * The saving grace is that the loaded data is IDENTICAL regardless of filter.
 * Filtering happens afterwards, in memory. So the expensive half can be cached
 * and only the cheap half re-runs, which turns a 3.5s filter change into the
 * cost of the derivation alone.
 *
 * DELIBERATE CHOICES, all of them lifted from cachedRankings, which learned
 * them the hard way:
 *
 * - serviceClient(), not the caller's client. A cache entry is shared between
 *   users, so it must not depend on who warmed it. Safe here for the same
 *   reason it is safe there: every row is workspace-scoped data all staff can
 *   read under RLS anyway, and /content sits behind the staff guard -- a
 *   client-role user is redirected to /portal by the app layout and never
 *   reaches this code.
 *
 * - A tag AND a revalidate ceiling. The tag alone is not enough and that is
 *   not theoretical: cachedRankings went stale for exactly this reason in
 *   August, because a tag only fires when a write goes through the APP, and
 *   the sync cron, the worker and SQL scripts all write these tables. Sixty
 *   seconds is the floor under the tag, not a replacement for it.
 *
 * - Plain rows only. No Maps or Sets cross this boundary, so unlike
 *   cachedRankings there is no freeze/thaw pair to keep in sync. If a future
 *   change adds one, it will fail on the SECOND request, not the first --
 *   which is the confusing kind.
 */

export type RawContentData = {
  items: unknown[];
  posts: unknown[];
  times: unknown[];
  clients: unknown[];
  platforms: unknown[];
  snapshots: unknown[];
};

async function loadRaw(ws: string): Promise<RawContentData> {
  const db = serviceClient();

  // Anything reading a whole unbounded table pages -- a 1000-row cap would
  // silently drop videos, posts and hours off the dashboard (see selectAll).
  const [itemsRes, postsRes, timeRes, clientsRes, platformsRes, snapsRes] = await Promise.all([
    selectAll(() =>
      db
        .from("content_items")
        .select(
          "id, title, produced_at, length_seconds, client_id, review_state, client:clients(id, name)",
        )
        .eq("workspace_id", ws)
        .order("produced_at", { ascending: false, nullsFirst: false })
        .order("id"),
    ),
    selectAll(() =>
      db
        .from("platform_posts")
        .select(
          "id, content_item_id, posted_at, thumbnail_url, external_id, account_id, account:accounts(platform_slug, last_synced_at), metrics:post_current_metrics(views, likes, comments)",
        )
        .eq("workspace_id", ws)
        .order("id"),
    ),
    selectAll(() =>
      db
        .from("time_entries")
        .select("id, duration_seconds, content_item_id")
        .eq("workspace_id", ws)
        .not("content_item_id", "is", null)
        .not("ended_at", "is", null)
        .order("id"),
    ),
    db.from("clients").select("id, name, is_archived").is("deleted_at", null).eq("workspace_id", ws).order("name"),
    db.from("platforms").select("slug, display_name").eq("is_enabled", true).order("sort_order"),
    selectAll(() =>
      db
        .from("post_snapshots")
        .select("id, platform_post_id, captured_at, views")
        .eq("workspace_id", ws)
        .order("captured_at")
        .order("id"),
    ),
  ]);

  return {
    items: itemsRes.data ?? [],
    posts: postsRes.data ?? [],
    times: timeRes.data ?? [],
    clients: clientsRes.data ?? [],
    platforms: platformsRes.data ?? [],
    snapshots: snapsRes.data ?? [],
  };
}

const cached = unstable_cache(loadRaw, ["content-raw-v1"], {
  // "content" is busted by revalidateTeam() and by the sync route, alongside
  // "rankings" -- the two caches read overlapping tables and go stale on the
  // same events, so invalidating one without the other would leave the page
  // showing a consistent-looking mixture of two different moments.
  tags: ["content"],
  // Seconds, and the ceiling on how stale this can get. See the note above:
  // the tag misses every write that does not go through the app.
  revalidate: 60,
});

export async function cachedContentData(ws: string): Promise<RawContentData> {
  return cached(ws);
}
