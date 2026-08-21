/**
 * The hypothesis registry: every question the engine is allowed to ask.
 *
 * WHY A CLOSED, VERSIONED LIST RATHER THAN "LOOK FOR PATTERNS"
 *
 * The multiple-comparisons problem is the whole reason this file exists. Ask
 * enough questions of 350 posts and something crosses any threshold by luck;
 * an engine free to invent its own questions has an unbounded family size and
 * therefore an uncontrollable false-discovery rate. Fixing the family in
 * advance is what makes a Benjamini-Hochberg correction mean anything, and it
 * is the difference between "we tested sixteen things and two survived" and
 * "we found two things", which are not the same claim.
 *
 * Versioned because findings outlive the code that produced them. A finding
 * from v1 must stay resolvable after v2 adds three hypotheses, so entries are
 * appended and never renumbered, and `versionAdded` records when each arrived.
 *
 * `requires` is load-bearing, not documentation. A transcript-derived
 * hypothesis DROPS posts with no transcript rather than counting them as
 * negatives -- a video nobody transcribed has not "failed to ask a question".
 * Getting this wrong would silently move every untranscribed video onto the
 * "without" side of eleven of these sixteen tests.
 */

import type { VideoFeatures } from "./features.ts";

export const REGISTRY_VERSION = 1;

export type HypothesisKind = "binary" | "rank";
export type Requires = "metadata" | "transcript" | "descriptor";

export type Hypothesis = {
  id: string;
  versionAdded: number;
  kind: HypothesisKind;
  requires: Requires;
  /** What a marketer would predict, used only to flag surprises -- never to
   *  filter results. A registry that discarded unexpected findings would be a
   *  machine for confirming what we already believed. */
  directionExpected: "up" | "down" | "none";
  /**
   * A hypothesis with no plausible causal path, included ON PURPOSE.
   *
   * If a canary comes back significant, the pipeline is finding structure that
   * is not there -- a leak, a confound, or a threshold set too loose -- and the
   * run should be distrusted rather than published. It is the cheapest
   * available check on the machinery, because unlike every other entry here we
   * know in advance roughly what the answer should be.
   */
  isCanary: boolean;
  label: string;
  /** Binary: which side a post falls on, or null when unobserved.
   *  Rank: the covariate's value, or null when unobserved. */
  value: (f: VideoFeatures) => boolean | number | null;
};

/** Only run a hypothesis on posts where its inputs were actually observed. */
export function isObserved(h: Hypothesis, f: VideoFeatures): boolean {
  if (h.requires === "transcript" && !f.transcriptPresent) return false;
  return h.value(f) !== null;
}

export const HYPOTHESES: Hypothesis[] = [
  /* ---- Binary, metadata -------------------------------------------------
     Available on every post, including the 87 with no transcript, which makes
     these the only hypotheses that run at full sample size today. */
  {
    id: "h_title_question", versionAdded: 1, kind: "binary", requires: "metadata",
    directionExpected: "up", isCanary: false,
    label: "Title asks a question",
    value: (f) => f.titleHasQuestion,
  },
  {
    id: "h_title_numeral", versionAdded: 1, kind: "binary", requires: "metadata",
    directionExpected: "up",
    /* CANARY. "Listicle titles perform better" is folklore with no mechanism
       that would survive contact with a 30-second vertical video, and it is
       exactly the kind of claim a loose pipeline would confirm. */
    isCanary: true,
    label: "Title contains a number",
    value: (f) => f.titleHasNumeral,
  },
  {
    id: "h_posted_weekend", versionAdded: 1, kind: "binary", requires: "metadata",
    directionExpected: "none",
    /* CANARY. Publish timing is the most-repeated advice in social media and
       the least supported; platforms surface content on engagement velocity,
       not on a clock. If this fires, suspect the zone arithmetic first --
       a fixed-offset bug once moved videos across the exact boundary the
       finding was about. */
    isCanary: true,
    label: "Posted at a weekend",
    value: (f) => (f.postedWeekday === null ? null : f.postedWeekday === 0 || f.postedWeekday === 6),
  },
  {
    id: "h_posted_before_noon", versionAdded: 1, kind: "binary", requires: "metadata",
    directionExpected: "none", isCanary: true,
    label: "Posted before noon",
    value: (f) => (f.postedHour === null ? null : f.postedHour < 12),
  },

  /* ---- Binary, transcript ----------------------------------------------
     These drop untranscribed posts entirely. That is why coverage is a
     precondition for this engine rather than a nice-to-have: at 42% coverage
     they run on well under half the library. */
  {
    id: "h_hook_question", versionAdded: 1, kind: "binary", requires: "transcript",
    directionExpected: "up", isCanary: false,
    label: "Opening asks a question",
    value: (f) => f.hookHasQuestion,
  },
  {
    id: "h_hook_greeting", versionAdded: 1, kind: "binary", requires: "transcript",
    directionExpected: "down", isCanary: false,
    label: "Opening is a channel greeting",
    value: (f) => f.hookIsGreeting,
  },
  {
    id: "h_hook_second_person", versionAdded: 1, kind: "binary", requires: "transcript",
    directionExpected: "up", isCanary: false,
    label: "Opening speaks to the viewer",
    /* A RATE turned into a split, which is defensible only because the
       underlying thing is genuinely binary in practice: a hook either
       addresses the viewer or talks about the subject. The threshold is
       "at least one second-person word in the first 15 seconds". */
    value: (f) => (f.hookSecondPersonRate === null ? null : f.hookSecondPersonRate > 0),
  },
  {
    id: "h_hook_numeral", versionAdded: 1, kind: "binary", requires: "transcript",
    directionExpected: "up", isCanary: false,
    label: "Opening states a number",
    value: (f) => f.hookNumeral,
  },
  {
    id: "h_hook_imperative", versionAdded: 1, kind: "binary", requires: "transcript",
    directionExpected: "up", isCanary: false,
    label: "Opening is a command",
    /* MEASURED AT ZERO ON THIS CORPUS: 0 of 185 transcribed videos open with an
       imperative (2026-08-22). The detector works -- it is unit-tested against
       "Stop scrolling" and correctly declines "Stopping by the office" -- so
       this is a fact about the library rather than a broken feature, and a
       genuinely interesting one: nobody here opens with a command.

       Deliberately NOT removed. It costs nothing, because a hypothesis with
       nothing on one side contributes no clients and is dropped by MIN_CLIENTS
       before the family is counted, so it cannot make the correction stricter
       for anything else. And the day a client starts opening with commands, the
       question is already registered rather than needing to be invented after
       seeing the data -- which is the whole point of a fixed family. */
    value: (f) => f.hookImperativeOpen,
  },
  {
    id: "h_cta_present", versionAdded: 1, kind: "binary", requires: "transcript",
    directionExpected: "none", isCanary: false,
    label: "Contains a call to action",
    value: (f) => f.ctaPresent,
  },
  {
    id: "h_loop_marker", versionAdded: 1, kind: "binary", requires: "transcript",
    directionExpected: "up", isCanary: false,
    label: "Ends where it began (loop bait)",
    value: (f) => f.loopMarker,
  },

  /* ---- Rank (Spearman) --------------------------------------------------
     Continuous covariates are ranked, NOT median-split, and this is a free
     power win rather than a refinement. MacCallum, Zhang, Preacher & Rucker
     (Psychological Methods, 2002) put it plainly: dichotomising a continuous
     variable is rarely defensible. Measured at the same underlying effect:
     median-split power 0.34 against rank 0.51 at n=39, and 0.73 against 0.91
     at n=100.

     A covariate appears in EITHER a split or a rank test, never both -- running
     both forms is double-counting the same question into the family. */
  {
    id: "r_length_seconds", versionAdded: 1, kind: "rank", requires: "metadata",
    directionExpected: "none", isCanary: false,
    label: "Length in seconds",
    value: (f) => f.lengthSeconds,
  },
  {
    id: "r_hook_word_count", versionAdded: 1, kind: "rank", requires: "transcript",
    directionExpected: "up", isCanary: false,
    label: "Words in the first 15 seconds",
    value: (f) => f.hookWordCount,
  },
  {
    id: "r_title_length", versionAdded: 1, kind: "rank", requires: "metadata",
    directionExpected: "none", isCanary: false,
    label: "Title length",
    value: (f) => f.titleLength,
  },
  {
    id: "r_time_to_first_noun", versionAdded: 1, kind: "rank", requires: "transcript",
    directionExpected: "down", isCanary: false,
    label: "Time before the first content word",
    value: (f) => f.timeToFirstNounMs,
  },
  {
    id: "r_words_per_second", versionAdded: 1, kind: "rank", requires: "transcript",
    directionExpected: "none", isCanary: false,
    label: "Speaking pace",
    /* Stands in for the PRD's `r_hook_arousal`, which needs Tier 2 descriptors
       that do not exist yet. Deliberately not left as an empty slot: an
       arousal entry registered now would be in the family, contribute nothing,
       and make the BH correction stricter for no benefit. It gets added with
       the descriptors, as versionAdded: 2. */
    value: (f) => f.wordsPerSecond,
  },
];

/** The family actually under test, given what has been observed. Descriptor
 *  hypotheses are registered in a later phase; nothing here requires them yet,
 *  and the filter is explicit so adding them cannot silently enlarge the family
 *  for a run whose data does not support them. */
export function activeFamily(available: { descriptors: boolean }): Hypothesis[] {
  return HYPOTHESES.filter((h) => h.requires !== "descriptor" || available.descriptors);
}

export function canaries(): Hypothesis[] {
  return HYPOTHESES.filter((h) => h.isCanary);
}
