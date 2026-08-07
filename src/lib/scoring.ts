/**
 * Performance scoring (PRD section 5).
 *
 * These numbers affect how people are judged, so the model deliberately
 * corrects the four ways a naive "average views per person" is unfair:
 * channel size, post age, heavy-tailed view distributions, and small samples.
 *
 * The cardinal rule: platforms are scored independently, end to end. Raw
 * counts are never pooled, because a view is a different unit on every
 * platform. Only finished per-platform scores are ever averaged.
 *
 * Pure functions with no I/O, so the math can be tested directly.
 */

export const RECENCY_HALF_LIFE_DAYS = 90;
/** Prior strength for shrinkage. n=1 lands ~83% on the role mean. */
export const SHRINKAGE_K = 5;
/** Posts on a platform before someone is ranked publicly there. */
export const MIN_POSTS_TO_RANK = 3;
/** Posts of account history needed for a trustworthy baseline. */
export const BASELINE_WINDOW = 10;

export type Snapshot = { capturedAt: Date; value: number };

export type PostInput = {
  postId: string;
  accountId: string;
  platform: string;
  postedAt: Date;
  snapshots: Snapshot[];
};

export type MaturityValue = {
  value: number;
  /** False when no snapshot reached the maturity window yet. */
  isMature: boolean;
};

/**
 * The metric value at a fixed maturity window.
 *
 * Comparing lifetime views across posts of different ages is the single
 * easiest way to get this wrong -- older posts win automatically. So we read
 * each post at the same age instead.
 *
 * If no snapshot has reached the window yet, the latest value is returned
 * flagged immature. Callers must not mix immature values into a baseline:
 * doing so quietly compares a 2-day-old number against 7-day-old ones.
 */
export function valueAtMaturity(
  snapshots: Snapshot[],
  postedAt: Date,
  windowDays: number,
  now: Date = new Date(),
): MaturityValue | null {
  if (snapshots.length === 0) return null;

  const sorted = [...snapshots].sort(
    (a, b) => a.capturedAt.getTime() - b.capturedAt.getTime(),
  );
  const cutoff = postedAt.getTime() + windowDays * 86_400_000;

  // First snapshot at or after the window closes.
  const at = sorted.find((s) => s.capturedAt.getTime() >= cutoff);
  if (at) return { value: at.value, isMature: true };

  const latest = sorted[sorted.length - 1];
  // The window has closed but nobody recorded a number inside it. The latest
  // reading is the best available evidence, and is still treated as mature --
  // withholding it would discard a genuinely old post.
  if (now.getTime() >= cutoff) return { value: latest.value, isMature: true };

  return { value: latest.value, isMature: false };
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * The account's own typical performance, from the posts immediately before
 * this one. Per account and per platform -- never per client, never global
 * (PRD 5 Step 2).
 */
export function accountBaseline(
  priorValues: number[],
  window = BASELINE_WINDOW,
): number | null {
  const recent = priorValues.slice(-window).filter((v) => v > 0);
  if (recent.length === 0) return null;
  return median(recent);
}

/**
 * Dimensionless ratio against the account's own norm. This is what makes
 * cross-platform comparison legitimate: "1.8x this account's normal" means
 * the same thing everywhere, even though the raw counts do not.
 */
export function perfIndex(value: number, baseline: number): number | null {
  if (baseline <= 0) return null;
  if (value <= 0) return null;
  return value / baseline;
}

/** View distributions are log-normal; without this one viral post dominates. */
export function logScore(index: number): number {
  return Math.log(index);
}

export function recencyWeight(
  postedAt: Date,
  now: Date = new Date(),
  halfLifeDays = RECENCY_HALF_LIFE_DAYS,
): number {
  const ageDays = (now.getTime() - postedAt.getTime()) / 86_400_000;
  return Math.pow(0.5, Math.max(0, ageDays) / halfLifeDays);
}

/**
 * Empirical-Bayes shrinkage toward the role mean.
 *
 * Without this, one lucky post tops the leaderboard. Confidence should rise
 * only as evidence does, so a small sample stays near the role average.
 */
export function shrink(
  personRaw: number,
  n: number,
  roleMean: number,
  k = SHRINKAGE_K,
): number {
  if (n <= 0) return roleMean;
  return (n / (n + k)) * personRaw + (k / (n + k)) * roleMean;
}

export type ScoredPost = {
  postId: string;
  platform: string;
  index: number;
  score: number;
  weight: number;
  isMature: boolean;
};

/**
 * Scores every post on one account, in posting order, each against the
 * baseline of the posts that preceded it.
 */
export function scoreAccountPosts(
  posts: PostInput[],
  windowDays: number,
  now: Date = new Date(),
): ScoredPost[] {
  const ordered = [...posts].sort(
    (a, b) => a.postedAt.getTime() - b.postedAt.getTime(),
  );

  const out: ScoredPost[] = [];
  const priorMature: number[] = [];

  for (const post of ordered) {
    const mv = valueAtMaturity(post.snapshots, post.postedAt, windowDays, now);
    if (!mv) continue;

    const baseline = accountBaseline(priorMature);
    // Immature posts are still scored, but never feed the baseline.
    if (mv.isMature) priorMature.push(mv.value);

    if (baseline == null) continue; // Not enough history yet to judge this post.

    const index = perfIndex(mv.value, baseline);
    if (index == null) continue;

    out.push({
      postId: post.postId,
      platform: post.platform,
      index,
      score: logScore(index),
      weight: recencyWeight(post.postedAt, now),
      isMature: mv.isMature,
    });
  }

  return out;
}

export type PlatformScore = {
  platform: string;
  /** Shrunk, recency-weighted score. 0 means exactly at the account baseline. */
  score: number;
  /** Posts backing it -- always shown beside the score. */
  n: number;
  /** False below MIN_POSTS_TO_RANK: display as insufficient data, not a low score. */
  rankable: boolean;
};

/** Recency-weighted mean of a person's post scores on ONE platform. */
export function weightedMean(scored: ScoredPost[]): number {
  const totalWeight = scored.reduce((s, p) => s + p.weight, 0);
  if (totalWeight === 0) return 0;
  return scored.reduce((s, p) => s + p.weight * p.score, 0) / totalWeight;
}

export function platformScore(
  platform: string,
  scored: ScoredPost[],
  roleMean: number,
): PlatformScore {
  const n = scored.length;
  const raw = weightedMean(scored);
  return {
    platform,
    score: shrink(raw, n, roleMean),
    n,
    rankable: n >= MIN_POSTS_TO_RANK,
  };
}

export type OverallScore = {
  overall: number | null;
  /** Always carried with the overall so the breakdown can be shown beside it. */
  platforms: PlatformScore[];
  contributing: number;
};

/**
 * Unweighted mean of per-platform scores (PRD 5 Step 2).
 *
 * Every platform counts once regardless of volume, which measures how well
 * the work performs on each platform rather than where most of it happened.
 * The consequence is real and documented: 50 Instagram posts and 2 TikToks
 * means TikTok is half the overall. Switching to volume weighting makes this
 * track quantity instead -- a product decision, not a maths one.
 *
 * Platforms with no posts are excluded rather than counted as zero: absence
 * of evidence is not bad performance.
 */
export function overallScore(platforms: PlatformScore[]): OverallScore {
  const contributing = platforms.filter((p) => p.n > 0);
  if (contributing.length === 0) {
    return { overall: null, platforms, contributing: 0 };
  }
  const overall =
    contributing.reduce((s, p) => s + p.score, 0) / contributing.length;
  return { overall, platforms, contributing: contributing.length };
}

/** Multiplier form for display: 0 -> 1.0x, ln(2) -> 2.0x. */
export function asMultiplier(score: number): number {
  return Math.exp(score);
}

/**
 * Flags a post that beat its account baseline by a threshold -- the "why is
 * this one boosting" entry point. Public metrics can only say THAT it boosted;
 * explaining why needs CTR and retention, which are owner-only (PRD 4).
 */
export function isBoost(index: number, threshold = 2): boolean {
  return index >= threshold;
}
