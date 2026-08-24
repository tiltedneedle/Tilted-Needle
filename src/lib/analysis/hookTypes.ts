/**
 * The hook taxonomy — tagged by a human, per video.
 *
 * WHY THIS IS MANUAL AND NOT DERIVED. `content_items.hook` already holds the
 * verbatim opening line ("This is a week in my life", "Your pastries are so
 * bad you should give it to the dogs"), and `video_descriptors.hook_descriptor`
 * already holds a model's topic-stripped reading of it. Neither can answer
 * "which hooks work", and for the same reason: they are free text. 28 distinct
 * opening lines across 570 videos group into 28 sets of one. A performance
 * question needs a CONTROLLED vocabulary or every cell has n=1.
 *
 * So this list is the vocabulary, and a person picks from it. That is not a
 * fallback for lacking a classifier — it is the better instrument. A model
 * asked to classify a hook agrees with itself about 80% of the time, and the
 * disagreements cluster on exactly the ambiguous cases that matter; a team
 * that shot the video knows what it was trying to do.
 *
 * TEN, DELIBERATELY. The count is a measurement decision, not taste. With 570
 * videos and roughly 350 scored, ten buckets average 35 apiece — above the
 * MIN_SIDE_ROW of 8 this codebase requires before it will state a per-client
 * number. Twenty buckets would halve that and most cells would fall below the
 * floor, so the extra precision would buy silence. If a bucket proves too
 * coarse later, split it THEN, with the counts to justify it.
 *
 * Every label is phrased as what the FIRST THREE SECONDS do, because that is
 * the only thing the tagger can judge consistently. "Educational" is a genre,
 * not a hook, and two people will not agree on it.
 */

export const HOOK_TYPE_VERSION = 1;

export type HookType =
  | "question"
  | "bold_claim"
  | "statistic"
  | "story"
  | "problem"
  | "curiosity_gap"
  | "direct_address"
  | "demonstration"
  | "contrarian"
  | "list_promise";

export type HookTypeSpec = {
  id: HookType;
  /** Shown in the dropdown. */
  label: string;
  /** Shown under the label, so two taggers make the same call. */
  hint: string;
  /** A real opening line of this shape, for the tagger to pattern-match on. */
  example: string;
};

export const HOOK_TYPES: HookTypeSpec[] = [
  {
    id: "question",
    label: "Question",
    hint: "Opens by asking the viewer something, out loud or on screen.",
    example: "“Why does nobody talk about this?”",
  },
  {
    id: "bold_claim",
    label: "Bold claim",
    hint: "States something strongly as fact in the first line.",
    example: "“This is the best pastry in London.”",
  },
  {
    id: "statistic",
    label: "Number or stat",
    hint: "Leads with a figure — price, count, percentage, year.",
    example: "“Touring a $50,000,000 corporate jet.”",
  },
  {
    id: "story",
    label: "Story opening",
    hint: "Drops into a personal anecdote already in progress.",
    example: "“So I was at Goodwood last week and…”",
  },
  {
    id: "problem",
    label: "Problem or pain",
    hint: "Names something the viewer struggles with, before any solution.",
    example: "“Your ads are getting ignored and here's why.”",
  },
  {
    id: "curiosity_gap",
    label: "Curiosity gap",
    hint: "Deliberately withholds the payoff to force the next second.",
    example: "“You won't believe what was inside.”",
  },
  {
    id: "direct_address",
    label: "Direct address",
    hint: "Speaks straight at the viewer — “you”, or an instruction.",
    example: "“Stop editing your videos like this.”",
  },
  {
    id: "demonstration",
    label: "Show, don't tell",
    hint: "Action or visual first, little or no speech in the opening.",
    example: "(hands already assembling the thing, no voiceover)",
  },
  {
    id: "contrarian",
    label: "Contrarian",
    hint: "Contradicts something the audience is assumed to believe.",
    example: "“Everyone says to post daily. They're wrong.”",
  },
  {
    id: "list_promise",
    label: "List or promise",
    hint: "Promises a countable payoff — “3 things”, “here's how”.",
    example: "“In 20 years of business, here's what I learned.”",
  },
];

const BY_ID = new Map(HOOK_TYPES.map((h) => [h.id, h]));

export function isHookType(value: unknown): value is HookType {
  return typeof value === "string" && BY_ID.has(value as HookType);
}

export function hookTypeLabel(id: string | null | undefined): string | null {
  if (!id) return null;
  return BY_ID.get(id as HookType)?.label ?? null;
}

/**
 * The floor below which a hook's number is not shown at all.
 *
 * Same value as MIN_SIDE_ROW in inference.ts, and deliberately the same: both
 * answer "is there enough of this to say anything", and letting them drift
 * would mean the hook table stating a figure the engine would refuse to.
 */
export const MIN_VIDEOS_PER_HOOK = 8;

export type HookPerformance = {
  hookType: HookType;
  label: string;
  /** Videos with this hook AND a usable performance index. */
  n: number;
  /** Median perfIndex — the account's own norm is the denominator. */
  medianIndex: number;
  /**
   * Median of every OTHER hook, for this client. The comparison is against
   * siblings rather than against 1.0: 1.0 means "this account's typical post"
   * including posts with no hook tagged at all, and a hook can only be judged
   * against the alternatives that were actually available.
   */
  medianOthers: number | null;
  /** medianIndex / medianOthers, or null when there is nothing to compare to. */
  ratio: number | null;
  /** True when n is below MIN_VIDEOS_PER_HOOK — shown, but never ranked. */
  underpowered: boolean;
};

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Per-hook performance for ONE client.
 *
 * Deliberately not pooled across clients, and deliberately not significance
 * tested. Those are jobs the inference engine already does properly, on a
 * hypothesis family fixed in advance; bolting a second, weaker test on the
 * side would produce a number that looks like the engine's and is not. This
 * is descriptive: here is what happened, here is how many, compare it
 * yourself. `underpowered` is the honesty flag, and the caller must not sort
 * on a row that carries it.
 */
export function hookPerformance(
  videos: { hookType: string | null; index: number | null }[],
): HookPerformance[] {
  const usable = videos.filter(
    (v): v is { hookType: HookType; index: number } =>
      isHookType(v.hookType) && typeof v.index === "number" && v.index > 0,
  );

  const byHook = new Map<HookType, number[]>();
  for (const v of usable) {
    if (!byHook.has(v.hookType)) byHook.set(v.hookType, []);
    byHook.get(v.hookType)!.push(v.index);
  }

  const out: HookPerformance[] = [];
  for (const [hookType, indices] of byHook) {
    const others = usable.filter((v) => v.hookType !== hookType).map((v) => v.index);
    const medianIndex = median(indices);
    const medianOthers = others.length ? median(others) : null;
    out.push({
      hookType,
      label: BY_ID.get(hookType)!.label,
      n: indices.length,
      medianIndex,
      medianOthers,
      ratio: medianOthers && medianOthers > 0 ? medianIndex / medianOthers : null,
      underpowered: indices.length < MIN_VIDEOS_PER_HOOK,
    });
  }

  // Powered rows first, best ratio first within each group. An underpowered
  // row sorted among the others would read as a ranking it has not earned.
  return out.sort((a, b) => {
    if (a.underpowered !== b.underpowered) return a.underpowered ? 1 : -1;
    return (b.ratio ?? 0) - (a.ratio ?? 0);
  });
}
