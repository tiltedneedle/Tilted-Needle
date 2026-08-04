"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setArchived } from "@/app/actions";
import { useToast } from "@/components/ui/Toast";

/**
 * Whether a client is currently active, as a toggle rather than a status
 * that only changes via an "Archive" action buried in a menu. "Active or
 * not" is a fact the business changes directly and often -- a client
 * pausing or resuming work -- so it gets a one-click control on the card
 * itself, not a side effect of some other action.
 *
 * Stored on the same is_archived column every other archivable table
 * already uses (so nothing else that reads it needs to change), just
 * labelled in the client's own terms here rather than "archived".
 */
export default function ClientActiveToggle({
  clientId,
  isActive,
  size = "sm",
}: {
  clientId: string;
  isActive: boolean;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function toggle(e: React.MouseEvent) {
    e.preventDefault(); // these render inside a card that is itself a Link
    e.stopPropagation();
    setBusy(true);
    const res = await setArchived("clients", clientId, isActive);
    if (res.error) toast("danger", res.error);
    setBusy(false);
    startTransition(() => router.refresh());
  }

  const padding = size === "md" ? "px-2.5 py-1 text-xs" : "px-1.5 py-0.5 text-[11px]";

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`rounded-full font-medium transition-colors disabled:opacity-50 ${padding} ${
        isActive
          ? "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
          : "bg-[var(--bg-subtle)] text-[var(--muted)] hover:bg-[var(--border)]"
      }`}
      title={isActive ? "Mark this client inactive" : "Mark this client active"}
    >
      {busy ? "…" : isActive ? "Active" : "Inactive"}
    </button>
  );
}
