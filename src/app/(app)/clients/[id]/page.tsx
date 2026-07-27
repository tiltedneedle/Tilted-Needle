import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import ClientDashboard from "@/components/ClientDashboard";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { one } from "@/lib/types";
import { totalsByPlatform, type MetricRow } from "@/lib/rollup";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;

  const { data: client } = await supabase
    .from("clients")
    .select("id, name, email, is_archived")
    .eq("id", id)
    .maybeSingle();

  if (!client) notFound();

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

  type Item = {
    id: string;
    title: string;
    produced_at: string | null;
    length_seconds: number | null;
  };
  const items = (itemsRes.data ?? []) as Item[];
  const itemIds = new Set(items.map((i) => i.id));

  type PostRow = {
    id: string;
    content_item_id: string;
    account:
      | { platform_slug: string; client_id: string | null }
      | { platform_slug: string; client_id: string | null }[]
      | null;
    metrics:
      | { views: number | null; likes: number | null; comments: number | null }
      | { views: number | null; likes: number | null; comments: number | null }[]
      | null;
  };

  // Only posts belonging to this client's content.
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
    perItem
      .get(p.content_item_id)!
      .push({ platform: acct.platform_slug, views: m?.views ?? 0 });
  }

  let totalSeconds = 0;
  for (const t of (timeRes.data ?? []) as {
    duration_seconds: number | null;
    content_item_id: string | null;
  }[]) {
    if (t.content_item_id && itemIds.has(t.content_item_id)) {
      totalSeconds += t.duration_seconds ?? 0;
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <Link
        href="/clients"
        className="mb-3 inline-block text-sm text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
      >
        ← Clients
      </Link>
      <PageHeader
        title={client.name}
        subtitle="What has been delivered for this client, kept separate by platform."
      />
      <ClientDashboard
        totals={totalsByPlatform(metricRows)}
        itemCount={items.length}
        trackedSeconds={totalSeconds}
        items={items.map((i) => ({
          id: i.id,
          title: i.title,
          producedAt: i.produced_at,
          platforms: perItem.get(i.id) ?? [],
        }))}
      />
    </div>
  );
}
