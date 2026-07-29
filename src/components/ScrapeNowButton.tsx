"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { scrapePostNow } from "@/app/actions";

export type ScrapeAllowance = {
  remaining: number;
  limit: number;
  daysUntilReset: number;
  periodEnd: string;
} | null;

/**
 * Re-reads one post's metrics on demand.
 *
 * The remaining count sits beside the button rather than behind a tooltip
 * because this platform's allowance is finite and shared: someone about to
 * spend the last few reads should see that before pressing, not after. Null
 * allowance means the platform is free to read, so no counter is shown --
 * a "∞ remaining" badge would just be noise on YouTube and TikTok.
 */
export default function ScrapeNowButton({
  platformPostId,
  allowance,
  compact = false,
}: {
  platformPostId: string;
  allowance: ScrapeAllowance;
  compact?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(allowance?.remaining ?? null);

  const exhausted = remaining !== null && remaining <= 0;
  const low = remaining !== null && remaining > 0 && remaining <= 20;

  async function run() {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await scrapePostNow(platformPostId);
    setBusy(false);
    if (res.remaining !== undefined) setRemaining(res.remaining);
    if (res.error) setError(res.error);
    else if (res.summary) setMessage(res.summary);
    startTransition(() => router.refresh());
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        className="btn px-2 py-1 text-xs"
        onClick={run}
        disabled={busy || exhausted}
        title={
          exhausted
            ? `No manual scrapes left. Resets in ${allowance?.daysUntilReset ?? 0} day(s).`
            : "Fetch this post's current metrics now"
        }
      >
        {busy ? "Fetching…" : "Scrape now"}
      </button>

      {/* Only metered platforms carry a counter. */}
      {remaining !== null && allowance && (
        <span
          className={`tabular rounded px-1.5 py-0.5 text-[11px] ${
            exhausted
              ? "bg-[var(--danger)]/10 text-[var(--danger)]"
              : low
                ? "bg-amber-500/10 text-amber-500"
                : "bg-[var(--bg-subtle)] text-[var(--muted)]"
          }`}
          title={`Manual scrapes reset on ${allowance.periodEnd}`}
        >
          {remaining}/{allowance.limit} left
          {!compact && ` · resets in ${allowance.daysUntilReset}d`}
        </span>
      )}

      {message && <span className="text-xs text-emerald-500">{message}</span>}
      {error && (
        <span className="text-xs text-[var(--danger)]" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
