import PageHeader from "@/components/PageHeader";
import ImportManager from "@/components/ImportManager";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { canManage, one } from "@/lib/types";

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string }>;
}) {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;

  if (!canManage(session.active.role)) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-6">
        <PageHeader title="Import" subtitle="" />
        <div className="card p-8 text-sm text-[var(--muted)]">
          Only owners, admins, and managers can import historical data.
        </div>
      </div>
    );
  }

  const { batch: activeBatchId } = await searchParams;

  const { data: batches } = await supabase
    .from("import_batches")
    .select("id, source, status, created_at, row_count, committed_at")
    .eq("workspace_id", ws)
    .order("created_at", { ascending: false });

  const { data: members } = await supabase
    .from("memberships")
    .select("user_id, profile:profiles(full_name)")
    .eq("workspace_id", ws)
    .eq("is_active", true);

  const { data: contentItems } = await supabase
    .from("content_items")
    .select("id, title")
    .eq("workspace_id", ws)
    .order("title");

  let activeBatch = null;
  let rows: unknown[] = [];
  let memberMap: unknown[] = [];

  if (activeBatchId) {
    const [batchRes, rowsRes, mapRes] = await Promise.all([
      supabase.from("import_batches").select("*").eq("id", activeBatchId).maybeSingle(),
      supabase
        .from("import_rows")
        .select(
          "id, description, project_name, task_name, member_name, started_at, ended_at, duration_seconds, suggested_content_item_id, match_confidence, resolved_content_item_id, status",
        )
        .eq("batch_id", activeBatchId)
        .order("match_confidence", { ascending: false, nullsFirst: false }),
      supabase.from("import_member_map").select("*").eq("batch_id", activeBatchId),
    ]);
    activeBatch = batchRes.data;
    rows = rowsRes.data ?? [];
    memberMap = mapRes.data ?? [];
  }

  type MemberRow = { user_id: string; profile: { full_name: string | null } | { full_name: string | null }[] | null };

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <PageHeader
        title="Import"
        subtitle="Pull historical time entries from Clockify and match them to content by title. Nothing lands in the timesheet until you commit."
      />
      <ImportManager
        workspaceId={ws}
        batches={
          (batches ?? []) as {
            id: string;
            source: string;
            status: string;
            created_at: string;
            row_count: number;
            committed_at: string | null;
          }[]
        }
        activeBatchId={activeBatchId ?? null}
        activeBatch={activeBatch as { id: string; status: string } | null}
        rows={
          rows as {
            id: string;
            description: string;
            project_name: string | null;
            task_name: string | null;
            member_name: string;
            started_at: string;
            ended_at: string | null;
            duration_seconds: number | null;
            suggested_content_item_id: string | null;
            match_confidence: number | null;
            resolved_content_item_id: string | null;
            status: string;
          }[]
        }
        memberMap={
          memberMap as {
            id: string;
            clockify_name: string;
            clockify_email: string | null;
            resolved_user_id: string | null;
          }[]
        }
        members={((members ?? []) as unknown as MemberRow[]).map((m) => ({
          userId: m.user_id,
          name: one(m.profile)?.full_name ?? "Unknown",
        }))}
        contentItems={(contentItems ?? []) as { id: string; title: string }[]}
      />
    </div>
  );
}
