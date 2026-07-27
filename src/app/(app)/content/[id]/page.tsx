import Link from "next/link";
import { notFound } from "next/navigation";
import ContentDetail from "@/components/ContentDetail";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import type {
  Account,
  ContentAssignment,
  ContentItem,
  PlatformPost,
  Role,
} from "@/lib/types";

export default async function ContentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;

  const { data: item } = await supabase
    .from("content_items")
    .select(
      "id, workspace_id, client_id, title, subject, hook, music_used, length_seconds, produced_at, notes, client:clients(id, name)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!item) notFound();

  const [postsRes, accountsRes, rolesRes, assignRes, membersRes, timeRes] =
    await Promise.all([
      supabase
        .from("platform_posts")
        .select(
          `id, workspace_id, content_item_id, account_id, url, posted_at, source,
           is_best_performing, comment_sentiment,
           account:accounts(id, platform_slug, handle, connection_mode),
           metrics:post_current_metrics(views, likes, comments, shares, saves, reach, captured_at)`,
        )
        .eq("content_item_id", id),
      supabase
        .from("accounts")
        .select("id, workspace_id, client_id, platform_slug, handle, connection_mode, is_archived")
        .eq("workspace_id", ws)
        .eq("is_archived", false)
        .order("platform_slug"),
      supabase
        .from("roles")
        .select("id, workspace_id, slug, name, sort_order")
        .eq("workspace_id", ws)
        .order("sort_order"),
      supabase
        .from("content_assignments")
        .select("id, content_item_id, user_id, role_id, source, profile:profiles(full_name)")
        .eq("content_item_id", id),
      supabase
        .from("memberships")
        .select("user_id, profile:profiles(full_name)")
        .eq("workspace_id", ws)
        .eq("is_active", true),
      // The join: hours actually invested in this piece of content (PRD 6.7).
      supabase
        .from("time_entries")
        .select("duration_seconds, user_id")
        .eq("content_item_id", id)
        .not("ended_at", "is", null),
    ]);

  type Member = { user_id: string; profile: { full_name: string | null } | null };
  const members = (membersRes.data ?? []) as unknown as Member[];
  const timeRows = (timeRes.data ?? []) as { duration_seconds: number | null }[];
  const totalSeconds = timeRows.reduce((s, r) => s + (r.duration_seconds ?? 0), 0);

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <Link
        href="/content"
        className="mb-3 inline-block text-sm text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
      >
        ← Content
      </Link>

      <ContentDetail
        workspaceId={ws}
        item={item as unknown as ContentItem}
        posts={(postsRes.data ?? []) as unknown as PlatformPost[]}
        accounts={(accountsRes.data ?? []) as unknown as Account[]}
        roles={(rolesRes.data ?? []) as unknown as Role[]}
        assignments={(assignRes.data ?? []) as unknown as ContentAssignment[]}
        members={members.map((m) => ({
          userId: m.user_id,
          name: m.profile?.full_name ?? "Unknown",
        }))}
        trackedSeconds={totalSeconds}
      />
    </div>
  );
}
