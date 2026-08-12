"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { createClientRecord } from "@/app/actions";
import { useToast } from "@/components/ui/Toast";

/**
 * Add a client from the Guidelines wall.
 *
 * Collapsed to a single button until used, because this page is a gallery you
 * browse far more often than a form you fill in -- a permanently open input
 * would compete with the cards for the eye every time.
 *
 * Name only. Everything else about a client (picture, doc link, platforms,
 * guideline sections) is edited on their own page, and asking for it up front
 * would turn "add Frankie" into a form nobody wants to open. The record is
 * deliberately allowed to start almost empty.
 *
 * No duplicate-name check. The roster genuinely contains near-duplicates --
 * "Euro Eyes London (LEC)" beside "EuroEyes Deutschland" -- and there is no
 * unique constraint on clients.name for good reason. Guessing that two
 * similar names are the same client is exactly the kind of helpfulness that
 * loses somebody's work.
 */
export default function NewGuidelineClient({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    const res = await createClientRecord(workspaceId, trimmed);
    setBusy(false);
    if (res.error) return toast("danger", res.error);
    setName("");
    setOpen(false);
    toast("success", `${trimmed} added.`);
    startTransition(() => router.refresh());
  }

  if (!open) {
    return (
      <button className="btn flex items-center gap-1.5" onClick={() => setOpen(true)}>
        <Plus size={14} /> Add client
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        autoFocus
        className="input min-w-[200px]"
        placeholder="Client name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void create();
          // Escape backs out without leaving a half-typed name behind.
          if (e.key === "Escape") {
            setName("");
            setOpen(false);
          }
        }}
      />
      <button className="btn-primary" onClick={create} disabled={busy || !name.trim()}>
        {busy ? "Adding…" : "Add"}
      </button>
      <button
        className="rounded p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)]"
        onClick={() => {
          setName("");
          setOpen(false);
        }}
        aria-label="Cancel"
      >
        <X size={14} />
      </button>
    </div>
  );
}
