import PageHeader from "@/components/PageHeader";
import NewContentForm from "@/components/NewContentForm";
import ContentOverview from "@/components/ContentOverview";
import ContentDetail, { type AnalyticsRow, type SnapshotRow } from "@/components/ContentDetail";
import ClientDetail from "@/components/ClientDetail";
import PeopleInView from "@/components/PeopleInView";
import FilterBar from "@/components/FilterBar";
import PlatformReach from "@/components/PlatformReach";
import { Stat, StatGrid, SectionHeading } from "@/components/Stat";
import { Clapperboard, Layers, TrendingUp, Timer } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { canManage, one } from "@/lib/types";
import { formatDurationShort } from "@/lib/format";
import { cachedRankings } from "@/lib/cachedRankings";
import { parseFilters } from "@/lib/contentFilters";
import { selectAll } from "@/lib/selectAll";
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
 * THE performance surface (PRD v0.5): everything about what was made and how
 * it performed -- videos, the clients they belong to, the people credited on
 * them, and the per-platform numbers behind it all. Clients, people, and
 * time ranges are all filters on this one view; there is no separate People
 * dashboard any more, only /team-admin for the employment records.
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
  // One canonical parse -- PRD v0.5 §2.1: the page is a pure function of
  // this state, so the order filters were selected in cannot matter.
  const f = parseFilters(sp);
  const videoId = f.videoId;
  // The single-client deep view keeps its page when exactly one client and
  // nothing person-shaped is selected; any wider combination renders the
  // overview with its summary strips instead.
  const soloClientId =
    f.clientIds.length === 1 && f.personIds.length === 0 ? f.clientIds[0] : null;
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
            platform: f.platform,
            status: f.status,
            q: f.q,
            clientIds: f.clientIds,
            personIds: f.personIds,
            from: f.from,
            to: f.to,
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

  // A video filter narrows to that video; client filters narrow the video
  // dropdown to those clients' work so the two compose sensibly.
  type LightVideo = { id: string; title: string; client_id: string | null };
  const clientSet = new Set(f.clientIds);
  const videoOptions = (
    overview
      ? (clientSet.size
          ? overview.videos.filter((v) => v.clientId != null && clientSet.has(v.clientId))
          : overview.videos
        ).map((v) => ({ id: v.id, title: v.title }))
      : ((lightVideosRes?.data ?? []) as LightVideo[])
          .filter((v) => !clientSet.size || (v.client_id != null && clientSet.has(v.client_id)))
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
      searchValue={f.q}
      searchPlaceholder="Search titles…"
      searchClears={["video"]}
      range={{ from: f.from, to: f.to }}
      rangeClears={["video"]}
      primaryCount={3}
      filters={[
        // Multi-select: within a dimension is OR, across dimensions is AND
        // (PRD v0.5 §2.1). Options come from the unfiltered lists, so no
        // combination can make another option unreachable.
        {
          key: "client",
          label: "Filter by client",
          allLabel: "All clients",
          multi: true,
          values: f.clientIds,
          options: allClients
            .filter((c) => !c.is_archived)
            .map((c) => ({ value: c.id, label: c.name })),
          clears: ["video"],
        },
        {
          key: "person",
          label: "Filter by person",
          allLabel: "Anyone credited",
          multi: true,
          values: f.personIds,
          options: members.map((m) => ({ value: m.userId, label: m.name })),
          clears: ["video"],
        },
        {
          key: "video",
          label: "Filter by video",
          allLabel: f.clientIds.length ? "All of their videos" : "All videos",
          value: videoId ?? null,
          options: videoOptions,
        },
        // Every population filter clears the single-video drill-down: a
        // single video's view ignores them, so leaving ?video= in place
        // would show one video while the bar claimed a filtered list.
        {
          key: "platform",
          label: "Filter by platform",
          allLabel: "All platforms",
          value: f.platform,
          options: platformOptions.map((p) => ({ value: p.slug, label: p.name })),
          clears: ["video"],
        },
        {
          key: "status",
          label: "Filter by status",
          allLabel: "Any status",
          value: f.status,
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

  /* ---- Single client ------------------------------------------------------
     Kept as the deep client view only when EXACTLY one client and no people
     are selected; any wider combination falls through to the overview,
     where the summary strips describe the intersection (PRD v0.5 §3). */
  // Every branch from here down renders the overview, and only the video
  // branch above (which already returned) skips loading it.
  if (!overview) throw new Error("unreachable: overview is loaded for non-video views");
  if (soloClientId) {
    const named = allClients.find((c) => c.id === soloClientId);
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
    const client = overview.clients.find((c) => c.id === soloClientId) ?? {
      id: soloClientId,
      name: named.name,
      videoCount: 0,
      postCount: 0,
      totals: [],
      trackedSeconds: 0,
      recentGain: 0,
    };
    const mine = overview.videos.filter((v) => v.clientId === soloClientId);
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

  // People-in-view strip (PRD v0.5 §3): per selected person, their numbers
  // computed on the CURRENT intersection -- the whole point of the merge.
  let peopleInView: import("@/components/PeopleInView").PersonInView[] = [];
  if (f.personIds.length > 0) {
    const viewIds = new Set(overview.videos.map((v) => v.id));
    const videoById = new Map(overview.videos.map((v) => [v.id, v]));
    const wanted = new Set(f.personIds);

    // Their tracked time on the in-view videos only.
    const { data: timeRows } = await supabase
      .from("time_entries")
      .select("user_id, content_item_id, duration_seconds")
      .eq("workspace_id", ws)
      .in("user_id", f.personIds)
      .not("content_item_id", "is", null)
      .not("ended_at", "is", null);
    const secondsBy = new Map<string, number>();
    for (const r of (timeRows ?? []) as {
      user_id: string;
      content_item_id: string;
      duration_seconds: number | null;
    }[]) {
      if (!viewIds.has(r.content_item_id)) continue;
      secondsBy.set(r.user_id, (secondsBy.get(r.user_id) ?? 0) + (r.duration_seconds ?? 0));
    }

    peopleInView = f.personIds.map((userId) => {
      const theirs = rankings.assignments.filter(
        (a) => a.user_id === userId && viewIds.has(a.content_item_id),
      );
      const videoIds = [...new Set(theirs.map((a) => a.content_item_id))];
      const roles = [...new Set(theirs.map((a) => a.roleName))];

      const perPlatform = new Map<string, number>();
      const boosts: number[] = [];
      for (const id of videoIds) {
        for (const pl of videoById.get(id)?.platforms ?? []) {
          perPlatform.set(pl.platform, (perPlatform.get(pl.platform) ?? 0) + pl.views);
        }
        for (const s of rankings.scoredByContent.get(id) ?? []) boosts.push(s.index);
      }

      return {
        userId,
        name: members.find((m) => m.userId === userId)?.name ?? "Unknown",
        videosInView: videoIds.length,
        platforms: [...perPlatform.entries()]
          .map(([platform, views]) => ({ platform, views }))
          .sort((a, b) => b.views - a.views),
        avgBoost: boosts.length ? boosts.reduce((s, x) => s + x, 0) / boosts.length : null,
        roles,
        seconds: secondsBy.get(userId) ?? 0,
      };
    });
  }

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

      <PeopleInView people={peopleInView} />

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
  // Paged: a video's posts sync daily, so its combined snapshot history
  // crosses PostgREST's silent 1000-row cap within a year -- descending
  // order would quietly drop the OLDEST readings and miscount the history.
  const historyRes = postIds.length
    ? await selectAll(() =>
        supabase
          .from("post_snapshots")
          .select("id, platform_post_id, captured_at, views, likes, comments, shares, saves")
          .in("platform_post_id", postIds)
          .order("captured_at", { ascending: false })
          .order("id"),
      )
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
