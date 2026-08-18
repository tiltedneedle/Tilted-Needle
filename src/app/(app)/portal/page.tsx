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
    supabase.from("clients").select("id, name").is("deleted_at", null).is("deleted_at", null).limit(1).maybeSingle(),
    // Approved only. The portal is the agency's claim about what it
    // delivered, so a video the client posted themselves does not belong in
    // it -- not as a row and not in the totals. Hiding it entirely, rather
    // than listing it and excluding it from the figures, was the deliberate
    // choice: a portal where a row and a total disagree needs explaining
    // every time a client reads it.
    supabase
      .from("content_items")
      .select("id, title, produced_at, length_seconds, subject")
      .eq("review_state", "approved")
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

  /* The posts query cannot filter on approval by itself, so it is narrowed to
     the items that survived above. Without this the client's own posts would
     be absent from the LIST while still inflating the platform TOTALS -- the
     worst of both: a figure they cannot reconcile against anything on screen,
     and one that overstates what the agency delivered. */
  const shown = new Set(items.map((i) => i.id));

  for (const p of (postsRes.data ?? []) as unknown as PostRow[]) {
    if (!shown.has(p.content_item_id)) continue;
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
