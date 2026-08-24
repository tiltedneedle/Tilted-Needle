import PageHeader from "@/components/PageHeader";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { canManage, one } from "@/lib/types";
import AuditDetail, { type LabelLookup } from "@/components/AuditDetail";

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

  /* Resolve every id any entry mentions, in ONE query per table.
     An audit log that prints "83198846-c2f9-…" answers none of the question
     it exists to answer. Titles are read for display only: a row deleted
     since the entry was written simply has no title, and the component falls
     back to the id rather than dropping the entry -- an audit record of a
     since-deleted thing is exactly the record you most need to keep.

     Ids are collected across ALL rows first so this stays one round trip
     however long the log is, rather than one per entry. */
  const ids = new Set<string>();
  for (const r of rows) {
    for (const v of Object.values(r.detail ?? {})) {
      if (Array.isArray(v)) for (const x of v) if (typeof x === "string") ids.add(x);
    }
    if (r.entity_id) ids.add(r.entity_id);
  }

  const labels: LabelLookup = new Map();
  if (ids.size > 0) {
    const list = [...ids];
    const [items, clients] = await Promise.all([
      supabase.from("content_items").select("id, title").eq("workspace_id", ws).in("id", list),
      supabase.from("clients").select("id, name").eq("workspace_id", ws).in("id", list),
    ]);
    for (const i of (items.data ?? []) as { id: string; title: string }[]) {
      labels.set(i.id, i.title);
    }
    for (const c of (clients.data ?? []) as { id: string; name: string }[]) {
      labels.set(c.id, c.name);
    }
  }

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
              <AuditDetail detail={r.detail} labels={labels} entityType={r.entity_type} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
