/**
 * Shared scoring/ranking computation behind the single-page dashboard
 * (PRD §1.1). Pulled out of the page component so the same numbers back
 * both the default team-rankings view and the roster section -- a person's
 * "overall" figure must never be computed two different ways in two places.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { one } from "@/lib/types";
import { selectAll } from "@/lib/selectAll";
import { loadExcludedItemIds } from "@/lib/excludedItems";
import {
  overallScore,
  platformScore,
  scoreAccountPosts,
  type PostInput,
  type ScoredPost,
} from "@/lib/scoring";
import type { Platform } from "@/lib/types";

export type PersonRow = {
  userId: string;
  name: string;
  roleSlug: string;
  roleName: string;
  platforms: { platform: string; score: number; n: number; rankable: boolean }[];
  overall: number | null;
  contributing: number;
};

export type BoostRow = {
  contentId: string;
  title: string;
  platform: string;
  index: number;
  views: number;
};

export type RankingsResult = {
  people: PersonRow[];
  boosts: BoostRow[];
  scoredByPost: Map<string, ScoredPost>;
  scoredByContent: Map<string, ScoredPost[]>;
  rawPostCount: number;
  postedContentIds: Set<string>;
  assignments: {
    /** The assignment row's own id, so a credit can be removed from a tile. */
    id: string;
    content_item_id: string;
    user_id: string;
    userName: string;
    roleSlug: string;
    roleName: string;
  }[];
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function computeRankings(supabase: SupabaseClient<any>, ws: string): Promise<RankingsResult> {
  /* An archived client's work must not sit inside anyone's score.

     This read was workspace-wide with no exclusion at all, which meant that
     deactivating a client removed their videos from /content -- visibly --
     while leaving them inside every role mean, every person's platform
     totals, and every ranking derived from them. The page said the work was
     gone and the numbers said it was not.

     Both the scored posts AND the returned assignments are filtered below.
     Filtering only the scores would leave personStats still counting those
     videos, which is the same bug moved one layer down and harder to see. */
  const excluded = await loadExcludedItemIds(supabase as never, ws);

  // These three read whole tables and all outgrow a single 1000-row response,
  // so they page. Truncation here is invisible and produces scores computed on
  // a prefix of the credits -- see selectAll.
  const [postsRes, snapsRes, platformsRes, assignRes] = await Promise.all([
    selectAll(() =>
      supabase
        .from("platform_posts")
        .select(
          "id, content_item_id, account_id, posted_at, posted_at_ts, account:accounts(id, platform_slug), content:content_items(id, title)",
        )
        .eq("workspace_id", ws)
        .order("id"),
    ),
    selectAll(() =>
      supabase
        .from("post_snapshots")
        .select("id, platform_post_id, captured_at, views")
        .eq("workspace_id", ws)
        // captured_at drives the series; id only breaks ties so paging is stable.
        .order("captured_at")
        .order("id"),
    ),
    supabase.from("platforms").select("*").eq("is_enabled", true).order("sort_order"),
    selectAll(() =>
      supabase
        .from("content_assignments")
        .select(
          "id, content_item_id, user_id, profile:profiles(full_name), role:roles(slug, name, sort_order)",
        )
        .eq("workspace_id", ws)
        .order("id"),
    ),
  ]);

  const platforms = (platformsRes.data ?? []) as unknown as Platform[];
  const windowFor = new Map(platforms.map((p) => [p.slug, p.maturity_window_days]));

  type RawPost = {
    id: string;
    content_item_id: string;
    account_id: string;
    posted_at: string | null;
    /** The real publish instant; posted_at is only its UTC date slice. */
    posted_at_ts: string | null;
    account: { id: string; platform_slug: string } | { id: string; platform_slug: string }[] | null;
    content: { id: string; title: string } | { id: string; title: string }[] | null;
  };
  // Filtered at the source, so nothing downstream -- scores, role means,
  // per-platform baselines -- can accidentally see an excluded video.
  const rawPosts = ((postsRes.data ?? []) as unknown as RawPost[]).filter(
    (p) => !excluded.has(p.content_item_id),
  );
  const postedContentIds = new Set(rawPosts.map((p) => p.content_item_id));

  const snapsByPost = new Map<string, { capturedAt: Date; value: number }[]>();
  for (const s of (snapsRes.data ?? []) as {
    platform_post_id: string;
    captured_at: string;
    views: number | null;
  }[]) {
    if (s.views == null) continue;
    if (!snapsByPost.has(s.platform_post_id)) snapsByPost.set(s.platform_post_id, []);
    snapsByPost
      .get(s.platform_post_id)!
      .push({ capturedAt: new Date(s.captured_at), value: s.views });
  }

  // Group by account, because a baseline is per account per platform. Pooling
  // accounts here would be the exact mistake the model exists to prevent.
  const byAccount = new Map<string, PostInput[]>();
  const postMeta = new Map<string, { contentId: string; title: string; platform: string }>();

  for (const p of rawPosts) {
    const acct = one(p.account);
    const content = one(p.content);
    if (!acct || !p.posted_at) continue;
    const input: PostInput = {
      postId: p.id,
      accountId: acct.id,
      platform: acct.platform_slug,
      /**
       * The INSTANT where we have one, not the date.
       *
       * scoring.ts orders an account's posts by this to build each post's
       * "prior window" -- the videos that came before it. Given a date, every
       * post published on the same day compares equal, so their order falls to
       * whatever the array happened to hold, and a baseline computed from
       * "the previous ten posts" quietly depends on row order. Two runs could
       * disagree. The instant makes it deterministic and correct.
       */
      postedAt: new Date(p.posted_at_ts ?? p.posted_at),
      snapshots: snapsByPost.get(p.id) ?? [],
    };
    if (!byAccount.has(acct.id)) byAccount.set(acct.id, []);
    byAccount.get(acct.id)!.push(input);
    postMeta.set(p.id, {
      contentId: p.content_item_id,
      title: content?.title ?? "Untitled",
      platform: acct.platform_slug,
    });
  }

  const scoredByPost = new Map<string, ScoredPost>();
  for (const [, posts] of byAccount) {
    const windowDays = windowFor.get(posts[0].platform) ?? 7;
    for (const s of scoreAccountPosts(posts, windowDays)) {
      scoredByPost.set(s.postId, s);
    }
  }

  // Content -> its scored posts, so a person's credits map to performance.
  const scoredByContent = new Map<string, ScoredPost[]>();
  for (const [postId, s] of scoredByPost) {
    const meta = postMeta.get(postId);
    if (!meta) continue;
    if (!scoredByContent.has(meta.contentId)) scoredByContent.set(meta.contentId, []);
    scoredByContent.get(meta.contentId)!.push(s);
  }

  type Assign = {
    id: string;
    content_item_id: string;
    user_id: string;
    profile: { full_name: string | null } | { full_name: string | null }[] | null;
    role: { slug: string; name: string; sort_order: number } | { slug: string; name: string; sort_order: number }[] | null;
  };
  // The second half of the same rule. personStats derives its video set from
  // the assignments it is handed, so leaving excluded credits in here would
  // put an archived client's videos straight back into every person's totals
  // and every per-role board -- with the scores above correctly filtered,
  // which is the confusing version of the bug rather than the obvious one.
  const rawAssigns = ((assignRes.data ?? []) as unknown as Assign[]).filter(
    (a) => !excluded.has(a.content_item_id),
  );

  // person+role -> platform -> their scored posts.
  const buckets = new Map<
    string,
    { name: string; roleSlug: string; roleName: string; byPlatform: Map<string, ScoredPost[]> }
  >();

  for (const a of rawAssigns) {
    const role = one(a.role);
    const profile = one(a.profile);
    if (!role) continue;
    const key = `${a.user_id}::${role.slug}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        name: profile?.full_name ?? "Unknown",
        roleSlug: role.slug,
        roleName: role.name,
        byPlatform: new Map(),
      });
    }
    const bucket = buckets.get(key)!;
    for (const s of scoredByContent.get(a.content_item_id) ?? []) {
      if (!bucket.byPlatform.has(s.platform)) bucket.byPlatform.set(s.platform, []);
      bucket.byPlatform.get(s.platform)!.push(s);
    }
  }

  // Role mean per platform, the target that shrinkage pulls small samples
  // toward. Computed within a role so editors are only compared to editors.
  const roleMeans = new Map<string, number>();
  const acc = new Map<string, { sum: number; n: number }>();
  for (const [key, b] of buckets) {
    const roleSlug = key.split("::")[1];
    for (const [plat, posts] of b.byPlatform) {
      const k = `${roleSlug}::${plat}`;
      if (!acc.has(k)) acc.set(k, { sum: 0, n: 0 });
      const e = acc.get(k)!;
      for (const p of posts) {
        e.sum += p.score;
        e.n += 1;
      }
    }
  }
  for (const [k, v] of acc) roleMeans.set(k, v.n ? v.sum / v.n : 0);

  const people: PersonRow[] = [];
  for (const [key, b] of buckets) {
    const userId = key.split("::")[0];
    const scores = [...b.byPlatform.entries()].map(([plat, posts]) =>
      platformScore(plat, posts, roleMeans.get(`${b.roleSlug}::${plat}`) ?? 0),
    );
    if (scores.length === 0) continue;
    const o = overallScore(scores);
    people.push({
      userId,
      name: b.name,
      roleSlug: b.roleSlug,
      roleName: b.roleName,
      platforms: scores,
      overall: o.overall,
      contributing: o.contributing,
    });
  }
  people.sort((a, b) => (b.overall ?? -99) - (a.overall ?? -99));

  const boosts: BoostRow[] = [];
  for (const [postId, s] of scoredByPost) {
    if (s.index < 2) continue;
    const meta = postMeta.get(postId);
    if (!meta) continue;
    const snaps = snapsByPost.get(postId) ?? [];
    boosts.push({
      contentId: meta.contentId,
      title: meta.title,
      platform: s.platform,
      index: s.index,
      views: snaps.length ? snaps[snaps.length - 1].value : 0,
    });
  }
  boosts.sort((a, b) => b.index - a.index);

  return {
    people,
    boosts,
    scoredByPost,
    scoredByContent,
    rawPostCount: rawPosts.length,
    postedContentIds,
    assignments: rawAssigns.map((a) => ({
      id: a.id,
      content_item_id: a.content_item_id,
      user_id: a.user_id,
      userName: one(a.profile)?.full_name ?? "Unknown",
      roleSlug: one(a.role)?.slug ?? "unknown",
      roleName: one(a.role)?.name ?? "Unknown",
    })),
  };
}

export type RosterRow = {
  userId: string;
  name: string;
  roles: string[];
  overall: number | null;
  contentCount: number;
  ongoingCount: number;
};

/**
 * One row per active member, regardless of whether they have scoreable
 * posts yet -- PRD §1.1.5 wants every employee listed, not just the ones
 * with enough history to rank.
 */
export function buildRoster(
  members: { userId: string; name: string }[],
  rankings: RankingsResult,
): RosterRow[] {
  const overallByUser = new Map<string, number[]>();
  for (const p of rankings.people) {
    if (p.overall == null) continue;
    if (!overallByUser.has(p.userId)) overallByUser.set(p.userId, []);
    overallByUser.get(p.userId)!.push(p.overall);
  }

  const rolesByUser = new Map<string, Set<string>>();
  const contentByUser = new Map<string, Set<string>>();
  const ongoingByUser = new Map<string, Set<string>>();

  for (const a of rankings.assignments) {
    if (!rolesByUser.has(a.user_id)) rolesByUser.set(a.user_id, new Set());
    rolesByUser.get(a.user_id)!.add(a.roleName);

    if (!contentByUser.has(a.user_id)) contentByUser.set(a.user_id, new Set());
    contentByUser.get(a.user_id)!.add(a.content_item_id);

    if (!rankings.postedContentIds.has(a.content_item_id)) {
      if (!ongoingByUser.has(a.user_id)) ongoingByUser.set(a.user_id, new Set());
      ongoingByUser.get(a.user_id)!.add(a.content_item_id);
    }
  }

  return members
    .map((m) => {
      const overalls = overallByUser.get(m.userId) ?? [];
      return {
        userId: m.userId,
        name: m.name,
        roles: [...(rolesByUser.get(m.userId) ?? [])],
        overall: overalls.length ? overalls.reduce((s, v) => s + v, 0) / overalls.length : null,
        contentCount: contentByUser.get(m.userId)?.size ?? 0,
        ongoingCount: ongoingByUser.get(m.userId)?.size ?? 0,
      };
    })
    .sort((a, b) => (b.overall ?? -99) - (a.overall ?? -99));
}
