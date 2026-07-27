import PageHeader from "@/components/PageHeader";
import PerformanceView from "@/components/PerformanceView";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { one } from "@/lib/types";
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

export default async function PerformancePage() {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;

  const [postsRes, snapsRes, platformsRes, assignRes] = await Promise.all([
    supabase
      .from("platform_posts")
      .select(
        "id, content_item_id, account_id, posted_at, account:accounts(id, platform_slug), content:content_items(id, title)",
      )
      .eq("workspace_id", ws),
    supabase
      .from("post_snapshots")
      .select("platform_post_id, captured_at, views")
      .eq("workspace_id", ws)
      .order("captured_at"),
    supabase.from("platforms").select("*").eq("is_enabled", true).order("sort_order"),
    supabase
      .from("content_assignments")
      .select(
        "content_item_id, user_id, profile:profiles(full_name), role:roles(slug, name, sort_order)",
      )
      .eq("workspace_id", ws),
  ]);

  const platforms = (platformsRes.data ?? []) as unknown as Platform[];
  const windowFor = new Map(platforms.map((p) => [p.slug, p.maturity_window_days]));

  type RawPost = {
    id: string;
    content_item_id: string;
    account_id: string;
    posted_at: string | null;
    account: { id: string; platform_slug: string } | { id: string; platform_slug: string }[] | null;
    content: { id: string; title: string } | { id: string; title: string }[] | null;
  };
  const rawPosts = (postsRes.data ?? []) as unknown as RawPost[];

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
      postedAt: new Date(p.posted_at),
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
    content_item_id: string;
    user_id: string;
    profile: { full_name: string | null } | { full_name: string | null }[] | null;
    role: { slug: string; name: string; sort_order: number } | { slug: string; name: string; sort_order: number }[] | null;
  };

  // person+role -> platform -> their scored posts.
  const buckets = new Map<
    string,
    { name: string; roleSlug: string; roleName: string; byPlatform: Map<string, ScoredPost[]> }
  >();

  for (const a of (assignRes.data ?? []) as unknown as Assign[]) {
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

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <PageHeader
        title="Performance"
        subtitle="Each platform is scored on its own baseline. The overall is their average, never a pooled total."
      />
      <PerformanceView
        people={people}
        boosts={boosts}
        scoredPostCount={scoredByPost.size}
        totalPostCount={rawPosts.length}
      />
    </div>
  );
}
