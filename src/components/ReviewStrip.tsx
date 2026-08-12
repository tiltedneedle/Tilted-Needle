"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, ChevronDown, X } from "lucide-react";
import { setContentReviewState } from "@/app/actions";
import { useToast } from "@/components/ui/Toast";

export type ReviewItem = {
  id: string;
  title: string;
  clientName: string | null;
  producedAt: string | null;
  platforms: string[];
};

/**
 * The approval queue, as a strip above the videos rather than a page.
 *
 * The sync reads a whole channel, so it collects everything on it -- including
 * clips the client posted themselves between our deliveries. Until now those
 * landed in the same table as agency work and counted toward every headline
 * number, quietly crediting the team with reach it did not produce. This is
 * where that gets decided.
 *
 * It sits ABOVE the video list because it is a queue, and a queue nobody
 * passes is a queue nobody empties. It stays collapsed to one line when there
 * is nothing waiting, so the normal state costs no attention.
 *
 * Rejecting never deletes. The row, its posts and its full metrics history all
 * survive -- the claim is about who MADE the video, not a reason to destroy
 * the record -- and it can be restored from the archive below at any time.
 */
export default function ReviewStrip({
  workspaceId,
  pending,
  rejected,
  approvedCount,
  newSinceSync,
  canManage,
}: {
  workspaceId: string;
  pending: ReviewItem[];
  rejected: ReviewItem[];
  approvedCount: number;
  /** How many pending arrived on the most recent sync. */
  newSinceSync: number;
  canManage: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [showRejected, setShowRejected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function review(ids: string[], state: "approved" | "rejected") {
    if (ids.length === 0) return;
    setBusy(true);
    const res = await setContentReviewState(workspaceId, ids, state);
    setBusy(false);
    if (res.error) return toast("danger", res.error);
    setSelected(new Set());
    toast(
      "success",
      `${res.updated ?? ids.length} video${(res.updated ?? ids.length) === 1 ? "" : "s"} ${state}.`,
    );
    startTransition(() => router.refresh());
  }

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Nothing waiting and nothing ever rejected: one quiet line, no controls.
  if (pending.length === 0 && rejected.length === 0) {
    return (
      <div className="mb-4 flex items-center gap-2 text-xs text-[var(--muted)]">
        <Check size={13} className="text-emerald-500" />
        <span>
          All {approvedCount.toLocaleString()} videos reviewed — nothing waiting.
        </span>
      </div>
    );
  }

  return (
    <div className="card mb-4 overflow-hidden">
      <button
        type="button"
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left transition-colors hover:bg-[var(--bg-subtle)]"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <ChevronDown
          size={14}
          className={`shrink-0 text-[var(--muted)] transition-transform duration-150 ${
            open ? "rotate-0" : "-rotate-90"
          }`}
        />
        <span className="text-sm font-medium">
          {pending.length > 0
            ? `${pending.length} awaiting review`
            : "Nothing awaiting review"}
        </span>
        {/* The user's "new videos gathered after sync". Worth its own badge:
            it is the difference between a backlog and something that just
            arrived. */}
        {newSinceSync > 0 && (
          <span className="rounded-full bg-[var(--accent)]/15 px-1.5 py-0.5 text-[11px] font-medium text-[var(--accent)]">
            {newSinceSync} new from the last sync
          </span>
        )}
        <span className="text-xs text-[var(--muted)]">
          {approvedCount.toLocaleString()} approved
          {rejected.length > 0 && ` · ${rejected.length} not ours`}
        </span>
      </button>

      {open && (
        <div className="border-t border-[var(--border)]">
          {pending.length === 0 ? (
            <p className="px-3 py-3 text-xs text-[var(--muted)]">
              Nothing is waiting. New videos appear here after each sync.
            </p>
          ) : (
            <>
              {canManage && (
                <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-2">
                  <button
                    className="btn px-2 py-1 text-xs"
                    onClick={() =>
                      setSelected(
                        selected.size === pending.length
                          ? new Set()
                          : new Set(pending.map((p) => p.id)),
                      )
                    }
                  >
                    {selected.size === pending.length ? "Select none" : "Select all"}
                  </button>
                  <span className="text-xs text-[var(--muted)]">
                    {selected.size} selected
                  </span>
                  <div className="flex-1" />
                  <button
                    className="btn-primary px-2.5 py-1 text-xs"
                    disabled={busy || selected.size === 0}
                    onClick={() => review([...selected], "approved")}
                  >
                    Ours — approve
                  </button>
                  <button
                    className="btn px-2.5 py-1 text-xs"
                    disabled={busy || selected.size === 0}
                    onClick={() => review([...selected], "rejected")}
                    title="The client posted this themselves. Kept with its metrics, but excluded from our numbers."
                  >
                    Not ours
                  </button>
                </div>
              )}

              <div className="divide-y divide-[var(--border)]">
                {pending.map((v) => (
                  <div key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                    {canManage && (
                      <input
                        type="checkbox"
                        className="size-3.5 shrink-0 accent-[var(--accent)]"
                        checked={selected.has(v.id)}
                        onChange={() => toggle(v.id)}
                        aria-label={`Select ${v.title}`}
                      />
                    )}
                    <Link
                      href={`/content?video=${v.id}`}
                      className="min-w-0 flex-1 truncate text-sm transition-colors hover:text-[var(--accent)]"
                    >
                      {v.title}
                    </Link>
                    <span className="shrink-0 text-xs text-[var(--muted)]">
                      {[v.clientName, v.producedAt, v.platforms.join(", ")]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {canManage && (
                      <span className="flex shrink-0 gap-1">
                        <button
                          className="rounded p-1 text-[var(--muted)] transition-colors hover:bg-emerald-500/10 hover:text-emerald-500"
                          title="Ours — approve"
                          disabled={busy}
                          onClick={() => review([v.id], "approved")}
                        >
                          <Check size={13} />
                        </button>
                        <button
                          className="rounded p-1 text-[var(--muted)] transition-colors hover:bg-[var(--danger)]/10 hover:text-[var(--danger)]"
                          title="Not ours — the client posted this"
                          disabled={busy}
                          onClick={() => review([v.id], "rejected")}
                        >
                          <X size={13} />
                        </button>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* The archive. Nothing here is deleted, and anything can come back. */}
          {rejected.length > 0 && (
            <div className="border-t border-[var(--border)]">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--muted)] transition-colors hover:bg-[var(--bg-subtle)]"
                onClick={() => setShowRejected((v) => !v)}
                aria-expanded={showRejected}
              >
                <ChevronDown
                  size={12}
                  className={`transition-transform duration-150 ${showRejected ? "rotate-0" : "-rotate-90"}`}
                />
                Not ours ({rejected.length}) — kept, with their metrics, out of our numbers
              </button>
              {showRejected && (
                <div className="divide-y divide-[var(--border)]">
                  {rejected.map((v) => (
                    <div key={v.id} className="flex items-center gap-3 px-3 py-1.5">
                      <Link
                        href={`/content?video=${v.id}`}
                        className="min-w-0 flex-1 truncate text-xs text-[var(--muted)] transition-colors hover:text-[var(--accent)]"
                      >
                        {v.title}
                      </Link>
                      {canManage && (
                        <button
                          className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-[var(--muted)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)]"
                          disabled={busy}
                          onClick={() => review([v.id], "approved")}
                        >
                          Actually ours
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
