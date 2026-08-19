"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAccountSyncEnabled } from "@/app/actions";
import { useToast } from "@/components/ui/Toast";

/**
 * Pause or resume automatic syncing for one account.
 *
 * `sync_enabled` has governed the pipeline all along, and until now the app
 * could only ever DISPLAY it -- two surfaces rendered a "sync off" badge for a
 * state nothing could set. This is the missing switch.
 *
 * A pill rather than a checkbox, matching ClientActiveToggle, because the
 * question is "is this page syncing" and the answer should be readable at a
 * glance down a column rather than needing a legend.
 *
 * Worth being clear that this is NOT the archive control that sits on the
 * Accounts page. Archiving removes an account from /data altogether, which
 * makes a mistake invisible; pausing keeps the row exactly where it was,
 * marked, with its whole history intact. Only new readings stop.
 */
export default function SyncEnabledToggle({
  accountId,
  enabled,
  metered = false,
}: {
  accountId: string;
  enabled: boolean;
  /** Whether reads on this platform cost money, which changes what pausing means. */
  metered?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    const res = await setAccountSyncEnabled(accountId, !enabled);
    setBusy(false);
    // RLS refuses this for a non-manager. Surfacing it matters: a silent
    // no-op would look like the pill simply did not work.
    if (res.error) return toast("danger", res.error);
    toast("success", enabled ? "Syncing paused." : "Syncing resumed.");
    startTransition(() => router.refresh());
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-50 ${
        enabled
          ? "bg-[var(--success)]/10 text-[var(--success)] hover:bg-[var(--success)]/20"
          : "bg-[var(--bg-subtle)] text-[var(--muted)] hover:bg-[var(--border)]"
      }`}
      title={
        enabled
          ? `Pause syncing — stops new readings for this page.${
              metered ? " Reads here are metered, so pausing also stops the spend." : ""
            } History is kept.`
          : "Resume syncing — the next scheduled run picks this page up again."
      }
    >
      {busy ? "…" : enabled ? "Syncing" : "Paused"}
    </button>
  );
}
