import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import NewContentForm from "@/components/NewContentForm";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { PLATFORM_COLORS, one } from "@/lib/types";
import type { Client, ContentItem } from "@/lib/types";

type PostRow = {
  content_item_id: string;
  account: { platform_slug: string } | null;
  metrics: { views: number | null }[] | { views: number | null } | null;
};

export default async function ContentPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;

  const [itemsRes, postsRes, clientsRes] = await Promise.all([
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

      {items.length === 0 ? (
        <div className="card p-10 text-center text-sm text-[var(--muted)]">
          No content yet. Add a video above, then attach the platforms it ran on.
        </div>
      ) : (
        <div className="card divide-y divide-[var(--border)] overflow-hidden">
          {items.map((item) => {
            const platforms = byItem.get(item.id);
            return (
              <Link
                key={item.id}
                href={`/content/${item.id}`}
                className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--bg-subtle)]"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{item.title}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--muted)]">
                    {item.client?.name && <span>{item.client.name}</span>}
                    {item.produced_at && <span>{item.produced_at}</span>}
                    {item.length_seconds != null && (
                      <span className="tabular">
                        {Math.floor(item.length_seconds / 60)}:
                        {String(item.length_seconds % 60).padStart(2, "0")}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {platforms && platforms.size > 0 ? (
                    [...platforms.entries()].map(([slug, views]) => (
                      <span
                        key={slug}
                        className="flex items-center gap-1 rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-xs"
                        title={`${slug}: ${views.toLocaleString()} views`}
                      >
                        <span
                          className="size-1.5 rounded-full"
                          style={{
                            background: PLATFORM_COLORS[slug] ?? "var(--muted)",
                          }}
                        />
                        <span className="tabular">{views.toLocaleString()}</span>
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-[var(--muted)]">
                      not posted yet
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
