"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Undo2, AlertTriangle } from "lucide-react";
import { binClient, restoreClient } from "@/app/actions";
import { useToast } from "@/components/ui/Toast";
import { CLIENT_BIN_DAYS, type BinnedClient } from "@/lib/clientBin";

/**
 * Delete control for one client.
 *
 * Two-step, and the confirm names what will actually happen rather than
 * asking "are you sure?". A client carries months of content; "delete" on its
 * own does not distinguish between "hide this" and "destroy the reporting
 * history", so the copy says which.
 */
export function DeleteClientButton({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const res = await binClient(clientId);
    setBusy(false);
    setConfirming(false);
    if (res.error) return toast("danger", res.error);
    toast("success", res.summary ?? "Moved to the bin.");
    startTransition(() => router.refresh());
  }

  if (!confirming) {
    return (
      <button
        className="btn-ghost p-1.5"
        title={`Delete ${clientName}`}
        aria-label={`Delete ${clientName}`}
        onClick={(e) => {
          // The row is a link; deleting must not also navigate into it.
          e.preventDefault();
          e.stopPropagation();
          setConfirming(true);
        }}
      >
        <Trash2 size={14} strokeWidth={1.8} />
      </button>
    );
  }

  return (
    <span
      className="flex items-center gap-1.5"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <span className="text-[11px] text-[var(--muted)]">
        Delete? {CLIENT_BIN_DAYS}d to undo
      </span>
      <button
        className="btn py-0.5 text-[11px]"
        style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
        onClick={() => void run()}
        disabled={busy}
      >
        {busy ? "…" : "Delete"}
      </button>
      <button className="btn-ghost py-0.5 text-[11px]" onClick={() => setConfirming(false)}>
        Cancel
      </button>
    </span>
  );
}

/**
 * The bin: what has been deleted, how long each has left, and one click back.
 *
 * Shows the content count per client because that is the number that decides
 * whether restoring matters. "Kyoto — 0 videos" and "Ameerh Naran — 175
 * videos" are very different mistakes to have made.
 */
export function ClientBinPanel({ clients }: { clients: BinnedClient[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  if (clients.length === 0) return null;

  async function restore(id: string) {
    setBusy(id);
    const res = await restoreClient(id);
    setBusy(null);
    if (res.error) return toast("danger", res.error);
    toast("success", res.summary ?? "Restored.");
    startTransition(() => router.refresh());
  }

  return (
    <details className="mt-6" open>
      <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--muted)]">
        <Trash2 size={12} strokeWidth={1.8} />
        Recycle bin — {clients.length} client{clients.length === 1 ? "" : "s"}
      </summary>
      <div className="mt-2 space-y-2">
        {clients.map((c) => {
          // One day left is the point at which this stops being a note and
          // starts being a warning.
          const urgent = c.daysLeft <= 1;
          return (
            <div key={c.id} className="card flex flex-wrap items-center gap-3 p-3">
              {urgent && (
                <AlertTriangle size={14} className="shrink-0 text-[var(--danger)]" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{c.name}</span>
                <span className="text-xs text-[var(--muted)]">
                  {c.itemCount} video{c.itemCount === 1 ? "" : "s"} · deleted{" "}
                  {c.deletedAt.slice(0, 10)}
                </span>
              </span>
              <span
                className="text-xs"
                style={{ color: urgent ? "var(--danger)" : "var(--muted)" }}
              >
                {c.daysLeft === 0
                  ? "purging now"
                  : `${c.daysLeft} day${c.daysLeft === 1 ? "" : "s"} left`}
              </span>
              <button
                className="btn py-1 text-xs"
                onClick={() => void restore(c.id)}
                disabled={busy === c.id}
              >
                <Undo2 size={13} strokeWidth={1.8} />
                {busy === c.id ? "Restoring…" : "Restore"}
              </button>
            </div>
          );
        })}
      </div>
      {/* States the consequence once, at the bottom, rather than on every
          row. After the window the client AND its content are gone for good --
          this is the only place in the product where that is true. */}
      <p className="mt-2 text-[11px] text-[var(--muted)]">
        After {CLIENT_BIN_DAYS} days a client and all of its videos are deleted permanently.
        Until then, restoring brings back everything.
      </p>
    </details>
  );
}
