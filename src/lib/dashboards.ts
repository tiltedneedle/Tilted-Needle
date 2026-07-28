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
  /** Days back from today: "30" | "90" | "365". Null means all time. */
  period?: string | null;
  /** Only videos this person is credited on. */
  personId?: string | null;
  /** "published" | "unpublished" | "boosting" */
  status?: string | null;
  /** Free-text match on the title. */
  q?: string | null;
};

/** Rebuilds the derived rollups so every filtered view stays self-consistent. */
function deriveContent(
  videos: VideoSummary[],
  clientNames: Map<string, string>,
  platformOptions: { slug: string; name: string }[],
): ContentOverview {
  const allRows: MetricRow[] = videos.flatMap((v) => v.platforms);

  const clientIds = [...new Set(videos.map((v) => v.clientId).filter((c): c is string => !!c))];
  const clients: ClientSummary[] = clientIds
    .map((id) => {
      const mine = videos.filter((v) => v.clientId === id);
      return {
        id,
        name: clientNames.get(id) ?? "Unknown",
        videoCount: mine.length,
        postCount: mine.reduce((s, v) => s + v.postCount, 0),
        totals: totalsByPlatform(mine.flatMap((v) => v.platforms)),
        trackedSeconds: mine.reduce((s, v) => s + v.trackedSeconds, 0),
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
  const [itemsRes, postsRes, timeRes, clientsRes, platformsRes, snapsRes] = await Promise.all([
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
    supabase.from("clients").select("id, name, is_archived").eq("workspace_id", ws).order("name"),
    supabase
      .from("platforms")
      .select("slug, display_name")
      .eq("is_enabled", true)
      .order("sort_order"),
    supabase
      .from("post_snapshots")
      .select("platform_post_id, captured_at, views")
      .eq("workspace_id", ws)
      .order("captured_at"),
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

  /** Delta between the last two readings, with the interval they span. */
  function gainForPost(postId: string): { views: number; days: number } | null {
    const series = seriesByPost.get(postId);
    if (!series || series.length < 2) return null;
    const latest = series[series.length - 1];
    const prev = series[series.length - 2];
    return {
      views: latest.views - prev.views,
      days: Math.max(0, (latest.at - prev.at) / 86400000),
    };
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
    recentGain: gainByItem.get(i.id) ?? null,
  }));

  /* ---- Filters ---------------------------------------------------------- */

  // A platform filter implies "posted on that platform" -- a video with no
  // post there has nothing to say about it.
  if (filters.platform) videos = videos.filter((v) => v.postCount > 0);

  if (filters.period) {
    const days = Number(filters.period);
    if (Number.isFinite(days) && days > 0) {
      const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      videos = videos.filter((v) => v.producedAt != null && v.producedAt >= cutoff);
    }
  }

  if (filters.personId) {
    const theirs = new Set(
      rankings.assignments
        .filter((a) => a.user_id === filters.personId)
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
  const clientNames = new Map(clientRows.map((c) => [c.id, c.name]));
  const platformOptions = (
    (platformsRes.data ?? []) as { slug: string; display_name: string }[]
  ).map((p) => ({ slug: p.slug, name: p.display_name }));

  return deriveContent(videos, clientNames, platformOptions);
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
  /** Clients they have worked for, for the client filter. */
  clientIds: string[];
};

export type PeopleOverview = {
  people: PersonSummary[];
  /** Content-role leaderboards: people ranked within a single role. */
  roleBoards: {
    roleName: string;
    rows: { userId: string; name: string; overall: number | null; n: number }[];
  }[];
  groupOptions: string[];
  totals: {
    people: number;
    active: number;
    credited: number;
    trackedSeconds: number;
    capacityHours: number;
  };
};

export type PeopleFilters = {
  /** Content role name, e.g. "Editor". */
  role?: string | null;
  group?: string | null;
  /** "full" | "limited" */
  seat?: string | null;
  /** "active" | "inactive" */
  status?: string | null;
  /** Only people credited on this client's content. */
  clientId?: string | null;
  platform?: string | null;
  q?: string | null;
};

export async function loadPeopleOverview(
  supabase: Db,
  ws: string,
  rankings: RankingsResult,
  filters: PeopleFilters = {},
): Promise<PeopleOverview> {
  const [membersRes, timeRes, postsRes, groupsRes, itemsRes] = await Promise.all([
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
    supabase.from("content_items").select("id, client_id").eq("workspace_id", ws),
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

  const clientOfItem = new Map(
    ((itemsRes.data ?? []) as { id: string; client_id: string | null }[]).map((i) => [
      i.id,
      i.client_id,
    ]),
  );

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
    if (filters.platform && acct.platform_slug !== filters.platform) continue;
    const m = one(p.metrics);
    if (!metricsByItem.has(p.content_item_id)) metricsByItem.set(p.content_item_id, []);
    metricsByItem.get(p.content_item_id)!.push({
      platform: acct.platform_slug,
      views: m?.views ?? 0,
      likes: m?.likes ?? 0,
      comments: m?.comments ?? 0,
    });
  }

  const byUserRole = new Map<string, RankingsResult["people"]>();
  for (const p of rankings.people) {
    if (!byUserRole.has(p.userId)) byUserRole.set(p.userId, []);
    byUserRole.get(p.userId)!.push(p);
  }

  let people: PersonSummary[] = memberRows.map((m) => {
    const credited = [...(contentByUser.get(m.user_id) ?? [])];
    const rows = credited.flatMap((id) => metricsByItem.get(id) ?? []);

    // A platform filter narrows each role's breakdown to that platform, and
    // recomputes the role's overall from what remains -- otherwise the
    // headline number would describe platforms the filter excluded.
    const roleScores = (byUserRole.get(m.user_id) ?? []).map((r) => {
      const platforms = filters.platform
        ? r.platforms.filter((p) => p.platform === filters.platform)
        : r.platforms;
      const rankable = platforms.filter((p) => p.rankable);
      return {
        roleName: r.roleName,
        roleSlug: r.roleSlug,
        overall: filters.platform
          ? rankable.length
            ? rankable.reduce((s, p) => s + p.score, 0) / rankable.length
            : null
          : r.overall,
        platforms,
      };
    });
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
      byRole: roleScores,
      videoCount: credited.length,
      ongoingCount: ongoingByUser.get(m.user_id)?.size ?? 0,
      trackedSeconds: secondsByUser.get(m.user_id) ?? 0,
      totals: totalsByPlatform(rows),
      clientIds: [
        ...new Set(
          credited.map((id) => clientOfItem.get(id)).filter((c): c is string => !!c),
        ),
      ],
    };
  });

  /* ---- Filters ---------------------------------------------------------- */

  if (filters.role) people = people.filter((p) => p.roles.includes(filters.role!));
  if (filters.group) people = people.filter((p) => p.groups.includes(filters.group!));
  if (filters.seat) people = people.filter((p) => p.seat === filters.seat);
  if (filters.status === "active") people = people.filter((p) => p.isActive);
  else if (filters.status === "inactive") people = people.filter((p) => !p.isActive);
  if (filters.clientId) people = people.filter((p) => p.clientIds.includes(filters.clientId!));
  if (filters.q?.trim()) {
    const needle = filters.q.trim().toLowerCase();
    people = people.filter((p) => p.name.toLowerCase().includes(needle));
  }

  // Leaderboards follow the same filtered population, so the ranking always
  // describes the set of people actually on screen.
  const visible = new Set(people.map((p) => p.userId));
  const boards = new Map<
    string,
    { userId: string; name: string; overall: number | null; n: number }[]
  >();
  for (const p of people) {
    for (const r of p.byRole) {
      if (!visible.has(p.userId)) continue;
      if (filters.role && r.roleName !== filters.role) continue;
      if (!boards.has(r.roleName)) boards.set(r.roleName, []);
      boards.get(r.roleName)!.push({
        userId: p.userId,
        name: p.name,
        overall: r.overall,
        n: r.platforms.reduce((s, x) => s + x.n, 0),
      });
    }
  }
  const roleBoards = [...boards.entries()]
    .map(([roleName, rows]) => ({
      roleName,
      rows: rows.sort((a, b) => (b.overall ?? -99) - (a.overall ?? -99)),
    }))
    .filter((b) => b.rows.length > 0)
    .sort((a, b) => a.roleName.localeCompare(b.roleName));

  return {
    people,
    roleBoards,
    groupOptions: groupRows.map((g) => g.name),
    totals: {
      people: people.length,
      active: people.filter((p) => p.isActive).length,
      credited: people.filter((p) => p.videoCount > 0).length,
      trackedSeconds: people.reduce((s, p) => s + p.trackedSeconds, 0),
      capacityHours: people
        .filter((p) => p.isActive)
        .reduce((s, p) => s + (Number.isFinite(p.capacityHours) ? p.capacityHours : 0), 0),
    },
  };
}
