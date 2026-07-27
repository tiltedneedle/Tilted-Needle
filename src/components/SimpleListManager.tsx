"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setArchived } from "@/app/actions";

type Row = { id: string; name: string; is_archived: boolean };

export default function SimpleListManager({
  rows,
  table,
  addLabel,
  placeholder,
  emptyText,
  canManage,
  onCreate,
}: {
  rows: Row[];
  table: "clients" | "tags";
  addLabel: string;
  placeholder: string;
  emptyText: string;
  canManage: boolean;
  onCreate: (name: string) => Promise<{ error?: string }>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => (showArchived ? true : !r.is_archived))
      .filter((r) => !q || r.name.toLowerCase().includes(q));
  }, [rows, showArchived, query]);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const res = await onCreate(name.trim());
    setBusy(false);
    if (res.error) return setError(res.error);
    setName("");
    startTransition(() => router.refresh());
  }

  async function toggle(row: Row) {
    await setArchived(table, row.id, !row.is_archived);
    startTransition(() => router.refresh());
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="input max-w-xs"
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--muted)]">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived
        </label>
      </div>

      {canManage && (
        <div className="mb-3 flex gap-2">
          <input
            className="input max-w-sm"
            placeholder={placeholder}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void create()}
          />
          <button className="btn-primary" onClick={create} disabled={busy}>
            {addLabel}
          </button>
        </div>
      )}

      {error && (
        <p className="mb-3 text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}

      <div className="card divide-y divide-[var(--border)] overflow-hidden">
        {visible.length === 0 && (
          <div className="p-10 text-center text-sm text-[var(--muted)]">
            {emptyText}
          </div>
        )}
        {visible.map((r) => (
          <div
            key={r.id}
            className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--bg-subtle)]"
          >
            <span
              className={`flex-1 text-sm ${r.is_archived ? "line-through opacity-60" : ""}`}
            >
              {r.name}
            </span>
            {canManage && (
              <button
                className="row-actions rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--fg)]"
                onClick={() => void toggle(r)}
              >
                {r.is_archived ? "Restore" : "Archive"}
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
