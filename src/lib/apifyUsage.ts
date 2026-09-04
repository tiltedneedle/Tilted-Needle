/**
 * What the Apify accounts have ACTUALLY spent, read from Apify.
 *
 * Everything else in this product models Apify cost from our own side --
 * scrapeBudget.ts multiplies a row count by PRICE_PER_COMMENT_USD and hopes.
 * That estimate has never been checked against the provider, so a change in
 * their pricing, a retry that double-charged, or an actor billing for an
 * empty result would all be invisible. This reads the meter.
 *
 * TWO ACCOUNTS, NEVER SUMMED. The tokens belong to different Apify accounts
 * on different billing cycles, so a combined "$1.40 of $10" would be a
 * quantity that does not exist: neither account can spend the other's credit,
 * and their cycles reset on different days. They are reported side by side
 * for the same reason platform views are never added together.
 *
 * THE PROJECTION IS THE NUMBER TO BUDGET AGAINST, NOT THE BALANCE. Measured
 * 2026-09-04: both accounts showed ~$4.3 remaining and were in completely
 * different positions -- one burning $0.103/day with 24 days to run (heading
 * for $3.20), the other $0.032/day with 7.6 days left (heading for $0.98).
 * Spending against the balance rather than the projection is how the first
 * one hits its cap around day 20 and comment ingestion stops for a week.
 */

export type ApifyAccountUsage = {
  /** Which env var this came from, never the token itself. */
  tokenName: string;
  account: string | null;
  plan: string | null;
  /** Apify's HARD cap. Unlike a budget alert this actually stops spending. */
  maxMonthlyUsd: number | null;
  usedUsd: number;
  cycleStart: string | null;
  /** When the credit resets -- i.e. the end of the current cycle. */
  cycleEnd: string | null;
  daysElapsed: number | null;
  daysRemaining: number | null;
  /** usedUsd / daysElapsed. */
  burnPerDayUsd: number | null;
  /** Where this cycle lands if the current rate holds. */
  projectedUsd: number | null;
  /** cap - used. What is left RIGHT NOW. */
  spareNowUsd: number | null;
  /** cap - projected. What is left after normal operation is paid for. */
  spareAfterBaselineUsd: number | null;
  /**
   * Set when the read failed. A failed read must never render as $0 spent --
   * that is indistinguishable from a healthy quiet account, and it is the
   * exact shape of bug that made every client channel show "0 views".
   */
  error: string | null;
};

const API = "https://api.apify.com/v2";

async function getJson(url: string, token: string, timeoutMs = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctl.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Apify returned ${res.status}`);
    return (await res.json())?.data ?? {};
  } finally {
    clearTimeout(t);
  }
}

function empty(tokenName: string, error: string): ApifyAccountUsage {
  return {
    tokenName, account: null, plan: null, maxMonthlyUsd: null, usedUsd: 0,
    cycleStart: null, cycleEnd: null, daysElapsed: null, daysRemaining: null,
    burnPerDayUsd: null, projectedUsd: null, spareNowUsd: null,
    spareAfterBaselineUsd: null, error,
  };
}

/** Read one account. Never throws -- a dead provider is a status, not a crash. */
export async function readApifyAccount(
  tokenName: string,
  token: string | undefined,
  now: Date = new Date(),
): Promise<ApifyAccountUsage> {
  if (!token) return empty(tokenName, "token not configured");

  try {
    const [me, usage] = await Promise.all([
      getJson(`${API}/users/me`, token),
      getJson(`${API}/users/me/usage/monthly`, token),
    ]);

    const used = Number(
      usage?.totalUsageCreditsUsdAfterVolumeDiscount
      ?? usage?.totalUsageCreditsUsd ?? 0,
    );
    const startRaw = usage?.usageCycle?.startAt ?? null;
    const endRaw = usage?.usageCycle?.endAt ?? null;
    const start = startRaw ? new Date(startRaw) : null;
    const end = endRaw ? new Date(endRaw) : null;

    // Clamped at a fraction of a day: dividing by an elapsed time near zero
    // on the first morning of a cycle would report a burn rate in the
    // hundreds and a projection to match.
    const daysElapsed = start
      ? Math.max(0.25, (now.getTime() - start.getTime()) / 86_400_000)
      : null;
    const daysRemaining = end
      ? Math.max(0, (end.getTime() - now.getTime()) / 86_400_000)
      : null;

    const burn = daysElapsed ? used / daysElapsed : null;
    const projected = burn != null && daysRemaining != null
      ? used + burn * daysRemaining
      : null;
    const cap = me?.plan?.maxMonthlyUsageUsd != null
      ? Number(me.plan.maxMonthlyUsageUsd) : null;

    return {
      tokenName,
      account: me?.username ?? null,
      plan: me?.plan?.id ?? null,
      maxMonthlyUsd: cap,
      usedUsd: used,
      cycleStart: startRaw,
      cycleEnd: endRaw,
      daysElapsed,
      daysRemaining,
      burnPerDayUsd: burn,
      projectedUsd: projected,
      spareNowUsd: cap != null ? Math.max(0, cap - used) : null,
      spareAfterBaselineUsd:
        cap != null && projected != null ? Math.max(0, cap - projected) : null,
      error: null,
    };
  } catch (e) {
    return empty(tokenName, e instanceof Error ? e.message : String(e));
  }
}

/**
 * Both accounts, in a fixed order, each labelled by the env var it came from.
 *
 * The names matter operationally: knowing "APIFY_TIKTOK_TOKEN is the one with
 * headroom" is what lets someone route a backfill to the right key.
 */
export async function readApifyUsage(now: Date = new Date()): Promise<ApifyAccountUsage[]> {
  return Promise.all([
    readApifyAccount("APIFY_TOKEN", process.env.APIFY_TOKEN, now),
    readApifyAccount("APIFY_TIKTOK_TOKEN", process.env.APIFY_TIKTOK_TOKEN, now),
  ]);
}

/* The `unstable_cache` wrapper lives in apifyUsageCached.ts, NOT here.
   This module is imported by the WORKER, which runs outside Next entirely --
   importing next/cache from it fails with ERR_MODULE_NOT_FOUND before a
   single line runs. Keeping the reader runtime-agnostic is what lets the
   same code serve a page render and a queue job. */
