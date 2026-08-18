"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Trash2, X } from "lucide-react";
import { updateClientMeta, deleteAllGuidelines } from "@/app/(app)/guidelines/actions";
import { useToast } from "@/components/ui/Toast";

/**
 * Sets or clears a client's picture.
 *
 * clients.image_url and updateClientMeta both already existed -- the column
 * has been in the schema since the guidelines migration, and the action was
 * written to write it. Nothing ever called it, so the field was unreachable
 * and every client rendered the monogram fallback forever.
 *
 * A URL rather than an upload, deliberately. Storage would mean a bucket, a
 * signed-upload path, size and type validation, and a deletion story for
 * orphaned objects -- none of which this needs, because the picture is almost
 * always a logo that already lives somewhere public. ClientImage already
 * degrades to the monogram when a URL dies, so a stale link fails soft.
 */
export function ClientImageControl({
  clientId,
  currentUrl,
}: {
  clientId: string;
  currentUrl: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(currentUrl ?? "");
  const [busy, setBusy] = useState(false);

  async function save(next: string | null) {
    setBusy(true);
    const res = await updateClientMeta(clientId, { imageUrl: next });
    setBusy(false);
    if (res.error) return toast("danger", res.error);
    toast("success", next ? "Picture updated." : "Picture removed.");
    setOpen(false);
    startTransition(() => router.refresh());
  }

  if (!open) {
    return (
      <button className="btn py-1 text-xs" onClick={() => setOpen(true)}>
        <ImagePlus size={13} strokeWidth={1.8} />
        {currentUrl ? "Change picture" : "Add picture"}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        className="input min-w-0 flex-1 py-1 text-xs sm:max-w-[320px]"
        placeholder="Paste an image URL…"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        autoFocus
      />
      <button
        className="btn-primary py-1 text-xs"
        onClick={() => void save(url.trim() || null)}
        disabled={busy}
      >
        {busy ? "Saving…" : "Save"}
      </button>
      {currentUrl && (
        <button
          className="btn py-1 text-xs"
          onClick={() => void save(null)}
          disabled={busy}
          title="Remove the picture and fall back to the monogram"
        >
          Remove
        </button>
      )}
      <button className="btn-ghost p-1" onClick={() => setOpen(false)} aria-label="Cancel">
        <X size={14} strokeWidth={1.8} />
      </button>
    </div>
  );
}

/**
 * Clears every section and asset for one client, in one action.
 *
 * Two-step, and the confirm names the scope precisely -- "guidelines", not
 * "client". Someone tidying up a stale brief must not be able to mistake this
 * for deleting the client, so the copy says what survives as well as what
 * goes.
 */
export function DeleteGuidelinesButton({
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
    const res = await deleteAllGuidelines(clientId);
    setBusy(false);
    setConfirming(false);
    if (res.error) return toast("danger", res.error);
    toast("success", res.summary ?? "Guidelines deleted.");
    startTransition(() => router.refresh());
  }

  if (!confirming) {
    return (
      <button
        className="btn-ghost py-1 text-xs"
        onClick={() => setConfirming(true)}
        title={`Delete all guidelines for ${clientName}`}
      >
        <Trash2 size={13} strokeWidth={1.8} />
        Delete guidelines
      </button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-[var(--muted)]">
        Delete every section and asset? {clientName} itself stays.
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
