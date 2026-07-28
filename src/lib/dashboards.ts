/**
 * Aggregate loaders behind the two single-page dashboards.
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
 */
import { one } from "@/lib/types";
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
};

export type ClientSummary = {
  id: string;
  name: string;
  videoCount: number;
  postCount: number;
  totals: PlatformTotals[];
  trackedSeconds: number;
};

export type ContentOverview = {
  videos: VideoSummary[];
  clients: ClientSummary[];
  platformTotals: PlatformTotals[];
  totals: {
    videos: number;
    posts: number;
    clients: number;
    trackedSeconds: number;
    published: number;
    unpublished: number;
  };
};

/**
 * Everything the Content dashboard needs in its unfiltered state, plus the
 * per-video and per-client rows its filters slice into.
 */
export async function loadContentOverview(
  supabase: Db,
  ws: string,
  rankings: RankingsResult,
): Promise<ContentOverview> {
  const [itemsRes, postsRes, timeRes, clientsRes] = await Promise.all([
    supabase
      .from("content_items")
      .select("id, title, produced_at, length_seconds, client_id, client:clients(id, name)")
      .eq("workspace_id", ws)
      .order("produced_at", { ascending: false, nullsFirst: false }),
    supabase
      .from("platform_posts")
      .select(
        "id, content_item_id, account:accounts(platform_slug), metrics:post_current_metrics(views, likes, comments)",
      )
      .eq("workspace_id", ws),
    supabase
      .from("time_entries")
      .select("duration_seconds, content_item_id")
      .eq("workspace_id", ws)
      .not("content_item_id", "is", null)
      .not("ended_at", "is", null),
    supabase
      .from("clients")
      .select("id, name, is_archived")
      .eq("workspace_id", ws)
      .order("name"),
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

  // Tracked seconds per content item.
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

  // Per-item platform rows, and the workspace-wide metric pool for the
  // per-platform strip at the top of the page.
  const byItem = new Map<string, VideoSummary["platforms"]>();
  const allMetricRows: MetricRow[] = [];
  const postsByItem = new Map<string, number>();

  for (const p of posts) {
    const acct = one(p.account);
    if (!acct) continue;
    const m = one(p.metrics);
    const row = {
      platform: acct.platform_slug,
      views: m?.views ?? 0,
      likes: m?.likes ?? 0,
      comments: m?.comments ?? 0,
    };
    if (!byItem.has(p.content_item_id)) byItem.set(p.content_item_id, []);
    byItem.get(p.content_item_id)!.push(row);
    postsByItem.set(p.content_item_id, (postsByItem.get(p.content_item_id) ?? 0) + 1);
    allMetricRows.push(row);
  }

  // Best boost index per content item, from the already-computed scoring pass.
  const bestIndexByItem = new Map<string, number>();
  for (const [contentId, scored] of rankings.scoredByContent) {
    const best = scored.reduce((max, s) => Math.max(max, s.index), 0);
    if (best > 0) bestIndexByItem.set(contentId, best);
  }

  const videos: VideoSummary[] = items.map((i) => ({
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
  }));

  // Per-client rollups, built from the videos so the two always agree.
  const clientRows = (clientsRes.data ?? []) as { id: string; name: string; is_archived: boolean }[];
  const clients: ClientSummary[] = clientRows
    .filter((c) => !c.is_archived)
    .map((c) => {
      const mine = videos.filter((v) => v.clientId === c.id);
      const rows: MetricRow[] = mine.flatMap((v) => v.platforms);
      return {
        id: c.id,
        name: c.name,
        videoCount: mine.length,
        postCount: mine.reduce((s, v) => s + v.postCount, 0),
        totals: totalsByPlatform(rows),
        trackedSeconds: mine.reduce((s, v) => s + v.trackedSeconds, 0),
      };
    })
    .sort((a, b) => b.videoCount - a.videoCount);

  const published = videos.filter((v) => v.postCount > 0).length;

  return {
    videos,
    clients,
    platformTotals: totalsByPlatform(allMetricRows),
    totals: {
      videos: videos.length,
      posts: posts.length,
      clients: clients.length,
      trackedSeconds: [...secondsByItem.values()].reduce((s, v) => s + v, 0),
      published,
      unpublished: videos.length - published,
    },
  };
}

/* ---- People ------------------------------------------------------------- */

export type PersonSummary = {
  userId: string;
  membershipId: string;
  name: string;
  workspaceRole: string;
  seat: string;
  isActive: boolean;
  capacityHours: number;
  groups: string[];
  /** Content roles they hold (Editor, Videographer, ...), not workspace role. */
  roles: string[];
  overall: number | null;
  /** Per-content-role score, so an editor is only ever ranked against editors. */
  byRole: {
    roleName: string;
    roleSlug: string;
    overall: number | null;
    platforms: { platform: string; score: number; n: number; rankable: boolean }[];
  }[];
  videoCount: number;
  ongoingCount: number;
  trackedSeconds: number;
  /** Reach on content they are credited on, kept per platform. */
  totals: PlatformTotals[];
};

export type PeopleOverview = {
  people: PersonSummary[];
  /** Content-role leaderboards: people ranked within a single role. */
  roleBoards: {
    roleName: string;
    rows: { userId: string; name: string; overall: number | null; n: number }[];
  }[];
  totals: {
    people: number;
    active: number;
    credited: number;
    trackedSeconds: number;
    capacityHours: number;
  };
};

export async function loadPeopleOverview(
  supabase: Db,
  ws: string,
  rankings: RankingsResult,
): Promise<PeopleOverview> {
  const [membersRes, timeRes, postsRes, groupsRes] = await Promise.all([
    supabase
      .from("memberships")
      .select(
        "id, user_id, role, seat, is_active, weekly_capacity_hours, profile:profiles(full_name)",
      )
      .eq("workspace_id", ws)
      .order("created_at"),
    supabase
      .from("time_entries")
      .select("duration_seconds, user_id")
      .eq("workspace_id", ws)
      .not("ended_at", "is", null),
    supabase
      .from("platform_posts")
      .select(
        "content_item_id, account:accounts(platform_slug), metrics:post_current_metrics(views, likes, comments)",
      )
      .eq("workspace_id", ws),
    supabase.from("user_groups").select("id, name").eq("workspace_id", ws).order("name"),
  ]);

  const groupRows = (groupsRes.data ?? []) as { id: string; name: string }[];
  const groupIds = groupRows.map((g) => g.id);
  const groupMembersRes = groupIds.length
    ? await supabase.from("user_group_members").select("group_id, user_id").in("group_id", groupIds)
    : { data: [] };

  type MemberRow = {
    id: string;
    user_id: string;
    role: string;
    seat: string;
    is_active: boolean;
    weekly_capacity_hours: number | string;
    profile: { full_name: string | null } | { full_name: string | null }[] | null;
  };
  const memberRows = (membersRes.data ?? []) as unknown as MemberRow[];

  const secondsByUser = new Map<string, number>();
  for (const t of (timeRes.data ?? []) as { duration_seconds: number | null; user_id: string }[]) {
    secondsByUser.set(t.user_id, (secondsByUser.get(t.user_id) ?? 0) + (t.duration_seconds ?? 0));
  }

  const groupNameById = new Map(groupRows.map((g) => [g.id, g.name]));
  const groupsByUser = new Map<string, string[]>();
  for (const gm of (groupMembersRes.data ?? []) as { group_id: string; user_id: string }[]) {
    const name = groupNameById.get(gm.group_id);
    if (!name) continue;
    if (!groupsByUser.has(gm.user_id)) groupsByUser.set(gm.user_id, []);
    groupsByUser.get(gm.user_id)!.push(name);
  }

  // Content credited to each person, and the roles they held on it.
  const contentByUser = new Map<string, Set<string>>();
  const ongoingByUser = new Map<string, Set<string>>();
  const roleNamesByUser = new Map<string, Set<string>>();
  for (const a of rankings.assignments) {
    if (!contentByUser.has(a.user_id)) contentByUser.set(a.user_id, new Set());
    contentByUser.get(a.user_id)!.add(a.content_item_id);
    if (!roleNamesByUser.has(a.user_id)) roleNamesByUser.set(a.user_id, new Set());
    roleNamesByUser.get(a.user_id)!.add(a.roleName);
    if (!rankings.postedContentIds.has(a.content_item_id)) {
      if (!ongoingByUser.has(a.user_id)) ongoingByUser.set(a.user_id, new Set());
      ongoingByUser.get(a.user_id)!.add(a.content_item_id);
    }
  }

  // Metrics per content item, so a person's reach is the reach of the content
  // they are credited on -- shared with everyone else credited on it.
  type PostRow = {
    content_item_id: string;
    account: { platform_slug: string } | { platform_slug: string }[] | null;
    metrics:
      | { views: number | null; likes: number | null; comments: number | null }
      | { views: number | null; likes: number | null; comments: number | null }[]
      | null;
  };
  const metricsByItem = new Map<string, MetricRow[]>();
  for (const p of (postsRes.data ?? []) as unknown as PostRow[]) {
    const acct = one(p.account);
    if (!acct) continue;
    const m = one(p.metrics);
    if (!metricsByItem.has(p.content_item_id)) metricsByItem.set(p.content_item_id, []);
    metricsByItem.get(p.content_item_id)!.push({
      platform: acct.platform_slug,
      views: m?.views ?? 0,
      likes: m?.likes ?? 0,
      comments: m?.comments ?? 0,
    });
  }

  // Per-person, per-content-role scores from the scoring pass.
  const byUserRole = new Map<string, RankingsResult["people"]>();
  for (const p of rankings.people) {
    if (!byUserRole.has(p.userId)) byUserRole.set(p.userId, []);
    byUserRole.get(p.userId)!.push(p);
  }

  const people: PersonSummary[] = memberRows.map((m) => {
    const credited = [...(contentByUser.get(m.user_id) ?? [])];
    const rows = credited.flatMap((id) => metricsByItem.get(id) ?? []);
    const roleScores = byUserRole.get(m.user_id) ?? [];
    const scored = roleScores.filter((r) => r.overall != null);

    return {
      userId: m.user_id,
      membershipId: m.id,
      name: one(m.profile)?.full_name ?? "Unknown",
      workspaceRole: m.role,
      seat: m.seat,
      isActive: m.is_active,
      capacityHours: Number(m.weekly_capacity_hours),
      groups: groupsByUser.get(m.user_id) ?? [],
      roles: [...(roleNamesByUser.get(m.user_id) ?? [])],
      overall: scored.length
        ? scored.reduce((s, r) => s + (r.overall ?? 0), 0) / scored.length
        : null,
      byRole: roleScores.map((r) => ({
        roleName: r.roleName,
        roleSlug: r.roleSlug,
        overall: r.overall,
        platforms: r.platforms,
      })),
      videoCount: credited.length,
      ongoingCount: ongoingByUser.get(m.user_id)?.size ?? 0,
      trackedSeconds: secondsByUser.get(m.user_id) ?? 0,
      totals: totalsByPlatform(rows),
    };
  });

  // Leaderboards are per content role: editors ranked against editors only.
  const boards = new Map<string, { userId: string; name: string; overall: number | null; n: number }[]>();
  for (const p of rankings.people) {
    if (!boards.has(p.roleName)) boards.set(p.roleName, []);
    boards.get(p.roleName)!.push({
      userId: p.userId,
      name: p.name,
      overall: p.overall,
      n: p.platforms.reduce((s, x) => s + x.n, 0),
    });
  }
  const roleBoards = [...boards.entries()]
    .map(([roleName, rows]) => ({
      roleName,
      rows: rows.sort((a, b) => (b.overall ?? -99) - (a.overall ?? -99)),
    }))
    .sort((a, b) => a.roleName.localeCompare(b.roleName));

  return {
    people,
    roleBoards,
    totals: {
      people: people.length,
      active: people.filter((p) => p.isActive).length,
      credited: people.filter((p) => p.videoCount > 0).length,
      trackedSeconds: [...secondsByUser.values()].reduce((s, v) => s + v, 0),
      capacityHours: people
        .filter((p) => p.isActive)
        .reduce((s, p) => s + (Number.isFinite(p.capacityHours) ? p.capacityHours : 0), 0),
    },
  };
}
