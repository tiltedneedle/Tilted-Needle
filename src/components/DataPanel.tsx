"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { syncNow } from "@/app/actions";
import { useToast } from "@/components/ui/Toast";
import { PLATFORM_COLORS } from "@/lib/types";

export type PanelAccount = {
  id: string;
  platformSlug: string;
  handle: string;
  clientName: string | null;
  mode: string;
  syncEnabled: boolean;
  lastSyncedAt: string | null;
  lastDiscoveredAt: string | null;
  lastError: string | null;
  postsTracked: number;
};

function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * The operational half of the data panel: one refresh button per account
 * and one for everything, driving the exact same runSync path the daily
 * cron uses -- a manual trigger additionally bypasses the metered-platform
 * discovery cooldown (see discoveryThrottle), which is what "fully
 * autonomous refresh" means without handing the admin a new code path.
 */
export default function DataPanel({
  workspaceId,
  accounts,
}: {
  workspaceId: string;
  accounts: PanelAccount[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null); // account id or "all"

  async function refresh(accountId?: string) {
    setBusy(accountId ?? "all");
    const res = await syncNow(workspaceId, accountId);
    setBusy(null);
    if (res.error) toast("danger", res.error);
    else toast("success", res.summary ?? "Synced.");
    startTransition(() => router.refresh());
  }

  return (
    <>
      <div className="mb-2 flex items-center justify-end">
        <button
          className="btn-primary py-1.5"
          onClick={() => void refresh()}
          disabled={busy !== null}
        >
          <RefreshCw size={14} className={busy === "all" ? "animate-spin" : ""} />
          {busy === "all" ? "Syncing everything…" : "Refresh all accounts"}
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <th className="px-3 py-2 font-medium">Account</th>
                <th className="px-3 py-2 font-medium">Client</th>
                <th className="px-3 py-2 font-medium">Mode</th>
                <th className="px-3 py-2 text-right font-medium">Posts</th>
                <th className="px-3 py-2 font-medium">Last synced</th>
                <th className="px-3 py-2 font-medium">Last discovery</th>
                <th className="px-3 py-2 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {accounts.map((a) => (
                <tr key={a.id} className="transition-colors hover:bg-[var(--bg-subtle)]">
                  <td className="px-3 py-2.5">
                    <span className="flex items-center gap-2">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: PLATFORM_COLORS[a.platformSlug] ?? "var(--muted)" }}
                      />
                      <span className="font-medium">@{a.handle.replace(/^@/, "")}</span>
                      {!a.syncEnabled && (
                        <span className="pill pill-neutral">sync off</span>
                      )}
                    </span>
                    {a.lastError && (
                      <div
                        className="mt-1 max-w-[360px] truncate text-xs text-[var(--danger)]"
                        title={a.lastError}
                      >
                        {a.lastError}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-[var(--muted)]">
                    {a.clientName ?? "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`pill ${a.mode === "metered" ? "pill-warning" : "pill-info"}`}>
                      {a.mode === "metered" ? "metered" : "free"}
                    </span>
                  </td>
                  <td className="tabular px-3 py-2.5 text-right">{a.postsTracked}</td>
                  <td
                    className="px-3 py-2.5 text-xs text-[var(--muted)]"
                    title={a.lastSyncedAt ?? undefined}
                  >
                    {ago(a.lastSyncedAt)}
                  </td>
                  <td
                    className="px-3 py-2.5 text-xs text-[var(--muted)]"
                    title={a.lastDiscoveredAt ?? undefined}
                  >
                    {ago(a.lastDiscoveredAt)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      className="btn px-2.5 py-1 text-xs"
                      onClick={() => void refresh(a.id)}
                      disabled={busy !== null}
                    >
                      <RefreshCw
                        size={12}
                        className={busy === a.id ? "animate-spin" : ""}
                      />
                      {busy === a.id ? "Syncing…" : "Refresh"}
                    </button>
                  </td>
                </tr>
              ))}
              {accounts.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-sm text-[var(--muted)]">
                    No accounts connected yet — add them on the Accounts page.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
