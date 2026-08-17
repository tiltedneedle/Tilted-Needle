import { operatingDate, startOfOperatingDay } from "@/lib/tz";
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
import { cachedContentData } from "@/lib/cachedContentData";
import { countsTowardPerformance } from "@/lib/excludedItems";
import { totalsByPlatform, type MetricRow, type PlatformTotals } from "@/lib/rollup";
import {
  readLifecycle,
  bestShape,
  type LifecycleReading,
  type LifecycleShape,
} from "@/lib/lifecycle";
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
  /**
   * Poster frame for the tile. First non-null across this video's posts: a
   * video cross-posted to three platforms has three encodes and three frames,
   * and any of them identifies the video to a human scanning the list, which
   * is the entire job. Null is a normal state, not a failure.
   */
  thumbnailUrl: string | null;
  /**
   * The platform's own id for this video's first post.
   *
   * Carried only so a caption-less row can be told apart from its neighbours
   * -- 41 videos render as the same word otherwise -- and because this string
   * also appears in the post's URL, so a row can be matched to the real post.
   */
  postCode: string | null;
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
   * Deliberately not a fixed "last 7 days" window: snapshots are recorded at
   * irregular intervals, so a fixed window silently reports nothing whenever
   * the cadence does not happen to match it. Reporting the real interval
   * alongside the number is both always available and honest about what it
   * covers. Null when there is only one snapshot -- which is different from
   * "gained nothing", and is shown as such rather than zero.
   *
   * - views: gained between the last two readings.
   * - days: how far apart those readings were. NOT a fixed window -- it is
   *   whatever gap the sync left, and across this workspace those run
   *   0.00 to 14.06 days. Which is why the UI shows a RATE: the raw gains are
   *   not comparable between rows, and sorting by them does not sort by
   *   growth.
   * - staleDays: how long ago the latest reading was taken, so a figure
   *   describing a fortnight ago cannot pass as "now".
   */
  recentGain: { views: number; days: number; staleDays: number } | null;
  /**
   * The same gain, kept split by platform. `recentGain.views` pools it into
   * one number, which is fine for "is this still moving" but useless to the
   * platform report, where the whole row IS one platform (PRD v0.5 §5).
   */
  platformGains: { platform: string; views: number }[];
  /**
   * How each platform's copy of this video is behaving over its life. Kept
   * per platform because a video genuinely can be evergreen on YouTube and
   * finished on TikTok, and merging them would hide exactly that.
   */
  lifecycle: { platform: string; reading: LifecycleReading }[];
  /**
   * The liveliest shape across those platforms -- what the one-glyph summary
   * in a dense list should say, because the question it answers is "is this
   * still working anywhere".
   */
  lifecycleShape: LifecycleShape;
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
  /**
   * The same population BEFORE the person and role filters narrowed it.
   *
   * This is what the per-role performance tables are computed from, and the
   * distinction is the whole point: "who does best at editing" is a question
   * about the team, so a table built from a set already narrowed to one
   * person could only ever rank them first of one. Everything else -- client,
   * dates, platform, search, the archived-client rules -- is already applied,
   * so the tables still describe the slice you are looking at.
   */
  videosForTables: VideoSummary[];
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
   * Multi-select role SLUGS: a video matches when ANY of these roles is
   * credited on it (OR). Narrows the video population, so the KPI tiles
   * recount with it -- which is why the page labels them while it is set.
   */
  roleSlugs?: string[];
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
// Returns everything except videosForTables: this function is handed ONE
// population and derives from it, so which population that is -- narrowed or
// wide -- is the caller's decision, not something to smuggle in here.
function deriveContent(
  videos: VideoSummary[],
  activeClients: { id: string; name: string }[],
  platformOptions: { slug: string; name: string }[],
): Omit<ContentOverview, "videosForTables"> {
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
  /**
   * The raw read is cached per workspace; only the derivation below re-runs.
   *
   * This is the whole optimisation. The rows fetched here do not depend on the
   * filters -- filtering happens in TypeScript further down -- so a filter
   * change was re-fetching 464 items, 371 posts and 3009 snapshots to produce
   * a differently-sliced view of identical data. Measured: a filter matching
   * ZERO videos still cost 3.6s.
   *
   * See cachedContentData for why it uses the service client and why it
   * carries a revalidate ceiling as well as a tag.
   */
  const raw = await cachedContentData(ws);
  const itemsRes = { data: raw.items };
  const postsRes = { data: raw.posts };
  const timeRes = { data: raw.times };
  const clientsRes = { data: raw.clients };
  const platformsRes = { data: raw.platforms };
  const snapsRes = { data: raw.snapshots };

  type Item = {
    id: string;
    title: string;
    produced_at: string | null;
    length_seconds: number | null;
    client_id: string | null;
    review_state: string | null;
    client: { id: string; name: string } | { id: string; name: string }[] | null;
  };
  type PostRow = {
    id: string;
    content_item_id: string;
    posted_at: string | null;
    thumbnail_url: string | null;
    external_id: string | null;
    account:
      | { platform_slug: string; last_synced_at: string | null }
      | { platform_slug: string; last_synced_at: string | null }[]
      | null;
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

  // Range bounds as instants: from 00:00 on `from` through the end of `to`,
  // both inclusive, in the operating timezone.
  //
  // The end is the START of the following day rather than start-of-`to` plus
  // 86,400,000ms, because a day is not always 24 hours -- on a DST boundary
  // the arithmetic version either loses an hour of a client's posts or counts
  // an extra one. The literal +04:00 this replaces was only safe while the
  // zone could never shift.
  const rangeStart = filters.from ? startOfOperatingDay(filters.from).getTime() : null;
  const rangeEnd = filters.to ? startOfOperatingDay(nextDay(filters.to)).getTime() : null;

  /**
   * A post's growth. Without a range: the delta between its last two
   * readings (the long-standing "still growing" semantic). With a range:
   * the sum of positive deltas whose LATER reading landed inside it, so
   * the figure answers "what moved in this window" (PRD v0.5 §2.4).
   * Negative platform corrections are clamped in the windowed mode only --
   * the unwindowed last-two delta keeps showing a real drop as a drop.
   */
  function gainForPost(
    postId: string,
  ): { views: number; days: number; latestAt: number } | null {
    const series = seriesByPost.get(postId);
    if (!series || series.length < 2) return null;

    if (rangeStart == null && rangeEnd == null) {
      const latest = series[series.length - 1];
      const prev = series[series.length - 2];
      return {
        views: latest.views - prev.views,
        days: Math.max(0, (latest.at - prev.at) / 86400000),
        // When the LATEST reading was taken. Without this the column silently
        // mixes "growing now" with "was growing a fortnight ago": scrape
        // cadence falls off with a post's age, and 71 of 305 posts here were
        // last read over a week back. A retired post then looks flat because
        // nobody looked, not because it stopped.
        latestAt: latest.at,
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
    return { views, days: Math.max(0, (last - first) / 86400000), latestAt: last };
  }

  const byItem = new Map<string, VideoSummary["platforms"]>();
  const thumbByItem = new Map<string, string>();
  // The platform's own id for the post. Only ever used to tell caption-less
  // videos apart -- 41 of them render as the same word, and this is the one
  // thing about them that is unique and also appears in their URL, so a row
  // can be matched back to the actual post.
  const codeByItem = new Map<string, string>();
  const postsByItem = new Map<string, number>();
  const gainByItem = new Map<string, { views: number; days: number; latestAt: number }>();
  const platformGainByItem = new Map<string, Map<string, number>>();
  const lifecycleByItem = new Map<string, VideoSummary["lifecycle"]>();
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
    // First non-null wins, and posts arrive in a stable order -- so a video
    // does not flip between its platforms' poster frames on every reload.
    // Note this respects the platform filter above: filter to TikTok and you
    // see TikTok's frame, which is the honest answer to what you asked for.
    if (p.thumbnail_url && !thumbByItem.has(p.content_item_id)) {
      thumbByItem.set(p.content_item_id, p.thumbnail_url);
    }
    // Same first-non-null rule as the poster frame, for the same reason: a
    // stable choice so the label does not change between reloads.
    if (p.external_id && !codeByItem.has(p.content_item_id)) {
      codeByItem.set(p.content_item_id, p.external_id);
    }

    const gain = gainForPost(p.id);
    if (gain != null) {
      const acc = gainByItem.get(p.content_item_id);
      // Views add up within the item; the interval shown is the widest of
      // its posts, so the figure is never claimed to cover less than it does.
      gainByItem.set(p.content_item_id, {
        views: (acc?.views ?? 0) + gain.views,
        days: Math.max(acc?.days ?? 0, gain.days),
        // The OLDEST latest-reading across this video's posts. A video is only
        // as current as its least recently checked platform, and claiming
        // otherwise is how a stale number passes for a live one.
        latestAt: Math.min(acc?.latestAt ?? Infinity, gain.latestAt),
      });
      if (!platformGainByItem.has(p.content_item_id)) {
        platformGainByItem.set(p.content_item_id, new Map());
      }
      const pg = platformGainByItem.get(p.content_item_id)!;
      pg.set(acct.platform_slug, (pg.get(acct.platform_slug) ?? 0) + gain.views);
    }

    // Lifecycle rides the snapshot pass we are already making -- no extra
    // query. Deliberately NOT windowed by the filter range: "is this still
    // earning" is a property of the post's whole observed life, and clipping
    // it to a two-week filter would report every older video as dormant.
    if (!lifecycleByItem.has(p.content_item_id)) lifecycleByItem.set(p.content_item_id, []);
    lifecycleByItem.get(p.content_item_id)!.push({
      platform: acct.platform_slug,
      reading: readLifecycle({
        series: seriesByPost.get(p.id) ?? [],
        // The last time we actually polled this account. Everything after the
        // final snapshot is known-flat time, not missing time (see lifecycle.ts).
        observedUntil: acct.last_synced_at ? new Date(acct.last_synced_at).getTime() : null,
        postedAt: p.posted_at,
      }),
    });
  }


  // Content items whose transcript matches the search, resolved in one query
  // and only when there is something to search for -- a blank box must not
  // cost a full-text scan on every page load.
  const transcriptMatches = new Set<string>();
  if (filters.q?.trim()) {
    const { data: hits } = await supabase
      .from("video_transcripts")
      .select("content_item_id")
      .eq("workspace_id", ws)
      .textSearch("search_vector", filters.q.trim(), {
        type: "websearch",
        config: "english",
      });
    for (const h of (hits ?? []) as { content_item_id: string }[]) {
      transcriptMatches.add(h.content_item_id);
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
    thumbnailUrl: thumbByItem.get(i.id) ?? null,
    postCode: codeByItem.get(i.id) ?? null,
    trackedSeconds: secondsByItem.get(i.id) ?? 0,
    bestIndex: bestIndexByItem.get(i.id) ?? null,
    postCount: postsByItem.get(i.id) ?? 0,
    credits: creditsByItem.get(i.id) ?? [],
    recentGain: (() => {
      const g = gainByItem.get(i.id);
      if (!g) return null;
      return {
        views: g.views,
        days: g.days,
        staleDays: Math.max(0, (Date.now() - g.latestAt) / 86400000),
      };
    })(),
    platformGains: [...(platformGainByItem.get(i.id)?.entries() ?? [])].map(
      ([platform, views]) => ({ platform, views }),
    ),
    lifecycle: lifecycleByItem.get(i.id) ?? [],
    lifecycleShape: bestShape(
      (lifecycleByItem.get(i.id) ?? []).map((l) => l.reading.shape),
    ),
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

  if (filters.status === "published") videos = videos.filter((v) => v.postCount > 0);
  else if (filters.status === "unpublished") videos = videos.filter((v) => v.postCount === 0);
  else if (filters.status === "boosting")
    videos = videos.filter((v) => v.bestIndex != null && v.bestIndex >= 2);

  if (filters.q?.trim()) {
    const needle = filters.q.trim().toLowerCase();
    // Title OR transcript. One search box answers both "what was this called"
    // and "which video mentions LASIK aftercare" -- the second being the
    // question a library of transcripts exists to answer (PRD §5.11a). The
    // transcript half is a Postgres full-text match, so it stems and ignores
    // stop words rather than demanding the exact substring.
    videos = videos.filter(
      (v) => v.title.toLowerCase().includes(needle) || transcriptMatches.has(v.id),
    );
  }

  const clientRows = (clientsRes.data ?? []) as {
    id: string;
    name: string;
    is_archived: boolean;
  }[];
  const platformOptions = (
    (platformsRes.data ?? []) as { slug: string; display_name: string }[]
  ).map((p) => ({ slug: p.slug, name: p.display_name }));

  /**
   * An archived client's work leaves the dashboard entirely.
   *
   * Only the client TABLE excluded them before, so their videos still filled
   * the list, the KPI counts and the per-platform reach totals -- a client the
   * team had explicitly deactivated went on contributing to every headline
   * number, with no row anywhere to explain where those views came from.
   *
   * Nothing is deleted: archiving is reversible, and restoring the client
   * brings its whole history straight back. Content with NO client is kept --
   * it belongs to no archived client, so it is still current work.
   */
  const archivedClientIds = new Set(
    clientRows.filter((c) => c.is_archived).map((c) => c.id),
  );

  /* Both exclusion rules, from ONE definition in lib/excludedItems.
     Archived client, and anything a human has not approved -- a video the
     sync found but nobody has judged yet, or one judged as the client's own
     post. Neither counts toward a performance figure, and neither is deleted:
     the rows, their posts and their whole metrics history all survive, and
     approving one from the review strip brings it straight back. */
  const reviewByItem = new Map(items.map((i) => [i.id, i.review_state]));
  const live = videos.filter((v) =>
    countsTowardPerformance(
      { review_state: reviewByItem.get(v.id) ?? "approved", clientId: v.clientId },
      archivedClientIds,
    ),
  );

  /* ---- Person and role, applied LAST and captured either side -------------
     Every other filter narrows the population everyone agrees on. These two
     are different, because the per-role performance tables have to answer
     "where does this person stand in the TEAM" -- and a table computed from a
     set already narrowed to that person can only ever rank them first of one.

     So `live` is kept as the table population (client, dates, platform,
     search, archived-client rules all applied) and the person/role narrowing
     produces the population for the video list and the KPI tiles.

     Order between these two and the filters above is irrelevant to the
     result -- each is an independent intersection over the same set, which is
     the property that makes selection order structurally meaningless. Moving
     the person filter down here changes nothing about what it returns. */
  let shown = live;

  if (filters.personIds && filters.personIds.length > 0) {
    const wanted = new Set(filters.personIds);
    const theirs = new Set(
      rankings.assignments
        .filter((a) => wanted.has(a.user_id))
        .map((a) => a.content_item_id),
    );
    shown = shown.filter((v) => theirs.has(v.id));
  }

  if (filters.roleSlugs && filters.roleSlugs.length > 0) {
    const wantedRoles = new Set(filters.roleSlugs);
    const withRole = new Set(
      rankings.assignments
        .filter((a) => wantedRoles.has(a.roleSlug))
        .map((a) => a.content_item_id),
    );
    shown = shown.filter((v) => withRole.has(v.id));
  }

  return {
    ...deriveContent(
      shown,
      clientRows.filter((c) => !c.is_archived).map((c) => ({ id: c.id, name: c.name })),
      platformOptions,
    ),
    videosForTables: live,
  };
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
/**
 * The approval queue: what is waiting, what was rejected, and how much of the
 * pending pile arrived on the most recent sync.
 *
 * Archived clients are excluded from BOTH lists. A video that is pending AND
 * belongs to a client we no longer work with must not sit in the queue asking
 * to be judged -- nobody is going to approve work for a client they dropped,
 * and leaving it there makes the queue permanently non-empty. It is already
 * out of every performance figure via the same exclusion set, so it is simply
 * not a question anyone needs to answer.
 */
export async function loadReviewQueue(supabase: Db, ws: string) {
  const [itemsRes, clientsRes, postsRes, acctRes] = await Promise.all([
    selectAll<{
      id: string;
      title: string;
      client_id: string | null;
      produced_at: string | null;
      review_state: string;
      created_at: string;
    }>(() =>
      supabase
        .from("content_items")
        .select("id, title, client_id, produced_at, review_state, created_at")
        .eq("workspace_id", ws)
        .neq("review_state", "approved")
        .order("created_at", { ascending: false })
        .order("id"),
    ),
    supabase.from("clients").select("id, name, is_archived").eq("workspace_id", ws),
    selectAll<{ content_item_id: string; account: { platform_slug: string } | { platform_slug: string }[] | null }>(
      () =>
        supabase
          .from("platform_posts")
          .select("content_item_id, account:accounts(platform_slug)")
          .eq("workspace_id", ws)
          .order("id"),
    ),
    supabase
      .from("accounts")
      .select("last_synced_at")
      .eq("workspace_id", ws)
      .not("last_synced_at", "is", null)
      .order("last_synced_at", { ascending: false })
      .limit(1),
  ]);

  const clients = new Map(
    ((clientsRes.data ?? []) as { id: string; name: string; is_archived: boolean }[]).map((c) => [
      c.id,
      c,
    ]),
  );
  const platformsByItem = new Map<string, Set<string>>();
  for (const p of postsRes.data ?? []) {
    const slug = one(p.account)?.platform_slug;
    if (!slug) continue;
    if (!platformsByItem.has(p.content_item_id)) platformsByItem.set(p.content_item_id, new Set());
    platformsByItem.get(p.content_item_id)!.add(slug);
  }

  const shape = (r: (typeof itemsRes.data)[number]) => ({
    id: r.id,
    title: r.title,
    clientName: r.client_id ? (clients.get(r.client_id)?.name ?? null) : null,
    producedAt: r.produced_at,
    platforms: [...(platformsByItem.get(r.id) ?? [])].sort(),
  });

  const live = (itemsRes.data ?? []).filter(
    (r) => !r.client_id || !clients.get(r.client_id)?.is_archived,
  );

  // "New since the last sync" is measured from when that sync ran, not from a
  // fixed window: syncs are irregular, so a fixed "last 24h" would report
  // nothing whenever the cadence happened not to match it.
  const lastSync = (acctRes.data as { last_synced_at: string }[] | null)?.[0]?.last_synced_at;
  const cutoff = lastSync ? new Date(lastSync).getTime() - 60 * 60 * 1000 : null;

  const pending = live.filter((r) => r.review_state === "pending");

  return {
    pending: pending.map(shape),
    rejected: live.filter((r) => r.review_state === "rejected").map(shape),
    newSinceSync:
      cutoff == null
        ? 0
        : pending.filter((r) => new Date(r.created_at).getTime() >= cutoff).length,
  };
}

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
 * The calendar date after `dateISO`, as a date string.
 *
 * UTC date arithmetic on a NOON anchor, not 86,400,000ms added to an instant.
 * Noon is far enough from either boundary that no DST shift can push it into
 * the wrong day, whereas adding a fixed 24 hours to a midnight instant lands
 * on the same date twice in the autumn and skips one in the spring.
 */
function nextDay(dateISO: string): string {
  const d = new Date(`${dateISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Monday 00:00 in the operating timezone, matching the To-dos sheet's
 * definition of "today".
 *
 * Server-local maths here (UTC on Vercel) started the week hours late: time
 * tracked between local midnight and the UTC rollover counted into the
 * previous week. The fix used to hardcode +04:00, which was safe only while
 * the zone was permanently Dubai; it now resolves the offset for whatever
 * OPERATING_TZ is, at that date.
 */
export function startOfWeek(now = new Date()): Date {
  const today = operatingDate(now);
  // That calendar date's weekday; noon UTC sidesteps any rollover edge.
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  // Subtract whole days from the DATE, then resolve midnight -- not the other
  // way round. Resolving first and subtracting 86,400,000ms per day assumes
  // every day is exactly 24 hours, which is false in any zone with DST: the
  // week would start an hour out for half the year. The old code could write
  // +04:00 literally because Dubai never shifts; a configurable zone cannot.
  const monday = new Date(`${today}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - dow);
  return startOfOperatingDay(operatingDate(monday));
}
