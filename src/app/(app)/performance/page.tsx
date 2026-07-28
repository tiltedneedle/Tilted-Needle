import PageHeader from "@/components/PageHeader";
import PerformanceView from "@/components/PerformanceView";
import ClientDashboard from "@/components/ClientDashboard";
import PersonDashboard from "@/components/PersonDashboard";
import ContentDetail, { type AnalyticsRow, type SnapshotRow } from "@/components/ContentDetail";
import DashboardFilters from "@/components/DashboardFilters";
import TeamRoster from "@/components/TeamRoster";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { one } from "@/lib/types";
import { totalsByPlatform, type MetricRow } from "@/lib/rollup";
import { buildRoster, computeRankings } from "@/lib/performanceData";
import type {
  Account,
  Client,
  ContentAssignment,
  ContentItem,
  PlatformPost,
  Role,
} from "@/lib/types";

/**
 * The dashboard (PRD §1.1). One route, one set of filters -- client, video,
 * person -- that combine to pick which section renders below. This replaces
 * the four separate pages that used to carry this content (performance,
 * performance/[userId], clients/[id], content/[id]); those routes now just
 * redirect here so there is exactly one place this data lives.
 */
export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; video?: string; person?: string }>;
}) {
  const { client: clientId, video: videoId, person: personId } = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;

  const [clientsRes, videosRes, membersRes, rankings] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name")
      .eq("workspace_id", ws)
      .eq("is_archived", false)
      .order("name"),
    supabase
      .from("content_items")
      .select("id, title, client_id")
      .eq("workspace_id", ws)
      .order("title"),
    supabase
      .from("memberships")
      .select("user_id, profile:profiles(full_name)")
      .eq("workspace_id", ws)
      .eq("is_active", true),
    computeRankings(supabase, ws),
  ]);

  type Member = { user_id: string; profile: { full_name: string | null } | { full_name: string | null }[] | null };
  const members = ((membersRes.data ?? []) as unknown as Member[]).map((m) => ({
    userId: m.user_id,
    name: one(m.profile)?.full_name ?? "Unknown",
  }));

  const roster = buildRoster(members, rankings);

  const filterProps = {
    clients: (clientsRes.data ?? []) as { id: string; name: string }[],
    videos: ((videosRes.data ?? []) as { id: string; title: string; client_id: string | null }[]).map(
      (v) => ({ id: v.id, title: v.title, clientId: v.client_id }),
    ),
    people: members.map((m) => ({ id: m.userId, name: m.name })),
    selected: {
      clientId: clientId ?? null,
      videoId: videoId ?? null,
      personId: personId ?? null,
    },
  };

  let title = "Performance";
  let subtitle = "Each platform is scored on its own baseline. The overall is their average, never a pooled total.";
  let body: React.ReactNode;

  if (videoId) {
    const view = await loadVideoView(supabase, ws, videoId);
    if (view) {
      title = view.item.title;
      subtitle = one(view.item.client)?.name ?? "No client";
      body = (
        <ContentDetail
          workspaceId={ws}
          item={view.item}
          posts={view.posts}
          accounts={view.accounts}
          roles={view.roles}
          assignments={view.assignments}
          members={members}
          trackedSeconds={view.trackedSeconds}
          history={view.history}
          analytics={view.analytics}
          clients={view.clients}
        />
      );
    } else {
      body = <div className="card p-8 text-sm text-[var(--muted)]">That video was not found.</div>;
    }
  } else if (clientId) {
    const view = await loadClientView(supabase, ws, clientId);
    if (view) {
      title = view.client.name;
      subtitle = "What has been delivered for this client, kept separate by platform.";
      body = (
        <ClientDashboard
          clientId={clientId}
          totals={view.totals}
          itemCount={view.itemCount}
          trackedSeconds={view.trackedSeconds}
          items={view.items}
        />
      );
    } else {
      body = <div className="card p-8 text-sm text-[var(--muted)]">That client was not found.</div>;
    }
  } else if (personId) {
    const view = await loadPersonView(supabase, ws, personId);
    if (view) {
      title = view.profile.full_name ?? "Unknown";
      subtitle = "Content this person is credited on, with reach kept separate by platform.";
      body = (
        <PersonDashboard
          totals={view.totals}
          roles={view.roles}
          trackedSeconds={view.trackedSeconds}
          items={view.items}
        />
      );
    } else {
      body = <div className="card p-8 text-sm text-[var(--muted)]">That person was not found.</div>;
    }
  } else {
    body = (
      <PerformanceView
        people={rankings.people}
        boosts={rankings.boosts}
        scoredPostCount={rankings.scoredByPost.size}
        totalPostCount={rankings.rawPostCount}
      />
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <PageHeader title={title} subtitle={subtitle} />
      <DashboardFilters {...filterProps} />
      {body}
      <TeamRoster rows={roster} />
    </div>
  );
}

async function loadClientView(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  ws: string,
  id: string,
) {
  const { data: client } = await supabase
    .from("clients")
    .select("id, name, email, is_archived")
    .eq("id", id)
    .eq("workspace_id", ws)
    .maybeSingle();
  if (!client) return null;

  const [itemsRes, postsRes, timeRes] = await Promise.all([
    supabase
      .from("content_items")
      .select("id, title, produced_at, length_seconds")
      .eq("workspace_id", ws)
      .eq("client_id", id)
      .order("produced_at", { ascending: false, nullsFirst: false }),
    supabase
      .from("platform_posts")
      .select(
        "id, content_item_id, account:accounts(platform_slug, client_id), metrics:post_current_metrics(views, likes, comments)",
      )
      .eq("workspace_id", ws),
    supabase
      .from("time_entries")
      .select("duration_seconds, content_item_id")
      .eq("workspace_id", ws)
      .not("content_item_id", "is", null)
      .not("ended_at", "is", null),
  ]);

  type Item = { id: string; title: string; produced_at: string | null; length_seconds: number | null };
  const items = (itemsRes.data ?? []) as Item[];
  const itemIds = new Set(items.map((i) => i.id));

  type PostRow = {
    id: string;
    content_item_id: string;
    account: { platform_slug: string; client_id: string | null } | { platform_slug: string; client_id: string | null }[] | null;
    metrics:
      | { views: number | null; likes: number | null; comments: number | null }
      | { views: number | null; likes: number | null; comments: number | null }[]
      | null;
  };

  const metricRows: MetricRow[] = [];
  const perItem = new Map<string, { platform: string; views: number }[]>();

  for (const p of (postsRes.data ?? []) as unknown as PostRow[]) {
    if (!itemIds.has(p.content_item_id)) continue;
    const acct = one(p.account);
    if (!acct) continue;
    const m = one(p.metrics);
    metricRows.push({
      platform: acct.platform_slug,
      views: m?.views ?? 0,
      likes: m?.likes ?? 0,
      comments: m?.comments ?? 0,
    });
    if (!perItem.has(p.content_item_id)) perItem.set(p.content_item_id, []);
    perItem.get(p.content_item_id)!.push({ platform: acct.platform_slug, views: m?.views ?? 0 });
  }

  let totalSeconds = 0;
  for (const t of (timeRes.data ?? []) as { duration_seconds: number | null; content_item_id: string | null }[]) {
    if (t.content_item_id && itemIds.has(t.content_item_id)) {
      totalSeconds += t.duration_seconds ?? 0;
    }
  }

  return {
    client,
    totals: totalsByPlatform(metricRows),
    itemCount: items.length,
    trackedSeconds: totalSeconds,
    items: items.map((i) => ({
      id: i.id,
      title: i.title,
      producedAt: i.produced_at,
      platforms: perItem.get(i.id) ?? [],
    })),
  };
}

async function loadPersonView(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  ws: string,
  userId: string,
) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) return null;

  const [assignRes, postsRes, timeRes] = await Promise.all([
    supabase
      .from("content_assignments")
      .select(
        "content_item_id, role:roles(slug, name), content:content_items(id, title, produced_at, client:clients(name))",
      )
      .eq("workspace_id", ws)
      .eq("user_id", userId),
    supabase
      .from("platform_posts")
      .select(
        "content_item_id, account:accounts(platform_slug), metrics:post_current_metrics(views, likes, comments)",
      )
      .eq("workspace_id", ws),
    supabase
      .from("time_entries")
      .select("duration_seconds, content_item_id")
      .eq("workspace_id", ws)
      .eq("user_id", userId)
      .not("ended_at", "is", null),
  ]);

  type Assign = {
    content_item_id: string;
    role: { slug: string; name: string } | { slug: string; name: string }[] | null;
    content:
      | { id: string; title: string; produced_at: string | null; client: { name: string } | { name: string }[] | null }
      | { id: string; title: string; produced_at: string | null; client: { name: string } | { name: string }[] | null }[]
      | null;
  };

  const assigns = (assignRes.data ?? []) as unknown as Assign[];
  const creditedItems = new Set(assigns.map((a) => a.content_item_id));

  type PostRow = {
    content_item_id: string;
    account: { platform_slug: string } | { platform_slug: string }[] | null;
    metrics:
      | { views: number | null; likes: number | null; comments: number | null }
      | { views: number | null; likes: number | null; comments: number | null }[]
      | null;
  };

  const metricRows: MetricRow[] = [];
  const perItem = new Map<string, { platform: string; views: number }[]>();

  for (const p of (postsRes.data ?? []) as unknown as PostRow[]) {
    if (!creditedItems.has(p.content_item_id)) continue;
    const acct = one(p.account);
    if (!acct) continue;
    const m = one(p.metrics);
    metricRows.push({
      platform: acct.platform_slug,
      views: m?.views ?? 0,
      likes: m?.likes ?? 0,
      comments: m?.comments ?? 0,
    });
    if (!perItem.has(p.content_item_id)) perItem.set(p.content_item_id, []);
    perItem.get(p.content_item_id)!.push({ platform: acct.platform_slug, views: m?.views ?? 0 });
  }

  const roleCounts = new Map<string, number>();
  const seen = new Set<string>();
  const items: {
    id: string;
    title: string;
    producedAt: string | null;
    clientName: string | null;
    roles: string[];
    platforms: { platform: string; views: number }[];
  }[] = [];

  for (const a of assigns) {
    const role = one(a.role);
    const content = one(a.content);
    if (role) roleCounts.set(role.name, (roleCounts.get(role.name) ?? 0) + 1);
    if (!content || seen.has(content.id)) continue;
    seen.add(content.id);
    items.push({
      id: content.id,
      title: content.title,
      producedAt: content.produced_at,
      clientName: one(content.client)?.name ?? null,
      roles: assigns
        .filter((x) => x.content_item_id === content.id)
        .map((x) => one(x.role)?.name)
        .filter((n): n is string => !!n),
      platforms: perItem.get(content.id) ?? [],
    });
  }
  items.sort((a, b) => (b.producedAt ?? "").localeCompare(a.producedAt ?? ""));

  const trackedSeconds = (
    (timeRes.data ?? []) as { duration_seconds: number | null; content_item_id: string | null }[]
  ).reduce((s, t) => s + (t.duration_seconds ?? 0), 0);

  return {
    profile,
    totals: totalsByPlatform(metricRows),
    roles: [...roleCounts.entries()].map(([name, count]) => ({ name, count })),
    trackedSeconds,
    items,
  };
}

async function loadVideoView(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  ws: string,
  id: string,
) {
  const { data: item } = await supabase
    .from("content_items")
    .select(
      "id, workspace_id, client_id, title, subject, hook, music_used, length_seconds, produced_at, notes, client:clients(id, name)",
    )
    .eq("id", id)
    .eq("workspace_id", ws)
    .maybeSingle();
  if (!item) return null;

  const [postsRes, accountsRes, rolesRes, assignRes, timeRes, clientsRes] = await Promise.all([
    supabase
      .from("platform_posts")
      .select(
        `id, workspace_id, content_item_id, account_id, url, posted_at, source,
         is_best_performing, comment_sentiment,
         account:accounts(id, platform_slug, handle, connection_mode),
         metrics:post_current_metrics(views, likes, comments, shares, saves, reach, captured_at)`,
      )
      .eq("content_item_id", id),
    supabase
      .from("accounts")
      .select("id, workspace_id, client_id, platform_slug, handle, connection_mode, is_archived")
      .eq("workspace_id", ws)
      .eq("is_archived", false)
      .order("platform_slug"),
    supabase
      .from("roles")
      .select("id, workspace_id, slug, name, sort_order")
      .eq("workspace_id", ws)
      .order("sort_order"),
    supabase
      .from("content_assignments")
      .select("id, content_item_id, user_id, role_id, source, profile:profiles(full_name)")
      .eq("content_item_id", id),
    supabase
      .from("time_entries")
      .select("duration_seconds, user_id")
      .eq("content_item_id", id)
      .not("ended_at", "is", null),
    supabase
      .from("clients")
      .select("id, workspace_id, name, email, is_archived")
      .eq("workspace_id", ws)
      .order("name"),
  ]);

  const postIds = ((postsRes.data ?? []) as { id: string }[]).map((p) => p.id);
  const historyRes = postIds.length
    ? await supabase
        .from("post_snapshots")
        .select("platform_post_id, captured_at, views, likes, comments, shares, saves")
        .in("platform_post_id", postIds)
        .order("captured_at", { ascending: false })
    : { data: [] };

  const analyticsRes = postIds.length
    ? await supabase
        .from("post_analytics")
        .select(
          "platform_post_id, captured_at, impressions, ctr, avg_watch_seconds, retention_30s, retention_60s, source",
        )
        .in("platform_post_id", postIds)
        .order("captured_at", { ascending: false })
    : { data: [] };

  const timeRows = (timeRes.data ?? []) as { duration_seconds: number | null }[];
  const totalSeconds = timeRows.reduce((s, r) => s + (r.duration_seconds ?? 0), 0);

  return {
    item: item as unknown as ContentItem,
    posts: (postsRes.data ?? []) as unknown as PlatformPost[],
    accounts: (accountsRes.data ?? []) as unknown as Account[],
    roles: (rolesRes.data ?? []) as unknown as Role[],
    assignments: (assignRes.data ?? []) as unknown as ContentAssignment[],
    trackedSeconds: totalSeconds,
    history: (historyRes.data ?? []) as SnapshotRow[],
    analytics: (analyticsRes.data ?? []) as AnalyticsRow[],
    clients: (clientsRes.data ?? []) as unknown as Client[],
  };
}
