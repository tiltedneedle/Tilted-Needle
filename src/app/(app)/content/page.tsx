import PageHeader from "@/components/PageHeader";
import NewContentForm from "@/components/NewContentForm";
import ContentList from "@/components/ContentList";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { one } from "@/lib/types";
import type { Client, ContentItem, Platform } from "@/lib/types";

type PostRow = {
  content_item_id: string;
  account: { platform_slug: string } | null;
  metrics: { views: number | null }[] | { views: number | null } | null;
};

export default async function ContentPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;

  const [itemsRes, postsRes, clientsRes, platformsRes, timeRes] = await Promise.all([
    supabase
      .from("content_items")
      .select(
        "id, workspace_id, client_id, title, subject, hook, music_used, length_seconds, produced_at, notes, client:clients(id, name)",
      )
      .eq("workspace_id", ws)
      .order("produced_at", { ascending: false, nullsFirst: false })
      .limit(200),
    supabase
      .from("platform_posts")
      .select(
        "content_item_id, account:accounts(platform_slug), metrics:post_current_metrics(views)",
      )
      .eq("workspace_id", ws),
    supabase
      .from("clients")
      .select("id, workspace_id, name, email, is_archived")
      .eq("workspace_id", ws)
      .order("name"),
    supabase
      .from("platforms")
      .select("*")
      .eq("is_enabled", true)
      .order("sort_order"),
    // Hours invested per piece of content -- the half of the join that time
    // tracking contributes (PRD 6.7).
    supabase
      .from("time_entries")
      .select("content_item_id, duration_seconds")
      .eq("workspace_id", ws)
      .not("content_item_id", "is", null)
      .not("ended_at", "is", null),
  ]);

  const items = (itemsRes.data ?? []) as unknown as ContentItem[];
  const posts = (postsRes.data ?? []) as unknown as PostRow[];

  // Per-platform view counts, deliberately kept separate. Summing them would
  // add incomparable units and flatter whichever platform counts loosest
  // (PRD 5 Step 2).
  const byItem = new Map<string, Map<string, number>>();
  for (const p of posts) {
    if (!p.account) continue;
    if (!byItem.has(p.content_item_id)) byItem.set(p.content_item_id, new Map());
    byItem
      .get(p.content_item_id)!
      .set(p.account.platform_slug, one(p.metrics)?.views ?? 0);
  }

  const hoursByItem = new Map<string, number>();
  for (const t of (timeRes.data ?? []) as {
    content_item_id: string | null;
    duration_seconds: number | null;
  }[]) {
    if (!t.content_item_id) continue;
    hoursByItem.set(
      t.content_item_id,
      (hoursByItem.get(t.content_item_id) ?? 0) + (t.duration_seconds ?? 0),
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <PageHeader
        title="Content"
        subtitle="One item per video. It fans out to each platform it was posted on."
      />

      <NewContentForm
        workspaceId={ws}
        clients={(clientsRes.data ?? []) as unknown as Client[]}
      />

      <ContentList
        items={items}
        clients={(clientsRes.data ?? []) as unknown as Client[]}
        platforms={(platformsRes.data ?? []) as unknown as Platform[]}
        viewsByItem={Object.fromEntries(
          [...byItem.entries()].map(([k, v]) => [k, Object.fromEntries(v)]),
        )}
        secondsByItem={Object.fromEntries(hoursByItem)}
      />
    </div>
  );
}
