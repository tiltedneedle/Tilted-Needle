import PageHeader from "@/components/PageHeader";
import ClientDashboard from "@/components/ClientDashboard";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { one } from "@/lib/types";
import { totalsByPlatform, type MetricRow } from "@/lib/rollup";

/**
 * The client-facing view. Everything here is already constrained by RLS -- a
 * client user physically cannot read another client's rows -- so this page
 * filters for presentation, not for security.
 */
export default async function PortalPage() {
  const session = await requireSession();
  const supabase = await createClient();

  const [clientRes, itemsRes, postsRes] = await Promise.all([
    supabase.from("clients").select("id, name").limit(1).maybeSingle(),
    supabase
      .from("content_items")
      .select("id, title, produced_at, length_seconds, subject")
      .order("produced_at", { ascending: false, nullsFirst: false }),
    supabase
      .from("platform_posts")
      .select(
        "content_item_id, posted_at, account:accounts(platform_slug), metrics:post_current_metrics(views, likes, comments)",
      ),
  ]);

  type Item = {
    id: string;
    title: string;
    produced_at: string | null;
    length_seconds: number | null;
    subject: string | null;
  };
  type PostRow = {
    content_item_id: string;
    account: { platform_slug: string } | { platform_slug: string }[] | null;
    metrics:
      | { views: number | null; likes: number | null; comments: number | null }
      | { views: number | null; likes: number | null; comments: number | null }[]
      | null;
  };

  const items = (itemsRes.data ?? []) as Item[];
  const metricRows: MetricRow[] = [];
  const perItem = new Map<string, { platform: string; views: number }[]>();

  for (const p of (postsRes.data ?? []) as unknown as PostRow[]) {
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

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <PageHeader
        title={clientRes.data?.name ?? session.active.name}
        subtitle="Everything published for you, with results kept separate by platform."
      />
      <ClientDashboard
        totals={totalsByPlatform(metricRows)}
        itemCount={items.length}
        // Internal hours are deliberately not surfaced to clients; passing 0
        // suppresses the time and hours-per-1k figures.
        trackedSeconds={0}
        items={items.map((i) => ({
          id: i.id,
          title: i.title,
          producedAt: i.produced_at,
          platforms: perItem.get(i.id) ?? [],
        }))}
        readOnly
      />
    </div>
  );
}
