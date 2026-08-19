"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setArchived } from "@/app/actions";
import { EmptyScreen } from "@/components/Stat";
import { Tag } from "lucide-react";

type Row = { id: string; name: string; is_archived: boolean };

export default function SimpleListManager({
  rows,
  table,
  addLabel,
  placeholder,
  emptyText,
  emptyHint,
  canManage,
  onCreate,
  detailHref,
}: {
  rows: Row[];
  table: "clients" | "tags" | "accounts";
  addLabel: string;
  placeholder: string;
  emptyText: string;
  /**
   * What this list is FOR, shown on a genuinely empty screen.
   *
   * A first-run screen is the only place the product gets to explain itself,
   * and without this /tags said "No tags yet." to somebody who could already
   * see that, in a thin bar with 570px of blank beneath it.
   */
  emptyHint?: string;
  canManage: boolean;
  onCreate: (name: string) => Promise<{ error?: string }>;
  /**
   * When set, each row links to `detailHref + id`. Pass a trailing "/" or "="
   * -- the id is appended verbatim, so a query-param target works too.
   */
  detailHref?: string;
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
    const res = await setArchived(table, row.id, !row.is_archived);
    if (res.error) setError(res.error);
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

      {/* NOTHING AT ALL is a different state from NOTHING MATCHED, and they
          need different answers: one explains the feature, the other tells you
          your search is too narrow. Collapsing them into one line is how a
          first-run screen ends up saying only that it is empty. */}
      {rows.length === 0 ? (
        <EmptyScreen icon={Tag} title={emptyText} hint={emptyHint}>
          {canManage && (
            <span className="text-[11px] text-[var(--muted)]">
              Use the field above to add the first one.
            </span>
          )}
        </EmptyScreen>
      ) : (
      <div className="card divide-y divide-[var(--border)] overflow-hidden">
        {/* THREE reasons a populated list can show nothing, and each has a
            different answer. Saying "no tags yet" to somebody whose only tag
            is archived sends them to create a duplicate; saying "nothing
            matches that search" when no search is typed is simply false. The
            live workspace has exactly one tag and it is archived, which is how
            both wordings got caught. */}
        {visible.length === 0 && (
          <div className="p-10 text-center text-sm text-[var(--muted)]">
            {query.trim() ? (
              <>Nothing matches “{query.trim()}”.</>
            ) : (
              <>
                {rows.length === 1 ? "The only entry here is" : `All ${rows.length} entries here are`}{" "}
                archived.{" "}
                <button
                  type="button"
                  className="underline underline-offset-2 transition-colors hover:text-[var(--fg)]"
                  onClick={() => setShowArchived(true)}
                >
                  Show archived
                </button>{" "}
                to see {rows.length === 1 ? "it" : "them"}.
              </>
            )}
          </div>
        )}
        {visible.map((r) => (
          <div
            key={r.id}
            className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--bg-subtle)]"
          >
            {detailHref ? (
              <Link
                href={`${detailHref}${r.id}`}
                className={`flex-1 text-sm transition-colors hover:text-[var(--accent)] ${
                  r.is_archived ? "line-through opacity-60" : ""
                }`}
              >
                {r.name}
              </Link>
            ) : (
              <span
                className={`flex-1 text-sm ${r.is_archived ? "line-through opacity-60" : ""}`}
              >
                {r.name}
              </span>
            )}
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
      )}
    </>
  );
}
