/**
 * Which Apify account should pay for this piece of work.
 *
 * MONEY CANNOT MOVE BETWEEN THE ACCOUNTS. They are separate Apify accounts
 * with separate $5 caps and separate cycles, and nothing here pretends
 * otherwise -- a "transfer" is not a thing that exists. What CAN move is the
 * WORK. Verified 2026-09-04: both tokens can run all three transcript actors,
 * because those actors are public. So the platform-to-account mapping was
 * only ever a default, and this turns it into a decision.
 *
 * THE METRIC IS SPARE PER REMAINING DAY, NOT SPARE.
 *
 * Unused credit EXPIRES at the cycle boundary. It does not roll over. So two
 * accounts holding similar balances can be in completely different positions,
 * and measured on the real thing they were:
 *
 *   palatial_lemongrass  $4.16 spare, 7.5 days left  -> $0.55/day available
 *   tilted_Needle        $3.33 spare, 24.5 days left -> $0.14/day available
 *
 * Four times the daily headroom on the account whose credit is about to
 * lapse. Routing by balance alone would have split the work evenly and let
 * palatial's credit expire unused while tilted crept toward its cap. Dividing
 * by days remaining is what turns "use it or lose it" into arithmetic.
 *
 * The baseline is subtracted first: spareAfterBaseline already removes what
 * an account's own routine traffic is projected to spend, so this only ever
 * offers up headroom that nothing else has claimed.
 *
 * A FAILED READ FALLS BACK TO THE CONFIGURED DEFAULT, never to a guess. If
 * Apify cannot be reached the router returns the actor's own tokenEnv and
 * says why -- routing is an optimisation, and an optimisation that breaks the
 * thing it optimises is worse than not having it.
 */
import { readApifyUsage, type ApifyAccountUsage } from "@/lib/apifyUsage";

export type TokenEnv = "APIFY_TOKEN" | "APIFY_TIKTOK_TOKEN";

export type RoutingChoice = {
  tokenEnv: TokenEnv;
  /** Why this account, in words a log line can carry. */
  reason: string;
  /** Spare-per-remaining-day at the moment of the decision, for the log. */
  headroomPerDay: number | null;
  /** True when the live read failed and the default was used. */
  fellBack: boolean;
};

/**
 * Below this an account is treated as having nothing to offer.
 *
 * Not zero: an account with three cents left and a day to run should not win
 * a routing decision on a technicality and then fail mid-batch. A few dollars
 * of headroom is what makes routing worth doing at all.
 */
const MIN_USEFUL_SPARE_USD = 0.25;

/** How much this account could spend per remaining day without breaching. */
export function headroomPerDay(a: ApifyAccountUsage): number | null {
  if (a.error || a.spareAfterBaselineUsd == null || a.daysRemaining == null) return null;
  // Clamped: on the last afternoon of a cycle, dividing by a tiny fraction of
  // a day would report enormous headroom for credit about to vanish.
  return a.spareAfterBaselineUsd / Math.max(0.5, a.daysRemaining);
}

/**
 * Pick the funding account for one unit of work.
 *
 * `preferred` is the actor's configured default and is honoured whenever the
 * live picture is unreadable or nothing clearly beats it.
 */
export function chooseAccount(
  usage: ApifyAccountUsage[],
  preferred: TokenEnv,
): RoutingChoice {
  const byName = new Map(usage.map((u) => [u.tokenName as TokenEnv, u]));
  const pref = byName.get(preferred);

  const readable = usage.filter(
    (u) => !u.error && u.spareAfterBaselineUsd != null && u.daysRemaining != null,
  );
  if (readable.length === 0) {
    return {
      tokenEnv: preferred, fellBack: true, headroomPerDay: null,
      reason: "Apify usage unreadable; using the configured account",
    };
  }

  const ranked = readable
    .map((u) => ({ u, rate: headroomPerDay(u) ?? 0 }))
    .filter((r) => (r.u.spareAfterBaselineUsd ?? 0) >= MIN_USEFUL_SPARE_USD)
    .sort((a, b) => b.rate - a.rate);

  if (ranked.length === 0) {
    // Every account is at or near its ceiling. Hand back the default and let
    // the caller's own budget guard refuse -- routing must not manufacture
    // permission to spend that nothing granted.
    return {
      tokenEnv: preferred, fellBack: false, headroomPerDay: 0,
      reason: "no account has useful headroom; deferring to the budget guard",
    };
  }

  const best = ranked[0];
  const prefRate = pref && !pref.error ? (headroomPerDay(pref) ?? 0) : 0;

  /* A MARGIN BEFORE SWITCHING. Two accounts within a few percent of each
     other should not have work ping-ponging between them run to run -- that
     spreads spend across both ceilings for no gain and makes the logs
     unreadable. The default only loses when another account is clearly
     better placed. */
  if (best.u.tokenName === preferred || best.rate < prefRate * 1.5) {
    return {
      tokenEnv: preferred, fellBack: false, headroomPerDay: prefRate,
      reason: `configured account has $${prefRate.toFixed(3)}/day of headroom`,
    };
  }

  return {
    tokenEnv: best.u.tokenName as TokenEnv,
    fellBack: false,
    headroomPerDay: best.rate,
    reason:
      `${best.u.account ?? best.u.tokenName} has $${best.rate.toFixed(3)}/day spare `
      + `against $${prefRate.toFixed(3)} on the default, and its credit expires in `
      + `${(best.u.daysRemaining ?? 0).toFixed(1)}d`,
  };
}

/**
 * Live routing decision. Cached in-process for the length of a drain so a
 * fifty-job batch does not make a hundred usage calls.
 */
let cache: { at: number; usage: ApifyAccountUsage[] } | null = null;
const TTL_MS = 120_000;

export async function routeAccount(preferred: TokenEnv): Promise<RoutingChoice> {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    cache = { at: Date.now(), usage: await readApifyUsage() };
  }
  return chooseAccount(cache.usage, preferred);
}
