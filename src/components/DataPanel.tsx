"use client";

import { useState, useTransition } from "react";
import { updateSyncWindow } from "@/app/actions";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { syncNow } from "@/app/actions";
import SyncEnabledToggle from "@/components/SyncEnabledToggle";
import WindowBatch from "@/components/WindowBatch";
import { AccountArchiveToggle, AccountClientPicker, AddAccount } from "@/components/AccountControls";
import Select from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { PLATFORM_COLORS } from "@/lib/types";

export type PanelAccount = {
  id: string;
  platformSlug: string;
  handle: string;
  clientId: string | null;
  clientName: string | null;
  /**
   * The account's client is inactive. Not the same as this account being
   * paused, and not fixable from here -- the client's own switch governs it.
   * Shown separately so a quiet account explains WHY it is quiet instead of
   * looking like a setting somebody forgot.
   */
  clientArchived: boolean;
  isArchived: boolean;
  /** Finding new videos costs money even though refreshing them does not. */
  discoveryMetered: boolean;
  /** ...and it is billing the shared vendor account, not this platform's own. */
  discoverySharedToken: boolean;
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
  clients,
  platforms,
}: {
  workspaceId: string;
  accounts: PanelAccount[];
  instagramBudget: InstagramBudget;
  tiktokBox: TiktokBoxStatus;
  /** Active clients, for attaching an account to one. */
  clients: { id: string; name: string }[];
  /** Enabled platforms, for adding a page. */
  platforms: { slug: string; name: string }[];
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

  const known = ["youtube", "youtube_shorts", "instagram", "tiktok"];
  const sections = [
    {
      slug: "youtube",
      label: "YouTube",
      note: "Official Data API — free quota, resets daily. Long-form only: Shorts belong to the YouTube Shorts platform below.",
      pill: null as React.ReactNode,
    },
    {
      slug: "youtube_shorts",
      label: "YouTube Shorts",
      // Says the two things someone needs before adding one: it is the same
      // channel handle, and a Shorts view is not a YouTube view.
      note: "Same channel, Shorts only — add a page here with the same @handle as the YouTube one. Views are counted on impression, not after 30 seconds, so they are never added to YouTube's.",
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
      note: "Refreshing a known video is free and unlimited. Finding NEW ones costs credit, so it runs rarely and capped:",
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
      {/* Adding a page lives here now. It used to be on a separate Accounts
          screen that listed the same rows, so pausing a page and adding one
          were two different destinations for the same object. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <AddAccount workspaceId={workspaceId} platforms={platforms} clients={clients} />
        <div className="flex-1" />
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
                <div className="empty">
                  No {s.label} accounts connected.
                </div>
              ) : (
                <div className="card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--border)] text-left text-[10.5px] font-medium uppercase tracking-[0.06em] text-[var(--muted)]">
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
                          <tr
                            key={a.id}
                            className={`transition-colors hover:bg-[var(--bg-subtle)] ${
                              a.isArchived || a.clientArchived ? "opacity-60" : ""
                            }`}
                          >
                            <td className="px-3 py-2.5">
                              <span className="flex flex-wrap items-center gap-2">
                                <span
                                  className={`font-medium ${a.isArchived ? "line-through" : ""}`}
                                >
                                  @{a.handle.replace(/^@/, "")}
                                </span>
                                {/* Says WHY it is quiet. An account paused
                                    here and one whose client went inactive
                                    look identical otherwise, and only one of
                                    them is fixed from this screen -- so the
                                    other names where to go. */}
                                {a.clientArchived && (
                                  <span
                                    className="pill pill-neutral"
                                    title="Its client is inactive, so nothing on this page syncs. Reactivate the client under Clients."
                                  >
                                    client inactive
                                  </span>
                                )}
                                {/* Was a read-only "sync off" pill for a flag
                                    nothing in the app could set. Now it is the
                                    switch. */}
                                <SyncEnabledToggle
                                  accountId={a.id}
                                  enabled={a.syncEnabled}
                                  metered={a.isMetered}
                                />
                                <SyncWindowControl
                                  accountId={a.id}
                                  windowDays={a.syncWindowDays}
                                />
                                {/* Sits beside the window control because it
                                    answers the question that control raises:
                                    "30 days" is a number until you can see
                                    which videos it actually covers. */}
                                <WindowBatch accountId={a.id} handle={a.handle} />
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
                            <td className="px-3 py-2.5">
                              {/* Editable here now that this page owns
                                  accounts. The link decides which client
                                  dashboard the work lands on, so it has to be
                                  correctable in place rather than only at
                                  creation. */}
                              <AccountClientPicker
                                accountId={a.id}
                                clientId={a.clientId}
                                clientName={a.clientName}
                                clients={clients}
                              />
                            </td>
                            <td className="px-3 py-2.5">
                              {/* Refreshing and DISCOVERING can cost
                                  differently -- TikTok finds new videos
                                  through a paid vendor and reads their
                                  numbers free forever -- so one "metered"
                                  badge would be wrong whichever way it fell. */}
                              <span className={`pill ${a.isMetered ? "pill-warning" : "pill-info"}`}>
                                {a.isMetered ? "metered" : "free"}
                              </span>
                              {a.discoveryMetered && (
                                <span
                                  className="pill pill-warning ml-1"
                                  title="Finding NEW videos costs credit; refreshing known ones is free"
                                >
                                  paid discovery
                                </span>
                              )}
                              {/* Nothing fails when the platform-specific key
                                  is missing -- discovery just bills the other
                                  account. Without a badge the only place that
                                  shows up is the vendor's invoice. */}
                              {a.discoverySharedToken && (
                                <span
                                  className="pill pill-danger ml-1"
                                  title="This platform has no key of its own, so discovery is spending the shared Apify account's credit. Set APIFY_TIKTOK_TOKEN to bill it separately."
                                >
                                  shared token
                                </span>
                              )}
                            </td>
                            <td className="tabular px-3 py-2.5 text-right">{a.postsTracked}</td>
                            <td className="px-3 py-2.5 text-xs text-[var(--muted)]" title={a.lastSyncedAt ?? undefined}>
                              {ago(a.lastSyncedAt)}
                            </td>
                            <td className="px-3 py-2.5 text-xs text-[var(--muted)]" title={a.lastDiscoveredAt ?? undefined}>
                              {ago(a.lastDiscoveredAt)}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <span className="flex items-center justify-end gap-1.5">
                              {/* Disabled while paused rather than left
                                  clickable. runSync filters on sync_enabled,
                                  so a paused account cannot be manually synced
                                  either -- the button would fire, report
                                  nothing, and look broken. */}
                              <button
                                className="btn px-2.5 py-1 text-xs"
                                onClick={() => void refresh(a.id, a.id)}
                                disabled={busy !== null || !a.syncEnabled || a.isArchived || a.clientArchived}
                                title={
                                  a.clientArchived
                                    ? "This client is inactive — reactivate them under Clients"
                                    : a.isArchived
                                      ? "This page is archived — restore it first"
                                      : a.syncEnabled
                                        ? "Read this page's numbers now"
                                        : "Syncing is paused for this page — resume it first"
                                }
                              >
                                <RefreshCw size={12} className={busy === a.id ? "animate-spin" : ""} />
                                {busy === a.id ? "Syncing…" : "Refresh"}
                              </button>
                              <AccountArchiveToggle accountId={a.id} isArchived={a.isArchived} />
                              </span>
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
