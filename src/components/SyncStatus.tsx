"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncNow } from "@/app/actions";
import { PLATFORM_LABEL } from "@/lib/types";

export type PlatformSyncInfo = {
  slug: string;
  displayName: string;
  canFetch: boolean;
  configured: boolean;
  missingEnv: string[];
  reason: string;
  remedy?: string;
  accountCount: number;
};

export type AccountSyncInfo = {
  id: string;
  handle: string;
  platform: string;
  lastSyncedAt: string | null;
  lastError: string | null;
};

function ago(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/**
 * What the automatic refresh can and cannot do, stated per platform.
 *
 * The point of showing this is that three of the four platforms genuinely
 * cannot be polled without the account owner's authorisation. A UI that just
 * showed "last synced: never" for those would imply a bug and send someone
 * looking for a fix that does not exist.
 */
export default function SyncStatus({
  workspaceId,
  platforms,
  accounts,
  canManage,
}: {
  workspaceId: string;
  platforms: PlatformSyncInfo[];
  accounts: AccountSyncInfo[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const live = platforms.filter((p) => p.canFetch && p.configured);
  const blocked = platforms.filter((p) => !p.canFetch);
  const unconfigured = platforms.filter((p) => p.canFetch && !p.configured);
  const withErrors = accounts.filter((a) => a.lastError);

  async function run() {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await syncNow(workspaceId);
    setBusy(false);
    if (res.error) setError(res.error);
    else if (res.summary) setMessage(res.summary);
    startTransition(() => router.refresh());
  }

  return (
    <div className="card mb-5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Automatic refresh</span>

        {live.length > 0 ? (
          <span className="flex items-center gap-1.5 rounded bg-[var(--success)]/10 px-2 py-0.5 text-xs text-[var(--success)]">
            <span className="size-1.5 rounded-full bg-[var(--success)]" />
            {live.map((p) => p.displayName).join(", ")} — daily
          </span>
        ) : (
          <span className="rounded bg-[var(--bg-subtle)] px-2 py-0.5 text-xs text-[var(--muted)]">
            No platform is syncing
          </span>
        )}

        {withErrors.length > 0 && (
          <span className="rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-500">
            {withErrors.length} account{withErrors.length === 1 ? "" : "s"} erroring
          </span>
        )}

        <div className="flex-1" />

        <button
          className="rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--fg)]"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide details" : "What can be synced?"}
        </button>

        {canManage && (
          <button className="btn px-2 py-1 text-xs" onClick={run} disabled={busy}>
            {busy ? "Syncing…" : "Sync now"}
          </button>
        )}
      </div>

      {message && (
        <p className="animate-rise mt-2 text-xs text-[var(--success)]" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="animate-rise mt-2 text-xs text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}

      {open && (
        <div className="animate-rise mt-3 space-y-2 border-t border-[var(--border)] pt-3">
          {unconfigured.map((p) => (
            <div key={p.slug} className="text-xs">
              <span className="font-medium">{p.displayName}</span>{" "}
              <span className="text-amber-500">needs setup</span>
              <p className="mt-0.5 text-[var(--muted)]">
                Public metrics are available, but{" "}
                <code className="rounded bg-[var(--bg-subtle)] px-1">
                  {p.missingEnv.join(", ")}
                </code>{" "}
                {p.missingEnv.length === 1 ? "is" : "are"} not set. No client
                authorisation is needed — this is our own API key.
              </p>
            </div>
          ))}

          {live.map((p) => (
            <div key={p.slug} className="text-xs">
              <span className="font-medium">{p.displayName}</span>{" "}
              <span className="text-[var(--success)]">syncing</span>
              <span className="text-[var(--muted)]">
                {" "}
                — {p.accountCount} account{p.accountCount === 1 ? "" : "s"}
              </span>
              <p className="mt-0.5 text-[var(--muted)]">{p.reason}</p>
              {p.remedy && <p className="mt-0.5 text-[var(--muted)]">{p.remedy}</p>}
            </div>
          ))}

          {/* The honest part: these are not going to start working on their
              own, and saying so beats an indefinite "never synced". */}
          {blocked.map((p) => (
            <div key={p.slug} className="text-xs">
              <span className="font-medium">{p.displayName}</span>{" "}
              <span className="text-[var(--muted)]">cannot be polled</span>
              <p className="mt-0.5 text-[var(--muted)]">{p.reason}</p>
              {p.remedy && <p className="mt-0.5 text-[var(--muted)]">{p.remedy}</p>}
            </div>
          ))}

          {accounts.length > 0 && (
            <div className="mt-3 border-t border-[var(--border)] pt-2">
              <div className="mb-1 text-[11px] uppercase tracking-wide text-[var(--muted)]">
                Last refreshed
              </div>
              {accounts.map((a) => (
                <div key={a.id} className="flex items-center gap-2 py-0.5 text-xs">
                  <span className="min-w-0 flex-1 truncate">
                    {a.handle}
                    <span className="ml-1.5 text-[var(--muted)]">{PLATFORM_LABEL[a.platform] ?? a.platform}</span>
                  </span>
                  {a.lastError ? (
                    <span className="max-w-[60%] truncate text-amber-500" title={a.lastError}>
                      {a.lastError}
                    </span>
                  ) : (
                    <span className="text-[var(--muted)]">
                      {a.lastSyncedAt ? ago(a.lastSyncedAt) : "never"}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
