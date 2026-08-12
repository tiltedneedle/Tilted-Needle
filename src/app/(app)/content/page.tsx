import PageHeader from "@/components/PageHeader";
import NewContentForm from "@/components/NewContentForm";
import ContentOverview from "@/components/ContentOverview";
import ContentDetail, { type AnalyticsRow, type SnapshotRow } from "@/components/ContentDetail";
import PeopleInView from "@/components/PeopleInView";
import RoleTables from "@/components/RoleTables";
import { buildRoleTables, personStats, type PersonStats } from "@/lib/reports";
import { secondsByUserOnVideos } from "@/lib/reportData";
import FilterBar from "@/components/FilterBar";
import PlatformReach from "@/components/PlatformReach";
import { Stat, StatGrid, SectionHeading } from "@/components/Stat";
import { Clapperboard, Eye, Layers, TrendingUp, Timer } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { canManage, one } from "@/lib/types";
import { formatCount, formatDurationShort } from "@/lib/format";
import { hoursPerThousandViews } from "@/lib/rollup";
import { cachedRankings } from "@/lib/cachedRankings";
import { parseFilters } from "@/lib/contentFilters";
import { selectAll } from "@/lib/selectAll";
import { loadContentOverview, loadRoles } from "@/lib/dashboards";
import { getScrapeBudget } from "@/app/actions";
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
    role?: string;
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
  /**
   * Is anything narrowing the population besides the video drill-down itself?
   *
   * This decides whether the cheap path is safe. A video view does not render
   * the overview's tables, so loading it is normally waste -- but the video
   * DROPDOWN must still offer exactly the videos the active filters admit.
   * The light query can only filter by client, so with any other filter set it
   * would list videos the filters exclude, and picking one produces a view
   * that contradicts the bar above it. That was the reported bug: with a
   * person selected, every video in the workspace stayed selectable.
   */
  const narrowed = Boolean(
    f.clientIds.length ||
      f.personIds.length ||
      // Role narrows the video population like every other dimension, so it
      // MUST be listed here. Leaving a dimension out of this gate is exactly
      // the bug described above -- the dropdown would keep offering videos
      // the filters exclude.
      f.roleSlugs.length ||
      f.platform ||
      f.q ||
      f.from ||
      f.to,
  );

  const [overview, lightVideosRes, platformsRes, clientsRes, membersRes, workspaceRoles] =
    await Promise.all([
      videoId && !narrowed
        ? null
        : loadContentOverview(supabase, ws, rankings, {
            platform: f.platform,
            status: f.status,
            q: f.q,
            clientIds: f.clientIds,
            personIds: f.personIds,
            roleSlugs: f.roleSlugs,
            from: f.from,
            to: f.to,
          }),
      // Paged. Unbounded, PostgREST caps this at 1000 rows silently, and the
      // symptom would be a video that exists but cannot be selected from the
      // dropdown -- latent at today's 255 videos, certain later.
      videoId && !narrowed
        ? selectAll<{ id: string; title: string; client_id: string | null }>(() =>
            supabase
              .from("content_items")
              .select("id, title, client_id")
              .eq("workspace_id", ws)
              .order("produced_at", { ascending: false, nullsFirst: false })
              .order("id"),
          )
        : null,
      videoId && !narrowed
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

  /**
   * The videos this dropdown may offer.
   *
   * ONE RULE: it lists exactly what the active filters admit, never more.
   * `overview.videos` is already the filtered population -- client, person,
   * platform, search and range have all been applied by the loader -- so it
   * needs no second pass here. The earlier code re-applied the client filter
   * and nothing else, which was harmless when the overview existed and
   * actively wrong when it did not.
   *
   * The light list is only reachable when NOTHING is narrowing (see
   * `narrowed`), so it is the whole library by definition and needs no
   * filtering either. Offering a video the filters exclude is not a cosmetic
   * problem: selecting it produces a detail view that contradicts the filter
   * bar still displayed above it.
   */
  type LightVideo = { id: string; title: string; client_id: string | null };
  const videoOptions = (
    overview
      ? overview.videos.map((v) => ({ id: v.id, title: v.title }))
      : ((lightVideosRes?.data ?? []) as LightVideo[])
  ).map((v) => ({ value: v.id, label: v.title }));

  /**
   * A drill-down that the current filters would exclude.
   *
   * Reachable by editing the URL or following a shared link whose filters no
   * longer match, and previously it rendered the video anyway beneath a filter
   * bar that disagreed with it. Detected rather than silently corrected: the
   * view says so and offers the way out, because quietly dropping either the
   * video or the filters would be guessing at intent.
   */
  const videoOutsideFilters = Boolean(
    videoId && narrowed && overview && !overview.videos.some((v) => v.id === videoId),
  );

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
      // 4, not 3: role would otherwise sit behind "More filters", which only
      // auto-opens when a hidden filter ALREADY has a value -- so on a fresh
      // load the new filter would be invisible and read as missing.
      primaryCount={4}
      // Sort is not a filter. "Clear all" clears what you filtered BY; it has
      // no business silently reordering the list you are looking at.
      preserveOnClear={["sort"]}
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
        // Roles come from the workspace's own `roles` rows, never a hardcoded
        // five -- they are renameable and a workspace may not have the seeded
        // set. The VALUE is the slug, so a shared link still means "editor"
        // in a workspace where that role is a different row.
        {
          key: "role",
          label: "Filter by role",
          allLabel: "All roles",
          multi: true,
          values: f.roleSlugs,
          options: workspaceRoles.map((r) => ({ value: r.slug, label: r.name })),
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
        // The status filter is deliberately gone. "Boosting (2x+)" described
        // a baseline-multiplier model that has been removed from the product,
        // and published/unpublished was never a question anyone asked of this
        // page. parseFilters still accepts ?status= so old links do not break.
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
    // The transcript, and any screenshot drafts still awaiting confirmation.
    // Drafts are deliberately loaded here rather than polled from the client:
    // a page refresh is the natural moment to discover the worker has
    // finished, and it needs no extra endpoint.
    const [transcriptRes, draftsRes] = await Promise.all([
      supabase
        .from("video_transcripts")
        .select("full_text, source, is_generated")
        .eq("content_item_id", videoId)
        .maybeSingle(),
      supabase
        .from("ai_analyses")
        .select("subject_id, output, created_at")
        .eq("workspace_id", ws)
        .eq("kind", "vision_draft")
        .order("created_at", { ascending: false }),
    ]);

    const transcriptForItem = transcriptRes.data
      ? {
          fullText: transcriptRes.data.full_text as string,
          source: transcriptRes.data.source as string,
          isGenerated: transcriptRes.data.is_generated as boolean | null,
        }
      : null;

    const visionDrafts: Record<string, never> = {};
    type DraftRow = { subject_id: string; output: Record<string, unknown> };
    for (const d of (draftsRes.data ?? []) as DraftRow[]) {
      // Newest first from the query, so the first draft seen for a post wins
      // and older attempts are ignored rather than stacking up on screen.
      if (d.subject_id in visionDrafts) continue;
      (visionDrafts as Record<string, unknown>)[d.subject_id] = d.output;
    }

    // Metered allowance for the per-post refresh button. Only Instagram is
    // metered, so this is null for everything else -- and a null allowance
    // renders no counter rather than a misleading "unlimited" badge.
    const igPost = view.posts.find(
      (p) => view.accounts.find((a) => a.id === p.account_id)?.platform_slug === "instagram",
    );
    const scrapeAllowance = igPost
      ? await getScrapeBudget(ws, "instagram").then((b) =>
          b
            ? {
                remaining: b.remaining.manual,
                limit: b.limits.manual,
                daysUntilReset: b.daysUntilReset,
                periodEnd: b.periodEnd,
              }
            : null,
        ).catch(() => null)
      : null;

    return (
      <Shell
        title={view.item.title}
        subtitle={one(view.item.client)?.name ?? "No client"}
      >
        {filters}
        {videoOutsideFilters && (
          // Says it rather than silently resolving it. Dropping the video
          // would lose what was asked for; dropping the filters would lose
          // the context that made it interesting -- so the choice is offered.
          <div className="card mb-5 border-[var(--warning)]/30 bg-[var(--warning-100)] p-3 text-sm">
            <span className="font-medium">
              This video is outside the filters you have set.
            </span>{" "}
            <span className="text-[var(--muted)]">
              It is shown because you asked for it directly. Clear the video to
              return to the filtered list, or clear the filters to keep it in
              view.
            </span>
          </div>
        )}
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
          transcript={transcriptForItem}
          visionDrafts={visionDrafts}
          scrapeAllowance={scrapeAllowance}
        />
      </Shell>
    );
  }

  // Every branch from here down renders the overview, and only the video
  // branch above (which already returned) skips loading it.
  if (!overview) throw new Error("unreachable: overview is loaded for non-video views");

  /* ---- Single client ------------------------------------------------------
     There used to be a whole separate branch here: exactly one client and no
     people selected returned <ClientDetail> instead of the overview. That is
     what made the sort controls vanish -- ClientDetail owns no sort UI, and
     ContentOverview, which owns all of it, was simply never reached. It also
     explained the shape of the complaint: pick TWO clients and the sorts came
     back, because the condition stopped matching.

     Patching it by mounting a second sort bar inside ClientDetail would have
     left two sort implementations to keep in step, and the "Reach" sort is
     exactly where that goes wrong -- it ranks on PEAK single-platform views,
     never a sum, and a well-meaning second copy that added views together
     would break the hardest rule in the product while looking fine.

     So the branch is gone. One page, one sort, and the bug is not fixed so
     much as made unrepeatable. What was genuinely client-facing about that
     view -- the hours-per-1k-views strip and the most-viewed figure -- moves
     into the overview and appears when a single client is in view. */
  const soloClient = soloClientId
    ? (overview.clients.find((c) => c.id === soloClientId) ??
      (() => {
        const named = allClients.find((c) => c.id === soloClientId);
        // A client that survived no other filter still needs a real name and
        // zeroed totals; "not found" would misreport an over-narrow filter as
        // a missing record.
        return named
          ? {
              id: soloClientId,
              name: named.name,
              videoCount: 0,
              postCount: 0,
              totals: [],
              trackedSeconds: 0,
              recentGain: 0,
            }
          : null;
      })())
    : null;

  // Names of the roles currently filtering the list, for the stat tiles.
  const roleLabel =
    f.roleSlugs.length > 0
      ? workspaceRoles
          .filter((r) => f.roleSlugs.includes(r.slug))
          .map((r) => r.name)
          .join(" + ") || null
      : null;

  /* ---- Per-role boards ----------------------------------------------------
     Computed from videosForTables, and from the FULL assignment list, so the
     boards answer "where does this person stand in the team" rather than
     "how does this person compare to themselves".

     Tracked seconds are loaded for everyone here rather than only the
     selected people, because a board that shows hours for two highlighted
     rows and blanks for the rest looks like missing data. Note the figure is
     the person's total on the in-view videos and is NOT role-scoped --
     time_entries has no role_id and per-role time cannot be derived -- which
     is why no board renders it as a column. */
  const roleTables = buildRoleTables(
    workspaceRoles,
    members,
    overview.videosForTables,
    rankings.assignments,
    await secondsByUserOnVideos(supabase, ws, null, overview.videosForTables),
  );

  // Ranked on actual reach: peak single-platform views, because a view is a
  // different event on each platform and pooling them ranks nothing.
  const bestVideo =
    [...overview.videos]
      .filter((v) => v.postCount > 0)
      .sort(
        (a, b) =>
          b.platforms.reduce((s, p) => Math.max(s, p.views), 0) -
          a.platforms.reduce((s, p) => Math.max(s, p.views), 0),
      )[0] ?? null;

  /* ---- Everything ------------------------------------------------------- */
  const t = overview.totals;
  const stillGrowing = overview.videos.filter(
    (v) => v.recentGain != null && v.recentGain.views > 0,
  );
  const gained = stillGrowing.reduce((s, v) => s + (v.recentGain?.views ?? 0), 0);

  // People-in-view strip (PRD v0.5 §3): per selected person, their numbers
  // computed on the CURRENT intersection -- the whole point of the merge.
  // The people strip and the Employee report are the same aggregation --
  // one shared builder (lib/reports.personStats), so the two can never
  // disagree about how many videos someone worked on.
  let peopleInView: PersonStats[] = [];
  if (f.personIds.length > 0) {
    peopleInView = personStats(
      f.personIds.map((userId) => ({
        userId,
        name: members.find((m) => m.userId === userId)?.name ?? "Unknown",
      })),
      overview.videos,
      rankings.assignments,
      await secondsByUserOnVideos(supabase, ws, f.personIds, overview.videos),
    );
  }

  return (
    <Shell
      title="Content"
      subtitle="Every video and client, with reach kept separate by platform."
    >
      {filters}

      <StatGrid>
        {/* The role filter narrows the video population, so this count means
            something different while one is set. Saying which role is the
            difference between a number that moved and a number that lies:
            "207 videos" and "20 videos" look like the same statistic
            otherwise. */}
        <Stat
          hero
          icon={Clapperboard}
          label={roleLabel ? `Videos · ${roleLabel}` : "Videos"}
          value={String(t.videos)}
          hint={
            roleLabel
              ? `with ${roleLabel.toLowerCase()} credited`
              : t.unpublished
                ? `${t.unpublished} not posted yet`
                : "all posted"
          }
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
        {/* The last figure the deleted client view had that this one did not.
            Peak single-platform views, never a sum across platforms -- and
            shown only for a single client, because "the most viewed video"
            across a mixed set answers a question nobody asked. */}
        {soloClient && bestVideo && (
          <Stat
            icon={Eye}
            label="Most viewed"
            value={formatCount(
              bestVideo.platforms.reduce((s, p) => Math.max(s, p.views), 0),
            )}
            hint={bestVideo.title.slice(0, 40)}
          />
        )}
      </StatGrid>

      <PeopleInView people={peopleInView} />

      {/* Built from videosForTables -- the population BEFORE the person and
          role filters narrowed it. That is deliberate and it is the only way
          "who does best" can be answered: a board computed from a set already
          narrowed to one person ranks them first of one, every time. Client,
          dates, platform and search ARE applied, so the boards still describe
          the slice being looked at. Selected people are highlighted in place
          rather than isolated. */}
      <RoleTables
        tables={roleTables}
        highlightUserIds={f.personIds}
        scopeNote={
          f.personIds.length > 0
            ? "Ranked against everyone in view; your selection is highlighted"
            : undefined
        }
      />

      <section className="mb-7">
        <SectionHeading
          title="Total reach by platform"
          note="Each platform counts a view differently — never summed"
        />
        <PlatformReach totals={overview.platformTotals} />
        {/* Carried over from the deleted ClientDetail branch. It only means
            anything for ONE client -- hours of work per 1,000 views is a
            ratio, and pooling several clients' hours against several clients'
            views would produce a number that describes nobody. */}
        {soloClient && soloClient.trackedSeconds > 0 && soloClient.totals.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--muted)]">
            {soloClient.totals.map((t) => {
              const hpk = hoursPerThousandViews(soloClient.trackedSeconds, t.views);
              if (hpk == null) return null;
              return (
                <span key={t.platform} title="Hours of tracked work per 1,000 views">
                  <span className="capitalize">{t.platform}</span>{" "}
                  <span className="tabular text-[var(--fg)]">{hpk.toFixed(2)}</span> h / 1k
                  views
                </span>
              );
            })}
          </div>
        )}
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
