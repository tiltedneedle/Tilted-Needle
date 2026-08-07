/**
 * Aggregate loaders and filtering behind the two single-page dashboards.
 *
 * There are exactly two: Content (clients + videos) and People (employees).
 * Everything either page renders is assembled here, so a figure shown on the
 * roster and the same figure shown on a person's detail view can never be
 * computed two different ways.
 *
 * Platform metrics stay bucketed by platform throughout. There is no function
 * here that returns a single combined view count -- a view is a different unit
 * on every platform, so a pooled total would look authoritative and mean
 * nothing (PRD 5 Step 2).
 *
 * Filtering is applied *after* loading rather than pushed into SQL. The row
 * counts here are small (a workspace's whole content library), and doing it in
 * one place in TypeScript keeps every filter composable with every other one
 * without a combinatorial explosion of query builders.
 */
import { one } from "@/lib/types";
import { selectAll } from "@/lib/selectAll";
import { totalsByPlatform, type MetricRow, type PlatformTotals } from "@/lib/rollup";
import type { RankingsResult } from "@/lib/performanceData";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

export type VideoSummary = {
  id: string;
  title: string;
  clientId: string | null;
  clientName: string | null;
  producedAt: string | null;
  lengthSeconds: number | null;
  platforms: { platform: string; views: number; likes: number; comments: number }[];
  trackedSeconds: number;
  /** Highest boost index across this video's posts, when it has been scored. */
  bestIndex: number | null;
  postCount: number;
  /**
   * Who is credited on this video, in which role. Carried on every video the
   * dashboards list, not just the single-video view, so the five role circles
   * can render (and be assigned) directly from a tile.
   */
  credits: {
    assignmentId: string;
    roleSlug: string;
    userId: string;
    userName: string;
  }[];
  /**
   * Views gained between the two most recent snapshots, summed within the
   * filtered platforms, with the interval those snapshots actually span.
   *
   * Deliberately not a fixed "last 7 days" window: snapshots are recorded by
   * hand at irregular intervals, so a fixed window silently reports nothing
   * whenever the cadence does not happen to match it. Reporting the real
   * interval alongside the number is both always available and honest about
   * what it covers. Null when there is only one snapshot -- which is
   * different from "gained nothing", and is shown as such rather than zero.
   */
  recentGain: { views: number; days: number } | null;
};

export type ClientSummary = {
  id: string;
  name: string;
  videoCount: number;
  postCount: number;
  totals: PlatformTotals[];
  trackedSeconds: number;
  /** Views gained across this client's content since the previous snapshots. */
  recentGain: number;
};

export type ContentOverview = {
  videos: VideoSummary[];
  clients: ClientSummary[];
  platformTotals: PlatformTotals[];
  /** Every platform enabled in this workspace, for the filter dropdown. */
  platformOptions: { slug: string; name: string }[];
  totals: {
    videos: number;
    posts: number;
    clients: number;
    trackedSeconds: number;
    published: number;
    unpublished: number;
  };
};

export type ContentFilters = {
  platform?: string | null;
  /** "published" | "unpublished" | "boosting" */
  status?: string | null;
  /** Free-text match on the title. */
  q?: string | null;
  /** Multi-select: a video matches when its client is ANY of these (OR). */
  clientIds?: string[];
  /** Multi-select: a video matches when ANY of these people is credited (OR). */
  personIds?: string[];
  /**
   * Inclusive Dubai dates. Filters videos by produced_at AND windows the
   * growth metrics: gains become the sum of snapshot deltas landing inside
   * the range, so "last 2 weeks" answers "what moved in the last 2 weeks",
   * not "what was made recently and what moved ever" (PRD v0.5 §2.4).
   */
  from?: string | null;
  to?: string | null;
};

/** Rebuilds the derived rollups so every filtered view stays self-consistent. */
function deriveContent(
  videos: VideoSummary[],
  activeClients: { id: string; name: string }[],
  platformOptions: { slug: string; name: string }[],
): ContentOverview {
  const allRows: MetricRow[] = videos.flatMap((v) => v.platforms);

  // Every active client appears, including ones with nothing matching. A
  // client the team has delivered nothing for is a fact worth seeing, and
  // dropping the row hides it behind an absence that reads as "no data".
  const clients: ClientSummary[] = activeClients
    .map(({ id, name }) => {
      const mine = videos.filter((v) => v.clientId === id);
      return {
        id,
        name,
        videoCount: mine.length,
        postCount: mine.reduce((s, v) => s + v.postCount, 0),
        totals: totalsByPlatform(mine.flatMap((v) => v.platforms)),
        trackedSeconds: mine.reduce((s, v) => s + v.trackedSeconds, 0),
        recentGain: mine.reduce((s, v) => s + (v.recentGain?.views ?? 0), 0),
      };
    })
    .sort((a, b) => b.videoCount - a.videoCount);

  const published = videos.filter((v) => v.postCount > 0).length;

  return {
    videos,
    clients,
    platformTotals: totalsByPlatform(allRows),
    platformOptions,
    totals: {
      videos: videos.length,
      posts: videos.reduce((s, v) => s + v.postCount, 0),
      clients: clients.length,
      trackedSeconds: videos.reduce((s, v) => s + v.trackedSeconds, 0),
      published,
      unpublished: videos.length - published,
    },
  };
}

/**
 * Everything the Content dashboard needs, already narrowed by whichever
 * filters are active. Filters compose: platform + period + person + status +
 * search all apply together.
 */
export async function loadContentOverview(
  supabase: Db,
  ws: string,
  rankings: RankingsResult,
  filters: ContentFilters = {},
): Promise<ContentOverview> {
  // Anything reading a whole unbounded table pages -- a 1000-row cap would
  // silently drop videos, posts and hours off the dashboard (see selectAll).
  const [itemsRes, postsRes, timeRes, clientsRes, platformsRes, snapsRes] = await Promise.all([
    selectAll(() =>
      supabase
        .from("content_items")
        .select("id, title, produced_at, length_seconds, client_id, client:clients(id, name)")
        .eq("workspace_id", ws)
        .order("produced_at", { ascending: false, nullsFirst: false })
        .order("id"),
    ),
    selectAll(() =>
      supabase
        .from("platform_posts")
        .select(
          "id, content_item_id, account:accounts(platform_slug), metrics:post_current_metrics(views, likes, comments)",
        )
        .eq("workspace_id", ws)
        .order("id"),
    ),
    selectAll(() =>
      supabase
        .from("time_entries")
        .select("id, duration_seconds, content_item_id")
        .eq("workspace_id", ws)
        .not("content_item_id", "is", null)
        .not("ended_at", "is", null)
        .order("id"),
    ),
    supabase.from("clients").select("id, name, is_archived").eq("workspace_id", ws).order("name"),
    supabase
      .from("platforms")
      .select("slug, display_name")
      .eq("is_enabled", true)
      .order("sort_order"),
    selectAll(() =>
      supabase
        .from("post_snapshots")
        .select("id, platform_post_id, captured_at, views")
        .eq("workspace_id", ws)
        .order("captured_at")
        .order("id"),
    ),
  ]);

  type Item = {
    id: string;
    title: string;
    produced_at: string | null;
    length_seconds: number | null;
    client_id: string | null;
    client: { id: string; name: string } | { id: string; name: string }[] | null;
  };
  type PostRow = {
    id: string;
    content_item_id: string;
    account: { platform_slug: string } | { platform_slug: string }[] | null;
    metrics:
      | { views: number | null; likes: number | null; comments: number | null }
      | { views: number | null; likes: number | null; comments: number | null }[]
      | null;
  };

  const items = (itemsRes.data ?? []) as unknown as Item[];
  const posts = (postsRes.data ?? []) as unknown as PostRow[];

  const secondsByItem = new Map<string, number>();
  for (const t of (timeRes.data ?? []) as {
    duration_seconds: number | null;
    content_item_id: string | null;
  }[]) {
    if (!t.content_item_id) continue;
    secondsByItem.set(
      t.content_item_id,
      (secondsByItem.get(t.content_item_id) ?? 0) + (t.duration_seconds ?? 0),
    );
  }

  // Snapshot series per post, so recent growth can be read off the history
  // rather than inferred from a single current number.
  const seriesByPost = new Map<string, { at: number; views: number }[]>();
  for (const s of (snapsRes.data ?? []) as {
    platform_post_id: string;
    captured_at: string;
    views: number | null;
  }[]) {
    if (s.views == null) continue;
    if (!seriesByPost.has(s.platform_post_id)) seriesByPost.set(s.platform_post_id, []);
    seriesByPost
      .get(s.platform_post_id)!
      .push({ at: new Date(s.captured_at).getTime(), views: s.views });
  }

  // Range bounds as instants: from 00:00 Dubai on `from` through 24:00
  // Dubai on `to` (both inclusive). Dubai is fixed UTC+4, no DST.
  const rangeStart = filters.from ? new Date(`${filters.from}T00:00:00+04:00`).getTime() : null;
  const rangeEnd = filters.to ? new Date(`${filters.to}T00:00:00+04:00`).getTime() + 86400000 : null;

  /**
   * A post's growth. Without a range: the delta between its last two
   * readings (the long-standing "still growing" semantic). With a range:
   * the sum of positive deltas whose LATER reading landed inside it, so
   * the figure answers "what moved in this window" (PRD v0.5 §2.4).
   * Negative platform corrections are clamped in the windowed mode only --
   * the unwindowed last-two delta keeps showing a real drop as a drop.
   */
  function gainForPost(postId: string): { views: number; days: number } | null {
    const series = seriesByPost.get(postId);
    if (!series || series.length < 2) return null;

    if (rangeStart == null && rangeEnd == null) {
      const latest = series[series.length - 1];
      const prev = series[series.length - 2];
      return {
        views: latest.views - prev.views,
        days: Math.max(0, (latest.at - prev.at) / 86400000),
      };
    }

    let views = 0;
    let first: number | null = null;
    let last: number | null = null;
    for (let i = 1; i < series.length; i++) {
      const at = series[i].at;
      if (rangeStart != null && at < rangeStart) continue;
      if (rangeEnd != null && at >= rangeEnd) break;
      views += Math.max(0, series[i].views - series[i - 1].views);
      if (first == null) first = series[i - 1].at;
      last = at;
    }
    if (last == null || first == null) return null;
    return { views, days: Math.max(0, (last - first) / 86400000) };
  }

  const byItem = new Map<string, VideoSummary["platforms"]>();
  const postsByItem = new Map<string, number>();
  const gainByItem = new Map<string, { views: number; days: number }>();
  for (const p of posts) {
    const acct = one(p.account);
    if (!acct) continue;
    // A platform filter narrows which posts count at all -- so reach, post
    // counts and the client table all describe that platform alone.
    if (filters.platform && acct.platform_slug !== filters.platform) continue;
    const m = one(p.metrics);
    if (!byItem.has(p.content_item_id)) byItem.set(p.content_item_id, []);
    byItem.get(p.content_item_id)!.push({
      platform: acct.platform_slug,
      views: m?.views ?? 0,
      likes: m?.likes ?? 0,
      comments: m?.comments ?? 0,
    });
    postsByItem.set(p.content_item_id, (postsByItem.get(p.content_item_id) ?? 0) + 1);

    const gain = gainForPost(p.id);
    if (gain != null) {
      const acc = gainByItem.get(p.content_item_id);
      // Views add up within the item; the interval shown is the widest of
      // its posts, so the figure is never claimed to cover less than it does.
      gainByItem.set(p.content_item_id, {
        views: (acc?.views ?? 0) + gain.views,
        days: Math.max(acc?.days ?? 0, gain.days),
      });
    }
  }

  const bestIndexByItem = new Map<string, number>();
  for (const [contentId, scored] of rankings.scoredByContent) {
    const relevant = filters.platform
      ? scored.filter((s) => s.platform === filters.platform)
      : scored;
    const best = relevant.reduce((max, s) => Math.max(max, s.index), 0);
    if (best > 0) bestIndexByItem.set(contentId, best);
  }

  // Credits come off the rankings load, which already reads every assignment
  // in the workspace -- no second query for the same rows.
  const creditsByItem = new Map<string, VideoSummary["credits"]>();
  for (const a of rankings.assignments) {
    if (!creditsByItem.has(a.content_item_id)) creditsByItem.set(a.content_item_id, []);
    creditsByItem.get(a.content_item_id)!.push({
      assignmentId: a.id,
      roleSlug: a.roleSlug,
      userId: a.user_id,
      userName: a.userName,
    });
  }

  let videos: VideoSummary[] = items.map((i) => ({
    id: i.id,
    title: i.title,
    clientId: i.client_id,
    clientName: one(i.client)?.name ?? null,
    producedAt: i.produced_at,
    lengthSeconds: i.length_seconds,
    platforms: byItem.get(i.id) ?? [],
    trackedSeconds: secondsByItem.get(i.id) ?? 0,
    bestIndex: bestIndexByItem.get(i.id) ?? null,
    postCount: postsByItem.get(i.id) ?? 0,
    credits: creditsByItem.get(i.id) ?? [],
    recentGain: gainByItem.get(i.id) ?? null,
  }));

  /* ---- Filters -----------------------------------------------------------
     PRD v0.5 §2.1: within a dimension OR, across dimensions AND. Each
     filter below is an independent intersection over the same population,
     which is what makes selection order structurally irrelevant. */

  // A platform filter implies "posted on that platform" -- a video with no
  // post there has nothing to say about it.
  if (filters.platform) videos = videos.filter((v) => v.postCount > 0);

  if (filters.from) {
    videos = videos.filter((v) => v.producedAt != null && v.producedAt >= filters.from!);
  }
  if (filters.to) {
    videos = videos.filter((v) => v.producedAt != null && v.producedAt <= filters.to!);
  }

  if (filters.clientIds && filters.clientIds.length > 0) {
    const wanted = new Set(filters.clientIds);
    videos = videos.filter((v) => v.clientId != null && wanted.has(v.clientId));
  }

  if (filters.personIds && filters.personIds.length > 0) {
    const wanted = new Set(filters.personIds);
    const theirs = new Set(
      rankings.assignments
        .filter((a) => wanted.has(a.user_id))
        .map((a) => a.content_item_id),
    );
    videos = videos.filter((v) => theirs.has(v.id));
  }

  if (filters.status === "published") videos = videos.filter((v) => v.postCount > 0);
  else if (filters.status === "unpublished") videos = videos.filter((v) => v.postCount === 0);
  else if (filters.status === "boosting")
    videos = videos.filter((v) => v.bestIndex != null && v.bestIndex >= 2);

  if (filters.q?.trim()) {
    const needle = filters.q.trim().toLowerCase();
    videos = videos.filter((v) => v.title.toLowerCase().includes(needle));
  }

  const clientRows = (clientsRes.data ?? []) as {
    id: string;
    name: string;
    is_archived: boolean;
  }[];
  const platformOptions = (
    (platformsRes.data ?? []) as { slug: string; display_name: string }[]
  ).map((p) => ({ slug: p.slug, name: p.display_name }));

  return deriveContent(
    videos,
    clientRows.filter((c) => !c.is_archived).map((c) => ({ id: c.id, name: c.name })),
    platformOptions,
  );
}

/** Unfiltered client list, so the dropdown does not shrink as filters narrow. */
export async function loadClientOptions(supabase: Db, ws: string) {
  const { data } = await supabase
    .from("clients")
    .select("id, name")
    .eq("workspace_id", ws)
    .eq("is_archived", false)
    .order("name");
  return (data ?? []) as { id: string; name: string }[];
}

/**
 * The workspace's content roles, in display order.
 *
 * Roles are rows, not an enum (PRD 6.6), so the credit circles render whatever
 * this returns rather than assuming the five seeded ones.
 */
export async function loadRoles(supabase: Db, ws: string) {
  const { data } = await supabase
    .from("roles")
    .select("id, slug, name")
    .eq("workspace_id", ws)
    .order("sort_order");
  return (data ?? []) as { id: string; slug: string; name: string }[];
}

/** Active members, for the assignee pickers on content tiles. */
export async function loadMemberOptions(supabase: Db, ws: string) {
  const { data } = await supabase
    .from("memberships")
    .select("user_id, profile:profiles(full_name)")
    .eq("workspace_id", ws)
    .eq("is_active", true);
  type Row = {
    user_id: string;
    profile: { full_name: string | null } | { full_name: string | null }[] | null;
  };
  return ((data ?? []) as unknown as Row[])
    .map((m) => ({
      userId: m.user_id,
      name: one(m.profile)?.full_name ?? "Unknown",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Monday 00:00 in Asia/Dubai -- the company's operating timezone, matching
 * the To-dos sheet's definition of "today". Server-local math here (UTC on
 * Vercel) started the week 4 hours late: hours tracked between midnight
 * and 4am Dubai on a Monday counted into the previous week. Dubai is fixed
 * UTC+4 with no DST, so the instant can be built literally.
 */
export function startOfWeek(now = new Date()): Date {
  const dubaiDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(now);
  // That calendar date's weekday; noon UTC sidesteps any rollover edge.
  const dow = (new Date(`${dubaiDate}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  return new Date(new Date(`${dubaiDate}T00:00:00+04:00`).getTime() - dow * 86400000);
}
