"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { updateClientRecord } from "@/app/actions";
import { useToast } from "@/components/ui/Toast";

/**
 * Rename a client, fix their email, keep a note -- the basics that were
 * create-only until this existed. Collapsed behind a ghost button so the
 * client page stays a dashboard, not a form.
 */
export default function EditClientForm({
  clientId,
  name,
  email,
  note,
}: {
  clientId: string;
  name: string;
  email: string | null;
  note: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ name, email: email ?? "", note: note ?? "" });
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button className="btn-ghost text-xs" onClick={() => setOpen(true)}>
        <Pencil size={13} strokeWidth={1.8} /> Edit
      </button>
    );
  }

  async function save() {
    setBusy(true);
    const res = await updateClientRecord(clientId, {
      name: draft.name,
      email: draft.email || null,
      note: draft.note || null,
    });
    setBusy(false);
    if (res.error) return toast("danger", res.error);
    toast("success", "Client updated.");
    setOpen(false);
    startTransition(() => router.refresh());
  }

  return (
    <div className="card animate-rise w-full space-y-2 p-3">
      <div className="flex flex-wrap gap-2">
        <input
          className="input min-w-[200px] flex-1"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="Client name"
          aria-label="Client name"
          autoFocus
        />
        <input
          className="input min-w-[200px] flex-1"
          type="email"
          value={draft.email}
          onChange={(e) => setDraft({ ...draft, email: e.target.value })}
          placeholder="Contact email (optional)"
          aria-label="Contact email"
        />
      </div>
      <textarea
        className="input min-h-[60px]"
        value={draft.note}
        onChange={(e) => setDraft({ ...draft, note: e.target.value })}
        placeholder="Internal note (optional)"
        aria-label="Internal note"
      />
      <div className="flex gap-2">
        <button className="btn-primary py-1.5" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button className="btn py-1.5" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
