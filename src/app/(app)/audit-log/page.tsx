import PageHeader from "@/components/PageHeader";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { canManage, one } from "@/lib/types";

export default async function AuditLogPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;

  if (!canManage(session.active.role)) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-6">
        <PageHeader title="Audit log" subtitle="" />
        <div className="card p-8 text-sm text-[var(--muted)]">
          Only owners, admins, and managers can view the audit log.
        </div>
      </div>
    );
  }

  const { data } = await supabase
    .from("audit_log")
    .select("id, action, entity_type, entity_id, detail, created_at, actor:profiles(full_name)")
    .eq("workspace_id", ws)
    .order("created_at", { ascending: false })
    .limit(300);

  type Row = {
    id: string;
    action: string;
    entity_type: string;
    entity_id: string | null;
    detail: Record<string, unknown>;
    created_at: string;
    actor: { full_name: string | null } | { full_name: string | null }[] | null;
  };

  const rows = (data ?? []) as unknown as Row[];

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <PageHeader
        title="Audit log"
        subtitle="Rate changes, approvals, and invoice actions. Append-only -- nothing here can be edited or deleted."
      />
      {rows.length === 0 ? (
        <div className="empty">
          Nothing recorded yet.
        </div>
      ) : (
        <div className="card divide-y divide-[var(--border)] overflow-hidden">
          {rows.map((r) => (
            <div key={r.id} className="px-3 py-2.5 text-sm">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{one(r.actor)?.full_name ?? "Unknown"}</span>
                <code className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-xs">
                  {r.action}
                </code>
                <span className="text-xs text-[var(--muted)]">{r.entity_type}</span>
                <div className="flex-1" />
                <span className="text-xs text-[var(--muted)]">
                  {new Date(r.created_at).toLocaleString([], {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              {Object.keys(r.detail ?? {}).length > 0 && (
                <pre className="mt-1 overflow-x-auto rounded bg-[var(--bg-subtle)] px-2 py-1 text-xs text-[var(--muted)]">
                  {JSON.stringify(r.detail)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
