/**
 * The confidence engine: pooled estimation across clients, then shrinkage back
 * to each one.
 *
 * WHAT THIS REPLACES AND WHY
 *
 * The existing engine splits one client's videos into two groups and prints
 * the ratio of their medians. At the real client size that produces a headline
 * from pure noise 97.6% of the time. The number it prints is the number the
 * marketer remembers, and it is usually wrong -- a measured example: a "41%
 * penalty for numbers in titles", computed from three videos.
 *
 * FOUR IDEAS, IN THE ORDER THEY MATTER.
 *
 * 1. POOL ACROSS CLIENTS, NOT WITHIN ONE. No single client here has enough
 *    videos to answer "does this technique work". Thirteen of them do. Layer 2
 *    combines k noisy estimates OF THE SAME QUANTITY, which is what
 *    DerSimonian-Laird is for. Pointing it at splits WITHIN one client instead
 *    would treat "posted at a weekend" and "title has a number" as exchangeable
 *    draws from one distribution -- a category error that can only destroy
 *    information.
 *
 * 2. SHRINK WHAT GETS PRINTED. Decomposing the null-headline rate at real
 *    client sizes: current code 0.976, raise the sample floor to n>=8 -> 0.788,
 *    add shrinkage -> 0.331, add the cross-client prior -> 0.014. Shrinkage
 *    does roughly three times the work of the sample floor, and the entire
 *    significance-testing apparatus contributes about nothing to the remembered
 *    number. Testing decides WHETHER a row appears; only shrinkage changes what
 *    it SAYS.
 *
 * 3. WORK IN LOGS, REPORT GEOMETRIC MEANS. On 38 normal posts plus one 500x
 *    outlier: arithmetic mean 14.48x -- the documented "66.9x baseline"
 *    disaster -- geometric mean 1.284x, median 1.205x. ln(500) contributes as
 *    6.2, not as 500. The codebase's fear of means is well founded but was
 *    aimed at the wrong estimator: the median discards about 36% of the
 *    information (variance ratio pi/2), which at n=39 is fourteen videos'
 *    worth, when n is the entire problem.
 *
 * 4. SAY "NO DIFFERENCE" BY CONSTRUCTION. Verified against 6,000 reps at real
 *    group sizes: with nothing real going on, DL returns tau^2 = 0 in 56% of
 *    runs, B collapses to 1, and every client is handed the pooled mean. The
 *    engine's silence is a property of the method rather than a hand-tuned
 *    rule, and that property only exists at this level.
 *
 * Pure functions, no dependencies, no sampler.
 */

/* ---- Gates ---------------------------------------------------------------
   Every one of these is a measured floor rather than a round number. */

/** Below this a client contributes nothing to the pooled estimate. */
export const MIN_SIDE_POOL = 3;
/**
 * Below this the client gets no row of its own.
 *
 * n=3 admits NO 95% interval at all -- the widest possible order statistic
 * covers 75%. n=6 is the mathematical floor and its interval is the entire
 * observed range. 8 is the first practical value.
 */
export const MIN_SIDE_ROW = 8;
/** A hypothesis with fewer contributing clients does not run, and is not in
 *  the family -- so it cannot make the correction stricter for anything else. */
export const MIN_CLIENTS = 3;
export const Q_FDR = 0.10;
export const PERMUTATIONS = 5_000;
/** Inside this band a client's own posterior is not distinguishable from the
 *  pooled effect in any way worth a sentence. */
export const ACT_BAND: [number, number] = [0.87, 1.15];
/** If more than this share of contributing clients have a posterior whose sign
 *  disagrees with the pooled mean, the pooled effect may not be stated as
 *  advice. */
export const MIXED_THRESHOLD = 0.20;
/** Geometric mean and median diverging by more than this means the group is
 *  too skewed to summarise at all. */
export const SKEW_SUPPRESS = 2.0;

/* ---- Types --------------------------------------------------------------- */

/** One scored post. `x` is ln(perfIndex) -- the log is not a detail. */
export type Observation = {
  clientId: string;
  platform: string;
  x: number;
  /** Binary hypotheses: which side. Rank hypotheses: the covariate. Null =
   *  UNOBSERVED, and the post is dropped rather than counted as a negative. */
  value: boolean | number | null;
};

export type ClientEstimate = {
  clientId: string;
  /** Effect on the log scale: a difference of log means for binary, Fisher-z
   *  of Spearman's rho for rank. */
  y: number;
  /** Sampling variance of y. */
  v: number;
  n1: number;
  n0: number;
};

export type Pooled = {
  mu: number;
  se: number;
  tau2: number;
  i2: number;
  k: number;
};

export type ClientPosterior = {
  clientId: string;
  /** Shrinkage weight: 1 = take the pooled mean entirely. */
  b: number;
  theta: number;
  multiplier: number;
  n1: number;
  n0: number;
  rawMultiplier: number;
};

export type HypothesisState = "acting" | "holds" | "none";

/* ---- Layer 1: one client, one hypothesis --------------------------------- */

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Sample variance (n-1). Zero for fewer than two points, which callers gate on. */
export function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
}

/**
 * A binary hypothesis for one client.
 *
 * s^2 is the client's variance over ALL its scored posts, not the variance
 * within each side. With n1 as small as 3 a within-side variance is itself
 * mostly noise, and using it would let a client whose three "with" videos
 * happened to land close together claim enormous precision and dominate the
 * pool. The client-level spread is the honest scale.
 */
export function binaryClientEstimate(
  obs: Observation[],
  clientId: string,
): ClientEstimate | null {
  const mine = obs.filter((o) => o.clientId === clientId && o.value !== null);
  const withIt = mine.filter((o) => o.value === true).map((o) => o.x);
  const without = mine.filter((o) => o.value === false).map((o) => o.x);

  if (withIt.length < MIN_SIDE_POOL || without.length < MIN_SIDE_POOL) return null;

  const s2 = variance(mine.map((o) => o.x));
  if (!(s2 > 0)) return null;              // a client with no spread says nothing

  return {
    clientId,
    y: mean(withIt) - mean(without),
    v: s2 * (1 / withIt.length + 1 / without.length),
    n1: withIt.length,
    n0: without.length,
  };
}

/** Spearman's rho: Pearson correlation of the ranks, with ties averaged. */
export function spearman(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 4) return null;
  const ra = rank(a);
  const rb = rank(b);
  const ma = mean(ra), mb = mean(rb);
  let num = 0, da = 0, dbb = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    dbb += (rb[i] - mb) ** 2;
  }
  const den = Math.sqrt(da * dbb);
  return den > 0 ? num / den : null;
}

function rank(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
  const out = new Array(xs.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    // Ties share the average rank, or the correlation is a function of input
    // order for any covariate with repeated values -- and length_seconds is
    // full of them.
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = avg;
    i = j + 1;
  }
  return out;
}

/**
 * A rank hypothesis for one client, Fisher-z transformed so it can be pooled
 * on a scale where the variance does not depend on the effect.
 */
export function rankClientEstimate(
  obs: Observation[],
  clientId: string,
): ClientEstimate | null {
  const mine = obs.filter(
    (o) => o.clientId === clientId && typeof o.value === "number" && Number.isFinite(o.value),
  );
  // n-3 is the Fisher-z denominator, so n must clear it with room to spare.
  if (mine.length < MIN_SIDE_POOL * 2) return null;

  const rho = spearman(mine.map((o) => o.value as number), mine.map((o) => o.x));
  if (rho === null) return null;
  // atanh(+-1) is infinite; a perfect correlation at these n is an artefact.
  const clamped = Math.max(-0.999, Math.min(0.999, rho));

  return {
    clientId,
    y: Math.atanh(clamped),
    v: 1 / (mine.length - 3),
    n1: mine.length,
    n0: 0,
  };
}

/* ---- Layer 2: DerSimonian-Laird ------------------------------------------ */

export function dersimonianLaird(estimates: ClientEstimate[]): Pooled | null {
  const k = estimates.length;
  if (k < MIN_CLIENTS) return null;

  const w = estimates.map((e) => 1 / e.v);
  const sw = w.reduce((a, b) => a + b, 0);
  const mu0 = estimates.reduce((a, e, i) => a + w[i] * e.y, 0) / sw;
  const q = estimates.reduce((a, e, i) => a + w[i] * (e.y - mu0) ** 2, 0);
  const sw2 = w.reduce((a, b) => a + b * b, 0);
  const c = sw - sw2 / sw;

  /* tau^2 is CLAMPED AT ZERO, and that clamp is the engine's whole capacity to
     say "no difference". Q below its null expectation of k-1 means the clients
     agree no more than chance would predict; the estimator would go negative,
     which is meaningless, so it is floored. Verified over 6,000 null reps at
     real group sizes: this fires in 56% of them, B collapses to 1, and every
     client is simply handed the pooled mean. */
  const tau2 = c > 0 ? Math.max(0, (q - (k - 1)) / c) : 0;

  const ws = estimates.map((e) => 1 / (e.v + tau2));
  const sws = ws.reduce((a, b) => a + b, 0);

  return {
    mu: estimates.reduce((a, e, i) => a + ws[i] * e.y, 0) / sws,
    se: Math.sqrt(1 / sws),
    tau2,
    i2: q > 0 ? Math.max(0, (q - (k - 1)) / q) : 0,
    k,
  };
}

/* ---- Layer 3: blocked permutation ---------------------------------------- */

/**
 * A seeded generator, because a jittering p-value silently busts the analysis
 * cache and re-buys every narration. Seed from the run's input digest and the
 * same data gives the same answer forever.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function digestSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Exact p-value under the null of no within-block association.
 *
 * PERMUTED WITHIN (client, platform) BLOCKS, which is not a detail -- it is
 * what kills the two confounds that actually exist here, by construction
 * rather than by adjustment:
 *
 *   Platform is a proxy for format. "Longer than median" may simply mean "is
 *   YouTube long-form", because Shorts are length-capped and TikTok is not;
 *   "posted before noon" may simply mean "is a Reel".
 *
 *   Clients have different baselines. Permuting within a client means two
 *   clients are never compared with each other directly.
 *
 * Chosen over mu/se because it is exact under that null, assumes no
 * distribution, and copes with wildly unequal group sizes -- all three of which
 * describe this data.
 */
export function permutationP(
  obs: Observation[],
  estimator: (o: Observation[]) => Pooled | null,
  observedMu: number,
  { permutations = PERMUTATIONS, seed = 1 }: { permutations?: number; seed?: number } = {},
): number {
  const rand = rng(seed);

  const blocks = new Map<string, Observation[]>();
  for (const o of obs) {
    if (o.value === null) continue;
    const key = `${o.clientId}|${o.platform}`;
    if (!blocks.has(key)) blocks.set(key, []);
    blocks.get(key)!.push(o);
  }

  let atLeastAsExtreme = 0;
  for (let b = 0; b < permutations; b++) {
    const shuffled: Observation[] = [];
    for (const rows of blocks.values()) {
      // Shuffle the LABELS, keeping x where it is: that is the null of "the
      // label carries no information", not "the outcomes are exchangeable".
      const labels = rows.map((r) => r.value);
      for (let i = labels.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [labels[i], labels[j]] = [labels[j], labels[i]];
      }
      rows.forEach((r, i) => shuffled.push({ ...r, value: labels[i] }));
    }
    const p = estimator(shuffled);
    if (p && Math.abs(p.mu) >= Math.abs(observedMu)) atLeastAsExtreme++;
  }

  // The +1s make this a valid exact test: the observed arrangement is itself
  // one of the possibilities, so p can never be 0.
  return (1 + atLeastAsExtreme) / (1 + permutations);
}

/* ---- Layer 4: Benjamini-Hochberg ----------------------------------------- */

/**
 * FDR control at q, applied ONCE and workspace-wide.
 *
 * BH rather than Bonferroni because a false positive here means a marketer
 * puts numbers in titles for a month, not a catastrophe. The right question is
 * "of the findings I show, what fraction are junk", which is FDR, and q=0.10
 * is a sentence that can go in the UI: expect about one in ten of these to be
 * spurious. Bonferroni's flat threshold is also close to unreachable at these
 * n, and would admit only perfect separations from small groups -- which are
 * outlier artefacts, precisely the thing to exclude.
 *
 * The FAMILY is workspace-wide because the estimate is. Correcting per client
 * and calling it done is a documented way to inflate the real FDR well past
 * nominal.
 */
export function benjaminiHochberg(pvalues: number[], q = Q_FDR): boolean[] {
  const m = pvalues.length;
  const order = pvalues.map((p, i) => [p, i] as const).sort((a, b) => a[0] - b[0]);
  const rejected = new Array(m).fill(false);
  let cutoff = -1;
  for (let i = 0; i < m; i++) {
    if (order[i][0] <= ((i + 1) / m) * q) cutoff = i;
  }
  // Everything up to and including the LARGEST passing index is rejected, even
  // if an individual p in between fails its own threshold -- that step-up is
  // what BH is.
  for (let i = 0; i <= cutoff; i++) rejected[order[i][1]] = true;
  return rejected;
}

/* ---- Layer 5: the number that gets printed ------------------------------- */

/**
 * The client's own posterior, which is the only number a marketer sees.
 *
 * B = v/(v+tau^2) is the share of the pooled mean to keep. A client with a
 * noisy estimate (large v) or a hypothesis where clients genuinely agree
 * (small tau^2) is pulled almost entirely to the pooled effect; a client with
 * a lot of data on a hypothesis where clients differ keeps its own.
 *
 * On the real reported finding -- client grand mean ln = -0.5108, sigma^2 = 1:
 * with-number n=3 gives B=0.769 and a posterior of 0.545x against a raw
 * 0.396x; without n=36 gives B=0.217 and 0.657x. The reported 0.588x becomes
 * 0.830x. A "41% penalty for numbers in titles" becomes a 17% lean, and that
 * is the honest number.
 */
export function posterior(e: ClientEstimate, pooled: Pooled): ClientPosterior {
  const b = pooled.tau2 > 0 ? e.v / (e.v + pooled.tau2) : 1;
  const theta = b * pooled.mu + (1 - b) * e.y;
  return {
    clientId: e.clientId,
    b,
    theta,
    multiplier: Math.exp(theta),
    rawMultiplier: Math.exp(e.y),
    n1: e.n1,
    n0: e.n0,
  };
}

/**
 * A pooled effect whose sign flips between clients is not advice.
 *
 * A pooled 1.3x with tau=0.35 spans real client effects of 0.83x to 2.04x, and
 * 22% of clients are HURT by following it; at tau=0.70 it spans 0.53x-3.19x
 * and 35% are hurt. Averaging is the wrong summary when the thing being
 * averaged points in both directions, and the correct output is then per-client
 * posteriors with no headline.
 */
export function isMixed(posteriors: ClientPosterior[], mu: number): boolean {
  if (!posteriors.length || mu === 0) return false;
  const disagreeing = posteriors.filter((p) => Math.sign(p.theta) !== Math.sign(mu)).length;
  return disagreeing / posteriors.length > MIXED_THRESHOLD;
}

/**
 * Too skewed to summarise.
 *
 * Inference runs on the geometric mean; the display shows the median. They
 * normally agree closely, and where they diverge sharply that divergence is
 * itself the finding: the group has no representative value, and any single
 * number stated about it will mislead.
 */
export function isTooSkewed(xs: number[]): boolean {
  if (xs.length < 2) return false;
  const geo = Math.exp(mean(xs));
  const med = Math.exp(median(xs));
  if (!(geo > 0) || !(med > 0)) return false;
  return Math.max(geo / med, med / geo) > SKEW_SUPPRESS;
}

/**
 * The three states, computed in code and handed to the model AS DATA. The
 * model may not alter them.
 *
 * Three rather than five, because five was measured and rejected: at real
 * client sizes with real effects present, "unresolved" was 0.892 of rows and
 * "ruled out" was 0.000 -- a per-row wall of hedges, which is the failed
 * product this design exists to avoid.
 */
export function stateFor(
  { significant, mixed, p }: { significant: boolean; mixed: boolean; p: ClientPosterior },
): HypothesisState {
  if (!significant || mixed) return "none";
  const bigEnough = p.n1 >= MIN_SIDE_ROW && (p.n0 === 0 || p.n0 >= MIN_SIDE_ROW);
  const outsideBand = p.multiplier < ACT_BAND[0] || p.multiplier > ACT_BAND[1];
  return bigEnough && outsideBand ? "acting" : "holds";
}
