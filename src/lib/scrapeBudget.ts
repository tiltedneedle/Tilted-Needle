/**
 * Budget-aware scheduling for metered platforms.
 *
 * Only Instagram costs money per read today, but nothing here is
 * Instagram-specific: a platform is metered if it has rows in
 * scrape_schedule, and free platforms simply have none and skip all of this.
 *
 * The ordering rule that matters: budget is claimed BEFORE the vendor is
 * called, and only the granted amount is spent. Claiming afterwards would
 * mean a crash mid-run leaves credit spent and unrecorded -- and on a plan
 * that blocks rather than bills, an unrecorded overspend is what silently
 * kills syncing for the rest of the month.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = SupabaseClient<any>;

/**
 * "transcription" is RING-FENCED, and that is the whole reason it exists as a
 * pool rather than a slice of discovery. Sharing meant a busy discovery month
 * silently stopped transcribing, and the symptom is a corpus that quietly
 * stops growing while every dashboard still looks healthy. Transcripts are the
 * input the entire analysis layer reads.
 */
export type BudgetPool = "auto" | "discovery" | "manual" | "transcription";

export type BudgetStatus = {
  periodStart: string;
  periodEnd: string;
  limits: { auto: number; discovery: number; manual: number; transcription: number };
  used: { auto: number; discovery: number; manual: number; transcription: number };
  remaining: { auto: number; discovery: number; manual: number; transcription: number };
  /**
   * The day this platform's budget resets, matching the Apify account that
   * funds it -- 11th for TikTok (palatial_lemongrass), 28th for the rest
   * (tilted_Needle). Null means the old calendar-month behaviour.
   */
  cycleAnchorDay: number | null;
  /** Days until the counters reset, for the UI to show alongside the count. */
  daysUntilReset: number;
};

export type DuePost = {
  id: string;
  externalId: string;
  postedAt: string | null;
  lastScrapedAt: string | null;
  ageDays: number;
};

type ScheduleBand = {
  min_age_days: number;
  max_age_days: number | null;
  interval_days: number;
};

/**
 * Whether reading a post on this platform COSTS MONEY.
 *
 * It used to answer a different question -- "does this platform have rows in
 * scrape_schedule?" -- and the two happened to give the same answer for as
 * long as Instagram was the only platform with a refresh cadence. It is the
 * kind of proxy that is correct until the moment it silently is not.
 *
 * That moment arrived when youtube and tiktok were given cadences. Adding
 * schedule bands reclassified both as "metered", which routed them down
 * syncMeteredAccount and made every free read claim from a budget that exists
 * to cap Apify spend. limit_auto defaults to 1400/month; twice-daily refreshes
 * are ~8,600/month for tiktok and ~4,800 for youtube, so the new cadence would
 * have worked for about five days and then reported "Scrape budget exhausted"
 * every run until the period rolled over.
 *
 * The provider capability is the actual answer, and it always was -- the Data
 * sync page has been rendering its "metered"/"free" pill from
 * PROVIDERS[slug].capability.isMetered this whole time. So the UI and the
 * budget were reading two different sources, and only one of them was right.
 *
 * Note this is deliberately about the REFRESH. TikTok carries a separate
 * `discoveryMetered` flag because finding a new video does cost Apify credit
 * while re-reading a known one never does; discovery claims from its own pool
 * regardless of what this returns.
 *
 * `db` is retained so the signature does not churn at ~6 call sites, and
 * because a future per-workspace override would need it.
 */
export async function isMetered(_db: Db, platformSlug: string): Promise<boolean> {
  const { PROVIDERS } = await import("@/lib/providers");
  return PROVIDERS[platformSlug]?.capability.isMetered ?? false;
}

/**
 * Reserves budget. Returns how many reads were granted, which may be fewer
 * than asked for and may be zero. Callers must spend exactly the granted
 * amount, never the requested one.
 */
export async function claim(
  db: Db,
  workspaceId: string,
  platformSlug: string,
  pool: BudgetPool,
  count: number,
): Promise<number> {
  if (count <= 0) return 0;
  const { data, error } = await db.rpc("claim_scrape_budget", {
    p_workspace_id: workspaceId,
    p_platform_slug: platformSlug,
    p_pool: pool,
    p_count: count,
  });
  if (error) throw new Error(`Could not claim scrape budget: ${error.message}`);
  return typeof data === "number" ? data : 0;
}

/**
 * Hands budget back when a claim went unused -- a vendor error, or fewer rows
 * returned than paid for. Without this, a run of failures would burn the
 * month's allowance without fetching anything.
 *
 * Implemented as a negative claim against the same row so it goes through the
 * same lock, and floored at zero by the ledger's own arithmetic.
 */
export async function refund(
  db: Db,
  workspaceId: string,
  platformSlug: string,
  pool: BudgetPool,
  count: number,
): Promise<void> {
  if (count <= 0) return;
  const column =
    pool === "auto" ? "used_auto"
      : pool === "discovery" ? "used_discovery"
        : pool === "transcription" ? "used_transcription"
          : "used_manual";
  const { data: row } = await db
    .from("scrape_budgets")
    .select(`id, ${column}`)
    .eq("workspace_id", workspaceId)
    .eq("platform_slug", platformSlug)
    .lte("period_start", new Date().toISOString().slice(0, 10))
    .gt("period_end", new Date().toISOString().slice(0, 10))
    .maybeSingle();
  if (!row) return;
  const current = (row as Record<string, number>)[column] ?? 0;
  await db
    .from("scrape_budgets")
    .update({ [column]: Math.max(0, current - count) })
    .eq("id", (row as { id: string }).id);
}

export async function status(
  db: Db,
  workspaceId: string,
  platformSlug: string,
): Promise<BudgetStatus | null> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await db
    .from("scrape_budgets")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("platform_slug", platformSlug)
    .lte("period_start", today)
    .gt("period_end", today)
    .maybeSingle();

  // No row yet just means nothing has been spent this period. Showing the
  // full allowance is more truthful than showing nothing.
  const start = data?.period_start ?? new Date().toISOString().slice(0, 8) + "01";
  const end =
    data?.period_end ??
    new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)
      .toISOString()
      .slice(0, 10);

  const limits = {
    auto: data?.limit_auto ?? 1400,
    discovery: data?.limit_discovery ?? 200,
    manual: data?.limit_manual ?? 200,
    // Zero, not a guess. A platform with no configured transcription
    // allowance should transcribe nothing rather than quietly spend against
    // an invented default.
    transcription: data?.limit_transcription ?? 0,
  };
  const used = {
    auto: data?.used_auto ?? 0,
    discovery: data?.used_discovery ?? 0,
    manual: data?.used_manual ?? 0,
    transcription: data?.used_transcription ?? 0,
  };

  return {
    periodStart: start,
    periodEnd: end,
    limits,
    used,
    remaining: {
      auto: Math.max(0, limits.auto - used.auto),
      discovery: Math.max(0, limits.discovery - used.discovery),
      manual: Math.max(0, limits.manual - used.manual),
      transcription: Math.max(0, limits.transcription - used.transcription),
    },
    cycleAnchorDay: data?.cycle_anchor_day ?? null,
    daysUntilReset: Math.max(
      0,
      Math.ceil((new Date(end).getTime() - Date.now()) / 86400000),
    ),
  };
}

/** The interval that applies at a given age, or null when past every band. */
export function intervalFor(bands: ScheduleBand[], ageDays: number): number | null {
  for (const b of bands) {
    const underMax = b.max_age_days == null || ageDays < b.max_age_days;
    if (ageDays >= b.min_age_days && underMax) return Number(b.interval_days);
  }
  return null; // aged out of every band -- due for retirement, not a read
}

/**
 * Posts due for a refresh, most-overdue first.
 *
 * Ordering by urgency is what makes a partial budget grant behave sensibly:
 * when only 12 of 40 due posts can be afforded, the 12 that have gone longest
 * without a read are the ones that get it.
 */
export async function findDuePosts(
  db: Db,
  workspaceId: string,
  accountId: string,
  platformSlug: string,
): Promise<{ due: DuePost[]; retire: string[] }> {
  const { data: bandRows } = await db
    .from("scrape_schedule")
    .select("min_age_days, max_age_days, interval_days")
    .eq("platform_slug", platformSlug)
    .order("min_age_days");
  const bands = (bandRows ?? []) as ScheduleBand[];
  if (bands.length === 0) return { due: [], retire: [] };

  const { data: postRows } = await db
    .from("platform_posts")
    .select("id, external_id, posted_at, last_scraped_at")
    .eq("workspace_id", workspaceId)
    .eq("account_id", accountId)
    .is("scrape_retired_at", null)
    .not("external_id", "is", null);

  const now = Date.now();
  const due: DuePost[] = [];
  const retire: string[] = [];

  for (const p of (postRows ?? []) as {
    id: string;
    external_id: string;
    posted_at: string | null;
    last_scraped_at: string | null;
  }[]) {
    // A post with no publish date cannot be aged, so it is treated as new
    // rather than skipped -- skipping would leave it never refreshed.
    const ageDays = p.posted_at
      ? Math.floor((now - new Date(p.posted_at).getTime()) / 86400000)
      : 0;

    const interval = intervalFor(bands, ageDays);
    if (interval == null) {
      retire.push(p.id);
      continue;
    }

    const sinceDays = p.last_scraped_at
      ? (now - new Date(p.last_scraped_at).getTime()) / 86400000
      : Infinity;
    if (sinceDays >= interval) {
      due.push({
        id: p.id,
        externalId: p.external_id,
        postedAt: p.posted_at,
        lastScrapedAt: p.last_scraped_at,
        ageDays,
      });
    }
  }

  // Never-scraped first, then longest-waiting.
  due.sort((a, b) => {
    if (a.lastScrapedAt === null) return b.lastScrapedAt === null ? 0 : -1;
    if (b.lastScrapedAt === null) return 1;
    return a.lastScrapedAt.localeCompare(b.lastScrapedAt);
  });

  return { due, retire };
}

/**
 * Retires posts past the last band. Their recorded metrics are untouched --
 * this stops future reads, it does not remove history.
 */
export async function retirePosts(db: Db, postIds: string[]): Promise<number> {
  if (postIds.length === 0) return 0;
  const { error } = await db
    .from("platform_posts")
    .update({ scrape_retired_at: new Date().toISOString() })
    .in("id", postIds);
  if (error) throw new Error(`Could not retire posts: ${error.message}`);
  return postIds.length;
}
