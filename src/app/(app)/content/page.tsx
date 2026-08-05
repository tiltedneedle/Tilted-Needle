import PageHeader from "@/components/PageHeader";
import NewContentForm from "@/components/NewContentForm";
import ContentOverview from "@/components/ContentOverview";
import ContentDetail, { type AnalyticsRow, type SnapshotRow } from "@/components/ContentDetail";
import ClientDetail from "@/components/ClientDetail";
import FilterBar from "@/components/FilterBar";
import PlatformReach from "@/components/PlatformReach";
import { Stat, StatGrid, SectionHeading } from "@/components/Stat";
import { Clapperboard, Layers, TrendingUp, Timer } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { canManage, one } from "@/lib/types";
import { formatDurationShort } from "@/lib/format";
import { cachedRankings } from "@/lib/cachedRankings";
import { loadContentOverview, loadRoles } from "@/lib/dashboards";
import type {
  Account,
  Client,
  ContentAssignment,
  ContentItem,
  PlatformPost,
  Role,
} from "@/lib/types";

/**
 * Dashboard 1 of 2: Content.
 *
 * Everything about what was made and how it performed -- videos, the clients
 * they belong to, and the per-platform numbers behind them. People live on
 * the other dashboard (/team); the only person data here is the credit panel
 * on a single video, because that is a property of the video.
 *
 * Filters are query params, so any view of this page is a shareable URL.
 */
export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<{
    client?: string;
    video?: string;
    platform?: string;
    period?: string;
    person?: string;
    status?: string;
    q?: string;
  }>;
}) {
  const sp = await searchParams;
  const { client: clientId, video: videoId } = sp;
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;

  const manages = canManage(session.active.role);

  const rankings = await cachedRankings(ws);
  // The video-detail branch never renders the overview's tables or reach
  // cards, yet used to pay for the full overview load -- every post and
  // every snapshot -- just to fill the video-filter dropdown. On that
  // branch a bare title list and the platform registry are enough; the
  // full overview stays for the list and client views that actually
  // render it.
  const [overview, lightVideosRes, platformsRes, clientsRes, membersRes, workspaceRoles] =
    await Promise.all([
      videoId
        ? null
        : loadContentOverview(supabase, ws, rankings, {
            platform: sp.platform ?? null,
            period: sp.period ?? null,
            personId: sp.person ?? null,
            status: sp.status ?? null,
            q: sp.q ?? null,
          }),
      videoId
        ? supabase
            .from("content_items")
            .select("id, title, client_id")
            .eq("workspace_id", ws)
            .order("produced_at", { ascending: false, nullsFirst: false })
        : null,
      videoId
        ? supabase
            .from("platforms")
            .select("slug, display_name")
            .eq("is_enabled", true)
            .order("sort_order")
        : null,
      supabase
        .from("clients")
        .select("id, workspace_id, name, email, is_archived")
        .eq("workspace_id", ws)
        .order("name"),
      supabase
        .from("memberships")
        .select("user_id, profile:profiles(full_name)")
        .eq("workspace_id", ws)
        .eq("is_active", true),
      loadRoles(supabase, ws),
    ]);

  type Member = {
    user_id: string;
    profile: { full_name: string | null } | { full_name: string | null }[] | null;
  };
  const members = ((membersRes.data ?? []) as unknown as Member[]).map((m) => ({
    userId: m.user_id,
    name: one(m.profile)?.full_name ?? "Unknown",
  }));
  const allClients = (clientsRes.data ?? []) as unknown as Client[];

  // A video filter narrows to that video; a client filter narrows the video
  // dropdown to that client's work so the two compose sensibly.
  type LightVideo = { id: string; title: string; client_id: string | null };
  const videoOptions = (
    overview
      ? (clientId
          ? overview.videos.filter((v) => v.clientId === clientId)
          : overview.videos
        ).map((v) => ({ id: v.id, title: v.title }))
      : ((lightVideosRes?.data ?? []) as LightVideo[])
          .filter((v) => !clientId || v.client_id === clientId)
  ).map((v) => ({ value: v.id, label: v.title }));

  const platformOptions = overview
    ? overview.platformOptions
    : ((platformsRes?.data ?? []) as { slug: string; display_name: string }[]).map((p) => ({
        slug: p.slug,
        name: p.display_name,
      }));

  const filters = (
    <FilterBar
      basePath="/content"
      searchKey="q"
      searchValue={sp.q ?? null}
      searchPlaceholder="Search titles…"
      searchClears={["video"]}
      filters={[
        {
          key: "client",
          label: "Filter by client",
          allLabel: "All clients",
          value: clientId ?? null,
          // Options come from the unfiltered client list, so narrowing by
          // platform or period never makes a client unreachable.
          options: allClients
            .filter((c) => !c.is_archived)
            .map((c) => ({ value: c.id, label: c.name })),
          clears: ["video"],
        },
        {
          key: "video",
          label: "Filter by video",
          allLabel: clientId ? "All of this client's videos" : "All videos",
          value: videoId ?? null,
          options: videoOptions,
        },
        // Every population filter below clears the single-video drill-down:
        // a single video's view ignores them, so leaving ?video= in place
        // showed one video while the bar claimed a filtered list -- same
        // conflict the People page had with person vs personFilter.
        {
          key: "platform",
          label: "Filter by platform",
          allLabel: "All platforms",
          value: sp.platform ?? null,
          options: platformOptions.map((p) => ({ value: p.slug, label: p.name })),
          clears: ["video"],
        },
        {
          key: "person",
          label: "Filter by credited person",
          allLabel: "Anyone credited",
          value: sp.person ?? null,
          options: members.map((m) => ({ value: m.userId, label: m.name })),
          clears: ["video"],
        },
        {
          key: "period",
          label: "Filter by period",
          allLabel: "All time",
          value: sp.period ?? null,
          options: [
            { value: "30", label: "Last 30 days" },
            { value: "90", label: "Last 90 days" },
            { value: "365", label: "Last year" },
          ],
          clears: ["video"],
        },
        {
          key: "status",
          label: "Filter by status",
          allLabel: "Any status",
          value: sp.status ?? null,
          options: [
            { value: "published", label: "Published" },
            { value: "unpublished", label: "Not posted yet" },
            { value: "boosting", label: "Boosting (2×+)" },
          ],
          clears: ["video"],
        },
      ]}
    />
  );

  /* ---- Single video ----------------------------------------------------- */
  if (videoId) {
    const view = await loadVideoView(supabase, ws, videoId);
    if (!view) {
      return (
        <Shell title="Video" subtitle="Not found.">
          {filters}
          <div className="card p-8 text-sm text-[var(--muted)]">
            That video was not found in this workspace.
          </div>
        </Shell>
      );
    }
    // Standing of everyone credited on this video, in the role they hold on
    // it, plus how the video itself did against each account's baseline.
    const creditScores = rankings.people.map((p) => ({
      userId: p.userId,
      roleSlug: p.roleSlug,
      overall: p.overall,
      rankable: p.platforms.some((pl) => pl.rankable),
    }));
    const boostByPlatform: Record<string, number> = {};
    for (const s of rankings.scoredByContent.get(videoId) ?? []) {
      boostByPlatform[s.platform] = Math.max(boostByPlatform[s.platform] ?? 0, s.index);
    }

    return (
      <Shell
        title={view.item.title}
        subtitle={one(view.item.client)?.name ?? "No client"}
      >
        {filters}
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
          clients={allClients}
          creditScores={creditScores}
          boostByPlatform={boostByPlatform}
        />
      </Shell>
    );
  }

  /* ---- Single client ---------------------------------------------------- */
  // Every branch from here down renders the overview, and only the video
  // branch above (which already returned) skips loading it.
  if (!overview) throw new Error("unreachable: overview is loaded for non-video views");
  if (clientId) {
    const named = allClients.find((c) => c.id === clientId);
    if (!named) {
      return (
        <Shell title="Client" subtitle="Not found.">
          {filters}
          <div className="card p-8 text-sm text-[var(--muted)]">
            That client was not found in this workspace.
          </div>
        </Shell>
      );
    }
    // The derived summary only exists when some content survived the other
    // filters; an empty one still needs a real name and zeroed totals rather
    // than a "not found", which would misreport an over-narrow filter.
    const client = overview.clients.find((c) => c.id === clientId) ?? {
      id: clientId,
      name: named.name,
      videoCount: 0,
      postCount: 0,
      totals: [],
      trackedSeconds: 0,
      recentGain: 0,
    };
    const mine = overview.videos.filter((v) => v.clientId === clientId);
    return (
      <Shell
        title={client.name}
        subtitle="What has been delivered for this client, kept separate by platform."
      >
        {filters}
        <ClientDetail
          client={client}
          videos={mine}
          workspaceId={ws}
          roles={workspaceRoles}
          members={members}
          canManage={manages}
        />
      </Shell>
    );
  }

  /* ---- Everything ------------------------------------------------------- */
  const t = overview.totals;
  const stillGrowing = overview.videos.filter(
    (v) => v.recentGain != null && v.recentGain.views > 0,
  );
  const gained = stillGrowing.reduce((s, v) => s + (v.recentGain?.views ?? 0), 0);
  return (
    <Shell
      title="Content"
      subtitle="Every video and client, with reach kept separate by platform."
    >
      {filters}

      <StatGrid>
        <Stat
          hero
          icon={Clapperboard}
          label="Videos"
          value={String(t.videos)}
          hint={t.unpublished ? `${t.unpublished} not posted yet` : "all posted"}
        />
        <Stat icon={Layers} label="Posts" value={String(t.posts)} hint="across all platforms" />
        <Stat
          icon={TrendingUp}
          label="Still growing"
          value={gained ? `+${gained.toLocaleString()}` : "—"}
          hint={
            gained
              ? `across ${stillGrowing.length} video${stillGrowing.length === 1 ? "" : "s"}, latest snapshots`
              : "needs two snapshots to compare"
          }
          accent={gained > 0}
        />
        <Stat
          icon={Timer}
          label="Time invested"
          value={t.trackedSeconds ? formatDurationShort(t.trackedSeconds) : "—"}
          hint="tracked against content"
        />
      </StatGrid>

      <section className="mb-7">
        <SectionHeading
          title="Total reach by platform"
          note="Each platform counts a view differently — never summed"
        />
        <PlatformReach totals={overview.platformTotals} />
      </section>

      <NewContentForm workspaceId={ws} clients={allClients} />

      <ContentOverview
        videos={overview.videos}
        clients={overview.clients}
        workspaceId={ws}
        roles={workspaceRoles}
        members={members}
        canManage={manages}
      />
    </Shell>
  );
}

function Shell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <PageHeader title={title} subtitle={subtitle} />
      {children}
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function loadVideoView(supabase: any, ws: string, id: string) {
  const { data: item } = await supabase
    .from("content_items")
    .select(
      "id, workspace_id, client_id, title, subject, hook, music_used, length_seconds, produced_at, notes, client:clients(id, name)",
    )
    .eq("id", id)
    .eq("workspace_id", ws)
    .maybeSingle();
  if (!item) return null;

  const [postsRes, accountsRes, rolesRes, assignRes, timeRes] = await Promise.all([
    supabase
      .from("platform_posts")
      .select(
        `id, workspace_id, content_item_id, account_id, url, external_id, posted_at, source,
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

  const totalSeconds = ((timeRes.data ?? []) as { duration_seconds: number | null }[]).reduce(
    (s, r) => s + (r.duration_seconds ?? 0),
    0,
  );

  return {
    item: item as unknown as ContentItem,
    posts: (postsRes.data ?? []) as unknown as PlatformPost[],
    accounts: (accountsRes.data ?? []) as unknown as Account[],
    roles: (rolesRes.data ?? []) as unknown as Role[],
    assignments: (assignRes.data ?? []) as unknown as ContentAssignment[],
    trackedSeconds: totalSeconds,
    history: (historyRes.data ?? []) as SnapshotRow[],
    analytics: (analyticsRes.data ?? []) as AnalyticsRow[],
  };
}

/** Browser-tab identity; the root layout template appends the app name. */
export const metadata = { title: "Content" };
