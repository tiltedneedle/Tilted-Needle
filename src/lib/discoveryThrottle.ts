/**
 * The discovery cooldown for metered platforms, kept dependency-free so it
 * can be tested directly under Node's native loader (no "@/" path aliases,
 * which only Next's bundler resolves) -- see csv.ts for the same pattern.
 *
 * A metered vendor bills per row returned, not per new item found: there is
 * no cheap "just tell me what's new" call, so every discovery attempt costs
 * roughly the same whether or not it turns up anything. At the sync cron's
 * 15-minute cadence, asking every tick is not a pacing choice, it is an
 * accident -- ~10 workspace accounts x 12 rows would exhaust an entire
 * month's 200-credit discovery pool in under half an hour, and then no new
 * upload would be auto-discovered for the rest of the month.
 *
 * 5 rows x 10 accounts, once every 10 days, is ~150/month: comfortably inside
 * the pool with headroom left for manual syncs and uneven posting. A manual
 * trigger (the "Sync now" button, or an account's first import) bypasses the
 * cooldown -- it is a deliberate action a person is not going to click 96
 * times a day, and it deserves the fuller catch-up.
 */

export const AUTO_DISCOVERY_WANT = 5;
export const AUTO_DISCOVERY_COOLDOWN_MS = 10 * 24 * 60 * 60 * 1000;

/**
 * How many accounts may do METERED discovery in a single automatic run.
 *
 * Not a spend cap -- the budget claim and the 10-day cooldown already bound
 * what a month can cost. This is a WALL-CLOCK cap. A metered discovery is a
 * blocking vendor actor run, roughly 30 seconds each, and nine of them in one
 * request is four and a half minutes of the serverless function's 300-second
 * ceiling spent before a single metric is refreshed. The first live run did
 * exactly that and overran the limit.
 *
 * Accounts past the cap are left with their last_discovered_at untouched, so
 * they stay due and the next run picks them up. At four runs a day this
 * covers a dozen accounts well inside the cooldown window.
 */
export const MAX_METERED_DISCOVERY_PER_RUN = 4;

/** Whether an automatic discovery attempt is due for an account. */
export function isDueForDiscovery(
  trigger: "cron" | "manual",
  lastDiscoveredAt: string | null,
  now: number = Date.now(),
): boolean {
  if (trigger === "manual") return true;
  if (!lastDiscoveredAt) return true;
  return now - new Date(lastDiscoveredAt).getTime() >= AUTO_DISCOVERY_COOLDOWN_MS;
}
