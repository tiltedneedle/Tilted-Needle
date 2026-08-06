/**
 * Loaders for the Home command center -- the aggregates the landing page
 * charts read. Kept out of the page file because each one has a rule worth
 * documenting, and the member view reuses two of them.
 *
 * Every series here respects the house rule: platforms are never summed
 * onto one axis. Reach momentum is one sparkline PER platform (small
 * multiples); the only cross-platform sum that exists anywhere is a
 * video's own recent gain, which is the Content page's long-established
 * "still growing" semantic, reused unchanged.
 */
import { selectAll } from "@/lib/selectAll";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

const DAY_MS = 86400000;

/** YYYY-MM-DD of an instant, in the company's operating timezone. */
function dubaiDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(d);
}

/** Short axis label ("28 Jul") for a Dubai date string. */
function shortLabel(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

export type PlatformMomentum = {
  slug: string;
  /** Views gained per Dubai day, oldest first, zero-filled. */
  points: { x: string; y: number }[];
  total: number;
};

/**
 * Views gained per platform per day over the trailing window, from the
 * snapshot history: consecutive-snapshot deltas per post, bucketed by the
 * day the later reading landed. Negative deltas (a platform correcting its
 * own count downward) are clamped to zero rather than shown as negative
 * "gains" -- the chart answers "how much did reach move", not "what did
 * the API do".
 */
export async function loadPlatformMomentum(
  db: Db,
  ws: string,
  days = 30,
): Promise<PlatformMomentum[]> {
  const sinceIso = new Date(Date.now() - days * DAY_MS).toISOString();

  const [postsRes, snapsRes] = await Promise.all([
    db
      .from("platform_posts")
      .select("id, account:accounts(platform_slug)")
      .eq("workspace_id", ws),
    // Windowed but still paged: 30 days of daily syncing across every post
    // clears 1000 rows on its own.
    selectAll<{ id: string; platform_post_id: string; captured_at: string; views: number | null }>(
      () =>
        db
          .from("post_snapshots")
          .select("id, platform_post_id, captured_at, views")
          .eq("workspace_id", ws)
          .gte("captured_at", sinceIso)
          .order("captured_at")
          .order("id"),
    ),
  ]);

  const platformOfPost = new Map<string, string>();
  for (const p of (postsRes.data ?? []) as {
    id: string;
    account: { platform_slug: string } | { platform_slug: string }[] | null;
  }[]) {
    const acct = Array.isArray(p.account) ? p.account[0] : p.account;
    if (acct) platformOfPost.set(p.id, acct.platform_slug);
  }

  // Day buckets, oldest first, zero-filled so quiet days stay visible.
  const dayKeys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    dayKeys.push(dubaiDate(new Date(Date.now() - i * DAY_MS)));
  }

  const gains = new Map<string, Map<string, number>>(); // platform -> day -> views
  const lastSeen = new Map<string, number>(); // post -> previous views
  for (const s of snapsRes.data ?? []) {
    if (s.views == null) continue;
    const prev = lastSeen.get(s.platform_post_id);
    lastSeen.set(s.platform_post_id, s.views);
    if (prev == null) continue; // first reading in-window has no delta
    const delta = Math.max(0, s.views - prev);
    if (delta === 0) continue;
    const platform = platformOfPost.get(s.platform_post_id);
    if (!platform) continue;
    const day = dubaiDate(new Date(s.captured_at));
    if (!gains.has(platform)) gains.set(platform, new Map());
    const byDay = gains.get(platform)!;
    byDay.set(day, (byDay.get(day) ?? 0) + delta);
  }

  return [...gains.entries()]
    .map(([slug, byDay]) => {
      const points = dayKeys.map((k) => ({ x: shortLabel(k), y: byDay.get(k) ?? 0 }));
      return { slug, points, total: points.reduce((s, p) => s + p.y, 0) };
    })
    .sort((a, b) => b.total - a.total);
}

export type MoverVideo = {
  id: string;
  title: string;
  clientName: string | null;
  platforms: string[];
  gained: number;
};

/**
 * The videos that moved most this week -- same delta mechanism as
 * momentum, grouped per video. The cross-platform sum here mirrors the
 * Content page's "recent gain" exactly (a video's growth is one number
 * there too); platform identity rides the dot chips beside each row.
 */
export async function loadWeekMovers(db: Db, ws: string, limit = 5): Promise<MoverVideo[]> {
  const sinceIso = new Date(Date.now() - 7 * DAY_MS).toISOString();
  const [postsRes, snapsRes] = await Promise.all([
    db
      .from("platform_posts")
      .select("id, content_item_id, account:accounts(platform_slug)")
      .eq("workspace_id", ws),
    selectAll<{ id: string; platform_post_id: string; captured_at: string; views: number | null }>(
      () =>
        db
          .from("post_snapshots")
          .select("id, platform_post_id, captured_at, views")
          .eq("workspace_id", ws)
          .gte("captured_at", sinceIso)
          .order("captured_at")
          .order("id"),
    ),
  ]);

  type PostRow = {
    id: string;
    content_item_id: string;
    account: { platform_slug: string } | { platform_slug: string }[] | null;
  };
  const posts = new Map(((postsRes.data ?? []) as PostRow[]).map((p) => [p.id, p]));

  const gainByPost = new Map<string, number>();
  const lastSeen = new Map<string, number>();
  for (const s of snapsRes.data ?? []) {
    if (s.views == null) continue;
    const prev = lastSeen.get(s.platform_post_id);
    lastSeen.set(s.platform_post_id, s.views);
    if (prev == null) continue;
    const delta = Math.max(0, s.views - prev);
    if (delta > 0) gainByPost.set(s.platform_post_id, (gainByPost.get(s.platform_post_id) ?? 0) + delta);
  }

  const byItem = new Map<string, { gained: number; platforms: Set<string> }>();
  for (const [postId, gained] of gainByPost) {
    const post = posts.get(postId);
    if (!post) continue;
    const acct = Array.isArray(post.account) ? post.account[0] : post.account;
    if (!byItem.has(post.content_item_id)) {
      byItem.set(post.content_item_id, { gained: 0, platforms: new Set() });
    }
    const agg = byItem.get(post.content_item_id)!;
    agg.gained += gained;
    if (acct) agg.platforms.add(acct.platform_slug);
  }

  const top = [...byItem.entries()]
    .sort((a, b) => b[1].gained - a[1].gained)
    .slice(0, limit);
  if (top.length === 0) return [];

  const { data: items } = await db
    .from("content_items")
    .select("id, title, client:clients(name)")
    .in("id", top.map(([id]) => id));
  const titleOf = new Map(
    ((items ?? []) as {
      id: string;
      title: string;
      client: { name: string } | { name: string }[] | null;
    }[]).map((i) => [
      i.id,
      { title: i.title, clientName: (Array.isArray(i.client) ? i.client[0] : i.client)?.name ?? null },
    ]),
  );

  return top.map(([id, agg]) => ({
    id,
    title: titleOf.get(id)?.title ?? "Untitled",
    clientName: titleOf.get(id)?.clientName ?? null,
    platforms: [...agg.platforms],
    gained: agg.gained,
  }));
}

export type DayHours = { label: string; hint: string; seconds: number };

/**
 * Hours tracked per Dubai day of the current week (Mon..Sun), zero-filled
 * through today's position -- the bars a manager reads at a glance, and
 * the same shape a member's own card uses filtered to them.
 */
export async function loadWeekHoursByDay(
  db: Db,
  ws: string,
  weekStart: Date,
  userId?: string,
): Promise<DayHours[]> {
  let q = db
    .from("time_entries")
    .select("started_at, duration_seconds")
    .eq("workspace_id", ws)
    .gte("started_at", weekStart.toISOString())
    .not("ended_at", "is", null);
  if (userId) q = q.eq("user_id", userId);
  const { data } = await q;

  const days: DayHours[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart.getTime() + i * DAY_MS);
    days.push({
      label: d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "Asia/Dubai" }),
      hint: d.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "Asia/Dubai",
      }),
      seconds: 0,
    });
  }
  for (const t of (data ?? []) as { started_at: string; duration_seconds: number | null }[]) {
    const idx = Math.floor((new Date(t.started_at).getTime() - weekStart.getTime()) / DAY_MS);
    if (idx >= 0 && idx < 7) days[idx].seconds += t.duration_seconds ?? 0;
  }
  return days;
}
