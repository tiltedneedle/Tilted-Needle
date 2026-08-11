"use client";

import { useState, useTransition } from "react";
import { updateSyncWindow } from "@/app/actions";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { syncNow } from "@/app/actions";
import Select from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { PLATFORM_COLORS } from "@/lib/types";

export type PanelAccount = {
  id: string;
  platformSlug: string;
  handle: string;
  clientName: string | null;
  /**
   * Does this account's platform cost money to refresh? Derived from the
   * provider, never from accounts.connection_mode -- that column is 'manual'
   * for every account in the workspace, so keying the pill on it printed
   * "free" over Instagram, whose every fetch spends vendor credit.
   */
  isMetered: boolean;
  syncEnabled: boolean;
  /** How far back discovery reaches for this account, in days. Null = all. */
  syncWindowDays: number | null;
  lastSyncedAt: string | null;
  lastDiscoveredAt: string | null;
  lastError: string | null;
  postsTracked: number;
};

export type InstagramBudget = { used: number; limit: number; resetsOn: string } | null;
export type TiktokBoxStatus = "ok" | "down" | "unconfigured";

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
 * Each platform managed as its own system, because each IS its own system:
 * YouTube rides a free official API, Instagram spends from a real metered
 * budget, TikTok splits into free metrics plus an optional self-hosted
 * discovery box. One click refreshes a whole platform; every button drives
 * the same runSync path the daily cron uses (a manual trigger additionally
 * bypasses the metered discovery cooldown by design).
 */
export default function DataPanel({
  workspaceId,
  accounts,
  instagramBudget,
  tiktokBox,
}: {
  workspaceId: string;
  accounts: PanelAccount[];
  instagramBudget: InstagramBudget;
  tiktokBox: TiktokBoxStatus;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  // Busy key: an account id, "platform:<slug>", or "all".
  const [busy, setBusy] = useState<string | null>(null);

  async function refresh(key: string, accountId?: string, platformSlug?: string) {
    setBusy(key);
    const res = await syncNow(workspaceId, accountId, platformSlug);
    setBusy(null);
    if (res.error) toast("danger", res.error);
    else toast("success", res.summary ?? "Synced.");
    startTransition(() => router.refresh());
  }

  const known = ["youtube", "instagram", "tiktok"];
  const sections = [
    {
      slug: "youtube",
      label: "YouTube",
      note: "Official Data API — free quota, resets daily. Long-form only: Shorts are filtered out at discovery.",
      pill: null as React.ReactNode,
    },
    {
      slug: "instagram",
      label: "Instagram",
      note: "Metered via Apify — every read spends from the budget, so refresh deliberately.",
      pill: instagramBudget ? (
        <span
          className={`pill ${
            instagramBudget.used / instagramBudget.limit > 0.85 ? "pill-warning" : "pill-neutral"
          }`}
        >
          {instagramBudget.used}/{instagramBudget.limit} used · resets{" "}
          {new Date(instagramBudget.resetsOn).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </span>
      ) : (
        <span className="pill pill-neutral">no budget window open</span>
      ),
    },
    {
      slug: "tiktok",
      label: "TikTok",
      note: "Metrics refresh is free. Discovering new videos rides the self-hosted box:",
      pill: (
        <span
          className={`pill ${
            tiktokBox === "ok" ? "pill-success" : tiktokBox === "down" ? "pill-danger" : "pill-neutral"
          }`}
        >
          {tiktokBox === "ok" ? "box connected" : tiktokBox === "down" ? "box unreachable" : "box not configured"}
        </span>
      ),
    },
    // Anything else that ever gets connected still shows up, unstyled by
    // platform-specific context, rather than silently vanishing.
    ...[...new Set(accounts.map((a) => a.platformSlug))]
      .filter((s) => !known.includes(s))
      .map((s) => ({ slug: s, label: s, note: "", pill: null as React.ReactNode })),
  ];

  return (
    <>
      <div className="mb-4 flex items-center justify-end">
        <button
          className="btn py-1.5"
          onClick={() => void refresh("all")}
          disabled={busy !== null}
        >
          <RefreshCw size={14} className={busy === "all" ? "animate-spin" : ""} />
          {busy === "all" ? "Syncing everything…" : "Refresh all platforms"}
        </button>
      </div>

      <div className="space-y-7">
        {sections.map((s) => {
          const mine = accounts.filter((a) => a.platformSlug === s.slug);
          const platformBusy = busy === `platform:${s.slug}`;
          return (
            <section key={s.slug}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: PLATFORM_COLORS[s.slug] ?? "var(--muted)" }}
                />
                <h2 className="text-sm font-semibold capitalize">{s.label}</h2>
                {s.pill}
                <span className="text-xs text-[var(--muted)]">{s.note}</span>
                <div className="flex-1" />
                <button
                  className="btn-primary py-1.5 text-xs"
                  onClick={() => void refresh(`platform:${s.slug}`, undefined, s.slug)}
                  disabled={busy !== null || mine.length === 0}
                >
                  <RefreshCw size={13} className={platformBusy ? "animate-spin" : ""} />
                  {platformBusy ? `Syncing ${s.label}…` : `Refresh ${s.label}`}
                </button>
              </div>

              {mine.length === 0 ? (
                <div className="card p-5 text-center text-xs text-[var(--muted)]">
                  No {s.label} accounts connected.
                </div>
              ) : (
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
                        {mine.map((a) => (
                          <tr key={a.id} className="transition-colors hover:bg-[var(--bg-subtle)]">
                            <td className="px-3 py-2.5">
                              <span className="flex items-center gap-2">
                                <span className="font-medium">@{a.handle.replace(/^@/, "")}</span>
                                {!a.syncEnabled && <span className="pill pill-neutral">sync off</span>}
                                <SyncWindowControl
                                  accountId={a.id}
                                  windowDays={a.syncWindowDays}
                                />
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
                              <span className={`pill ${a.isMetered ? "pill-warning" : "pill-info"}`}>
                                {a.isMetered ? "metered" : "free"}
                              </span>
                            </td>
                            <td className="tabular px-3 py-2.5 text-right">{a.postsTracked}</td>
                            <td className="px-3 py-2.5 text-xs text-[var(--muted)]" title={a.lastSyncedAt ?? undefined}>
                              {ago(a.lastSyncedAt)}
                            </td>
                            <td className="px-3 py-2.5 text-xs text-[var(--muted)]" title={a.lastDiscoveredAt ?? undefined}>
                              {ago(a.lastDiscoveredAt)}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <button
                                className="btn px-2.5 py-1 text-xs"
                                onClick={() => void refresh(a.id, a.id)}
                                disabled={busy !== null}
                              >
                                <RefreshCw size={12} className={busy === a.id ? "animate-spin" : ""} />
                                {busy === a.id ? "Syncing…" : "Refresh"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}


/**
 * How far back discovery reaches for one account.
 *
 * A short window is the difference between a nightly sync that costs three
 * metered calls and one that walks a client's entire back catalogue every
 * time. The control was written months ago, validation and all, and simply
 * never rendered -- so the default was the only value anyone could ever have.
 *
 * "All time" is offered but deliberately not the default: on a metered
 * platform it is the expensive answer, and it should be chosen rather than
 * inherited.
 */
function SyncWindowControl({
  accountId,
  windowDays,
}: {
  accountId: string;
  windowDays: number | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [value, setValue] = useState(windowDays == null ? "all" : String(windowDays));
  const [busy, setBusy] = useState(false);

  return (
    // The dropdown from the Data-sync screenshot: a native <select> whose
    // option list the OS draws, so it opened as a white panel of unreadable
    // grey text over the dark theme. Rendered in our own tokens now.
    //
    // No clear row -- every account HAS a window, and "all time" is one of
    // the five choices rather than the absence of a choice. Passing the
    // current label as the placeholder keeps it from ever showing.
    <Select
      className="min-w-[130px]"
      value={value}
      disabled={busy}
      ariaLabel="Import window for this account"
      placeholder="30d window"
      options={[
        { value: "7", label: "7d window" },
        { value: "30", label: "30d window" },
        { value: "90", label: "90d window" },
        { value: "365", label: "1y window" },
        { value: "all", label: "all time" },
      ]}
      onChange={async (next) => {
        // Select offers a clear row that yields ""; there is no "no window"
        // state here, so an empty value is ignored rather than written.
        if (!next) return;
        setValue(next);
        setBusy(true);
        try {
          const res = await updateSyncWindow(accountId, next === "all" ? null : Number(next));
          if (res.error) {
            toast("danger", res.error);
            setValue(windowDays == null ? "all" : String(windowDays));
            return;
          }
          toast("success", res.summary ?? "Import window updated.");
          startTransition(() => router.refresh());
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}
