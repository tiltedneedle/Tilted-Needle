import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import PersonDashboard from "@/components/PersonDashboard";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { one } from "@/lib/types";
import { totalsByPlatform, type MetricRow } from "@/lib/rollup";

export default async function PersonPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("id", userId)
    .maybeSingle();

  if (!profile) notFound();

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
    perItem
      .get(p.content_item_id)!
      .push({ platform: acct.platform_slug, views: m?.views ?? 0 });
  }

  // Roles this person holds, and on how many pieces.
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

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <Link
        href="/performance"
        className="mb-3 inline-block text-sm text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
      >
        ← Performance
      </Link>
      <PageHeader
        title={profile.full_name ?? "Unknown"}
        subtitle="Content this person is credited on, with reach kept separate by platform."
      />
      <PersonDashboard
        totals={totalsByPlatform(metricRows)}
        roles={[...roleCounts.entries()].map(([name, count]) => ({ name, count }))}
        trackedSeconds={trackedSeconds}
        items={items}
      />
    </div>
  );
}
