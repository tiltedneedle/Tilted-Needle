/**
 * Data behind the Clients section: a client's channels, and one channel's
 * own dashboard.
 *
 * A channel dashboard is scoped to a single account -- one platform, one
 * handle -- which is what makes summing views across its videos safe. That
 * is different from the Content dashboard's client-wide view, which spans
 * every platform a client is on and therefore never sums (PRD 5 Step 2). At
 * the single-account level there is only one unit in play, so a total reach
 * figure and a reach-over-time curve both mean something real.
 */
import { one } from "@/lib/types";
import { selectAll } from "@/lib/selectAll";
import type { LineChartPoint } from "@/components/LineChart";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

export type ChannelSummary = {
  accountId: string;
  platformSlug: string;
  handle: string;
  displayName: string | null;
  isArchived: boolean;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  videoCount: number;
  totalViews: number;
  recentGain: { views: number; days: number } | null;
};

export type ClientChannels = {
  client: { id: string; name: string; email: string | null; isArchived: boolean };
  channels: ChannelSummary[];
};

export async function loadClientChannels(
  db: Db,
  ws: string,
  clientId: string,
): Promise<ClientChannels | null> {
  const { data: client } = await db
    .from("clients")
    .select("id, name, email, is_archived")
    .eq("id", clientId)
    .eq("workspace_id", ws)
    .maybeSingle();
  if (!client) return null;

  const [accountsRes, postsRes] = await Promise.all([
    db
      .from("accounts")
      .select(
        "id, platform_slug, handle, display_name, is_archived, last_synced_at, last_sync_error",
      )
      .eq("workspace_id", ws)
      .eq("client_id", clientId)
      .order("platform_slug"),
    db
      .from("platform_posts")
      .select("id, account_id, metrics:post_current_metrics(views)")
      .eq("workspace_id", ws),
  ]);

  type PostRow = {
    id: string;
    account_id: string;
    metrics: { views: number | null } | { views: number | null }[] | null;
  };
  const posts = (postsRes.data ?? []) as unknown as PostRow[];
  const postIds = posts.map((p) => p.id);

  const gains = postIds.length ? await gainsByPost(db, ws, postIds) : new Map();

  const channels: ChannelSummary[] = (
    (accountsRes.data ?? []) as {
      id: string;
      platform_slug: string;
      handle: string;
      display_name: string | null;
      is_archived: boolean;
      last_synced_at: string | null;
      last_sync_error: string | null;
    }[]
  ).map((a) => {
    const mine = posts.filter((p) => p.account_id === a.id);
    let gain = 0;
    let hasGain = false;
    let maxDays = 0;
    for (const p of mine) {
      const g = gains.get(p.id);
      if (g) {
        gain += g.views;
        maxDays = Math.max(maxDays, g.days);
        hasGain = true;
      }
    }
    return {
      accountId: a.id,
      platformSlug: a.platform_slug,
      handle: a.handle,
      displayName: a.display_name,
      isArchived: a.is_archived,
      lastSyncedAt: a.last_synced_at,
      lastSyncError: a.last_sync_error,
      videoCount: mine.length,
      totalViews: mine.reduce((s, p) => s + (one(p.metrics)?.views ?? 0), 0),
      recentGain: hasGain ? { views: gain, days: maxDays } : null,
    };
  });

  return {
    client: {
      id: client.id,
      name: client.name,
      email: client.email,
      isArchived: client.is_archived,
    },
    channels,
  };
}

async function gainsByPost(
  db: Db,
  ws: string,
  postIds: string[],
): Promise<Map<string, { views: number; days: number }>> {
  // Paged: a channel's snapshot history crosses PostgREST's silent 1000-row
  // cap within months of daily syncing, and ascending order means the cap
  // would keep the OLDEST rows -- gains computed on ancient history while
  // looking perfectly plausible. Same failure class as the content_
  // assignments truncation selectAll exists for; id breaks captured_at ties
  // so pages never overlap.
  const { data } = await selectAll(() =>
    db
      .from("post_snapshots")
      .select("id, platform_post_id, captured_at, views")
      .eq("workspace_id", ws)
      .in("platform_post_id", postIds)
      .order("captured_at")
      .order("id"),
  );

  const byPost = new Map<string, { at: number; views: number }[]>();
  for (const s of (data ?? []) as {
    platform_post_id: string;
    captured_at: string;
    views: number | null;
  }[]) {
    if (s.views == null) continue;
    if (!byPost.has(s.platform_post_id)) byPost.set(s.platform_post_id, []);
    byPost.get(s.platform_post_id)!.push({ at: new Date(s.captured_at).getTime(), views: s.views });
  }

  const out = new Map<string, { views: number; days: number }>();
  for (const [postId, series] of byPost) {
    if (series.length < 2) continue;
    const latest = series[series.length - 1];
    const prev = series[series.length - 2];
    out.set(postId, {
      views: latest.views - prev.views,
      days: Math.max(0, (latest.at - prev.at) / 86400000),
    });
  }
  return out;
}

export type ChannelVideo = {
  id: string;
  postId: string;
  title: string;
  producedAt: string | null;
  url: string | null;
  views: number;
  likes: number;
  comments: number;
  bestIndex: number | null;
  /** Everyone credited on the underlying content item, for the role circles. */
  credits: {
    assignmentId: string;
    roleSlug: string;
    userId: string;
    userName: string;
  }[];
};

export type ChannelDashboard = {
  account: {
    id: string;
    platformSlug: string;
    handle: string;
    displayName: string | null;
    clientId: string | null;
    clientName: string | null;
    isArchived: boolean;
    lastSyncedAt: string | null;
    lastSyncError: string | null;
  };
  totals: { views: number; likes: number; comments: number; videos: number };
  /** Total known reach across every tracked video, at each capture event that
      changed it -- a running total reconstructed from each video's own
      snapshot history, since videos are captured on independent schedules. */
  series: LineChartPoint[];
  videos: ChannelVideo[];
};

export async function loadChannelDashboard(
  db: Db,
  ws: string,
  accountId: string,
): Promise<ChannelDashboard | null> {
  const { data: account } = await db
    .from("accounts")
    .select(
      "id, platform_slug, handle, display_name, client_id, is_archived, last_synced_at, last_sync_error, client:clients(name)",
    )
    .eq("id", accountId)
    .eq("workspace_id", ws)
    .maybeSingle();
  if (!account) return null;

  const { data: postsData } = await db
    .from("platform_posts")
    .select(
      "id, content_item_id, url, content:content_items(id, title, produced_at), metrics:post_current_metrics(views, likes, comments)",
    )
    .eq("workspace_id", ws)
    .eq("account_id", accountId);

  type PostRow = {
    id: string;
    content_item_id: string;
    url: string | null;
    content: { id: string; title: string; produced_at: string | null } | { id: string; title: string; produced_at: string | null }[] | null;
    metrics:
      | { views: number | null; likes: number | null; comments: number | null }
      | { views: number | null; likes: number | null; comments: number | null }[]
      | null;
  };
  const posts = (postsData ?? []) as unknown as PostRow[];
  const postIds = posts.map((p) => p.id);

  // Paged for the same reason as gainsByPost above: the reach-over-time
  // curve merges every video's full history, and a truncated-at-1000
  // ascending read would silently end the chart months in the past.
  const { data: snapsData } = postIds.length
    ? await selectAll(() =>
        db
          .from("post_snapshots")
          .select("id, platform_post_id, captured_at, views")
          .eq("workspace_id", ws)
          .in("platform_post_id", postIds)
          .order("captured_at")
          .order("id"),
      )
    : { data: [] };

  type Snap = { platform_post_id: string; captured_at: string; views: number | null };
  const snaps = (snapsData ?? []) as Snap[];

  // Reconstruct a running total across all this account's videos, in true
  // chronological order of when any of them was actually measured. Each
  // video is captured on its own independent schedule, so this is a merge,
  // not a group-by: at every event, one video's contribution updates and
  // every other video's last-known reading carries forward unchanged.
  const events = [...snaps]
    .filter((s) => s.views != null)
    .sort((a, b) => a.captured_at.localeCompare(b.captured_at));

  const latestByPost = new Map<string, number>();
  const series: LineChartPoint[] = [];
  const seenDates = new Set<string>();
  for (const e of events) {
    latestByPost.set(e.platform_post_id, e.views!);
    const total = [...latestByPost.values()].reduce((s, v) => s + v, 0);
    const label = new Date(e.captured_at).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    // Multiple posts can be captured the same day; only the day's final
    // total is worth a point on the curve, not one per contributing post.
    if (seenDates.has(label)) {
      series[series.length - 1] = { x: label, y: total };
    } else {
      seenDates.add(label);
      series.push({ x: label, y: total });
    }
  }

  // Credits for just this channel's content items, so the role circles render
  // on these tiles too rather than being a Content-dashboard-only affordance.
  const contentIds = [
    ...new Set(posts.map((p) => one(p.content)?.id ?? p.content_item_id).filter(Boolean)),
  ];
  const creditsByItem = new Map<string, ChannelVideo["credits"]>();
  if (contentIds.length) {
    const { data: assigns } = await db
      .from("content_assignments")
      .select("id, content_item_id, user_id, profile:profiles(full_name), role:roles(slug)")
      .eq("workspace_id", ws)
      .in("content_item_id", contentIds);
    type Row = {
      id: string;
      content_item_id: string;
      user_id: string;
      profile: { full_name: string | null } | { full_name: string | null }[] | null;
      role: { slug: string } | { slug: string }[] | null;
    };
    for (const a of ((assigns ?? []) as unknown as Row[])) {
      if (!creditsByItem.has(a.content_item_id)) creditsByItem.set(a.content_item_id, []);
      creditsByItem.get(a.content_item_id)!.push({
        assignmentId: a.id,
        roleSlug: one(a.role)?.slug ?? "unknown",
        userId: a.user_id,
        userName: one(a.profile)?.full_name ?? "Unknown",
      });
    }
  }

  const videos: ChannelVideo[] = posts.map((p) => {
    const content = one(p.content);
    const m = one(p.metrics);
    const contentId = content?.id ?? p.content_item_id;
    return {
      id: contentId,
      postId: p.id,
      title: content?.title ?? "Untitled",
      producedAt: content?.produced_at ?? null,
      url: p.url,
      views: m?.views ?? 0,
      likes: m?.likes ?? 0,
      comments: m?.comments ?? 0,
      bestIndex: null,
      credits: creditsByItem.get(contentId) ?? [],
    };
  });
  videos.sort((a, b) => (b.producedAt ?? "").localeCompare(a.producedAt ?? ""));

  return {
    account: {
      id: account.id,
      platformSlug: account.platform_slug,
      handle: account.handle,
      displayName: account.display_name,
      clientId: account.client_id,
      clientName: one(account.client)?.name ?? null,
      isArchived: account.is_archived,
      lastSyncedAt: account.last_synced_at,
      lastSyncError: account.last_sync_error,
    },
    totals: {
      views: videos.reduce((s, v) => s + v.views, 0),
      likes: videos.reduce((s, v) => s + v.likes, 0),
      comments: videos.reduce((s, v) => s + v.comments, 0),
      videos: videos.length,
    },
    series,
    videos,
  };
}
