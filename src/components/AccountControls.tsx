"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import Select from "@/components/ui/Select";
import { createAccount, setArchived, updateAccountClient } from "@/app/actions";
import { useToast } from "@/components/ui/Toast";

/**
 * Account management, living on the Data sync page.
 *
 * There used to be a separate Accounts page that did nothing this one could
 * not: both listed the same rows, and you had to bounce between them to add a
 * page here and pause it there. Two screens for one object is how the sync
 * toggle ended up on one and the archive control on the other, which is a
 * question ("why is this account quiet?") that neither page could answer
 * alone.
 */

/** Which client an account's work belongs to. Editable in place. */
export function AccountClientPicker({
  accountId,
  clientId,
  clientName,
  clients,
}: {
  accountId: string;
  clientId: string | null;
  clientName: string | null;
  clients: { id: string; name: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  return (
    <Select
      className="min-w-[130px] max-w-[180px]"
      value={clientId ?? ""}
      disabled={busy}
      placeholder="No client"
      ariaLabel={`Client for this account`}
      onChange={async (v) => {
        setBusy(true);
        const res = await updateAccountClient(accountId, v || null);
        setBusy(false);
        if (res.error) return toast("danger", res.error);
        toast("success", "Client updated.");
        startTransition(() => router.refresh());
      }}
      // An archived client stays listed while it is THIS account's current
      // one -- otherwise the field reads blank and reassigning becomes the
      // only way out of a state nobody chose.
      options={[
        ...clients.map((c) => ({ value: c.id, label: c.name })),
        ...(clientId && clientName && !clients.some((c) => c.id === clientId)
          ? [{ value: clientId, label: `${clientName} (inactive)` }]
          : []),
      ]}
    />
  );
}

/**
 * Archive or restore one account.
 *
 * Archiving is heavier than pausing and the two are deliberately different
 * controls: pausing stops new readings and keeps the row in plain sight,
 * archiving retires the page altogether. Neither deletes anything.
 */
export function AccountArchiveToggle({
  accountId,
  isArchived,
}: {
  accountId: string;
  isArchived: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  return (
    <button
      className={`rounded px-2 py-1 text-xs transition-colors ${
        isArchived
          ? "btn"
          : "text-[var(--muted)] hover:bg-[var(--border)] hover:text-[var(--fg)]"
      }`}
      disabled={busy}
      title={
        isArchived
          ? "Restore this page — it starts appearing and syncing again"
          : "Archive this page — it stops syncing and leaves the list. History is kept."
      }
      onClick={async () => {
        setBusy(true);
        const res = await setArchived("accounts", accountId, !isArchived);
        setBusy(false);
        if (res.error) return toast("danger", res.error);
        toast("success", isArchived ? "Page restored." : "Page archived.");
        startTransition(() => router.refresh());
      }}
    >
      {busy ? "…" : isArchived ? "Restore" : "Archive"}
    </button>
  );
}

/**
 * Add a page to sync.
 *
 * Collapsed until used: this screen is read far more often than it is added
 * to, and a permanently open three-field form would compete with the status
 * everyone actually comes here for.
 */
export function AddAccount({
  workspaceId,
  platforms,
  clients,
}: {
  workspaceId: string;
  platforms: { slug: string; name: string }[];
  clients: { id: string; name: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [platformSlug, setPlatformSlug] = useState(platforms[0]?.slug ?? "");
  const [handle, setHandle] = useState("");
  const [clientId, setClientId] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!handle.trim()) return toast("danger", "Handle is required.");
    setBusy(true);
    const res = await createAccount({
      workspaceId,
      clientId: clientId || null,
      platformSlug,
      handle,
    });
    setBusy(false);
    if (res.error) return toast("danger", res.error);
    setHandle("");
    setOpen(false);
    toast("success", `@${handle.replace(/^@/, "")} added.`);
    startTransition(() => router.refresh());
  }

  if (!open) {
    return (
      <button className="btn flex items-center gap-1.5" onClick={() => setOpen(true)}>
        <Plus size={14} /> Add a page
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Select
        className="min-w-[150px]"
        value={platformSlug}
        onChange={(v) => v && setPlatformSlug(v)}
        placeholder={platforms[0]?.name ?? "Platform"}
        ariaLabel="Platform"
        options={platforms.map((p) => ({ value: p.slug, label: p.name }))}
      />
      <input
        autoFocus
        className="input min-w-[170px]"
        placeholder="@handle"
        value={handle}
        onChange={(e) => setHandle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void create();
          if (e.key === "Escape") {
            setHandle("");
            setOpen(false);
          }
        }}
      />
      <Select
        className="min-w-[150px]"
        value={clientId}
        onChange={setClientId}
        placeholder="No client"
        ariaLabel="Client"
        options={clients.map((c) => ({ value: c.id, label: c.name }))}
      />
      <button className="btn-primary" onClick={create} disabled={busy || !handle.trim()}>
        {busy ? "Adding…" : "Add"}
      </button>
      <button
        className="rounded p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)]"
        onClick={() => {
          setHandle("");
          setOpen(false);
        }}
        aria-label="Cancel"
      >
        <X size={14} />
      </button>
    </div>
  );
}
