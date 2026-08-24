/**
 * Why did THIS video do what it did?
 *
 * THE HONEST ANSWER IS ALWAYS "HERE IS WHAT IT SHARES WITH OTHERS THAT DID
 * WELL", AND NEVER "BECAUSE". Nothing in this file establishes causation and
 * nothing in it is allowed to imply causation, because the data cannot carry
 * that claim: these are observational comparisons on a corpus the agency
 * chose, not an experiment anybody ran. A video that opened with a question
 * was also shot that week, about that topic, by that editor, at that length.
 *
 * So the output is deliberately shaped as a comparison the reader completes
 * themselves: this video has attribute X; the client's videos WITH X ran at
 * a median of A, those WITHOUT at B, on n=this many each. That is a fact. The
 * inference is the reader's, and they are told it is theirs.
 *
 * WHY THIS IS NOT THE INFERENCE ENGINE. inference.ts pools across clients,
 * shrinks per client, permutes, and corrects a fixed family with
 * Benjamini-Hochberg at q=0.10. It answers "does this hold in general". This
 * file answers something narrower and much cheaper -- "what is unusual about
 * this one video, within this one client" -- and it must never look like the
 * engine's output or a reader will grant it the engine's authority. Hence: no
 * p-values, no significance language, no "finding". Just medians, counts, and
 * the word `associated`.
 *
 * THE PER-VIDEO INDEX IS NOT SHOWN AS A HEADLINE, AND THAT IS DELIBERATE. The
 * "1.2x baseline" chip was removed from the video page by request, with a
 * comment recording why: the baseline moves as an account grows, so the same
 * video reads as a win or a failure depending on when you looked. That
 * objection is exactly as true here. The index appears only as a comparison
 * against the client's OWN median over the same corpus -- a ratio of two
 * numbers that move together -- rather than as a standalone score.
 */

export const ATTRIBUTION_VERSION = 1;

/**
 * Both sides need this many videos before a comparison is stated.
 *
 * MIN_SIDE_ROW from inference.ts, and the same value on purpose: this surface
 * is weaker than the engine in every other respect, so it must not be looser
 * about the one thing they share. A comparison the engine would refuse to
 * make cannot appear on a video page with more confident wording.
 */
export const MIN_SIDE = 8;

/** Outside this band the difference is worth a reader's attention. */
const BAND_LO = 0.87;
const BAND_HI = 1.15;

export type AttributeValue = {
  /** Stable key, e.g. "hook:question" or "length:under_30s". */
  key: string;
  /** Human wording, e.g. "Question hook". */
  label: string;
  /** Which family it belongs to, for grouping in the UI. */
  family: string;
};

export type ScoredVideo = {
  id: string;
  index: number | null;
  attributes: AttributeValue[];
};

export type AttributionRow = {
  key: string;
  label: string;
  family: string;
  nWith: number;
  nWithout: number;
  medianWith: number;
  medianWithout: number;
  /** medianWith / medianWithout. */
  ratio: number;
  /** True when either side is under MIN_SIDE — shown, never ranked. */
  underpowered: boolean;
};

export type VideoAttribution = {
  /** This video's index, or null when it was never scored. */
  index: number | null;
  /** Median index across the client's scored videos. */
  clientMedian: number | null;
  /** index / clientMedian — how this one sat against its own stablemates. */
  vsClient: number | null;
  /** How many of the client's videos the comparison rests on. */
  cohort: number;
  /** One row per attribute this video HAS, best-associated first. */
  rows: AttributionRow[];
  /**
   * True when the video is scored but no attribute cleared MIN_SIDE. The UI
   * must say so out loud: an empty list reads as "nothing distinguishes this
   * video", when the truth is "we do not have enough comparable videos yet".
   */
  nothingComparable: boolean;
};

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Compare one video's attributes against the rest of its client's corpus.
 *
 * `cohort` must be the client's OWN videos, including this one. Comparing
 * against the whole workspace would mix accounts with different baselines,
 * and the index is already normalised per account precisely so that it does
 * not have to.
 */
export function attributeVideo(
  video: ScoredVideo,
  cohort: ScoredVideo[],
): VideoAttribution {
  const scored = cohort.filter(
    (v): v is ScoredVideo & { index: number } => v.index != null && v.index > 0,
  );
  const clientMedian = scored.length ? median(scored.map((v) => v.index)) : null;
  const index = video.index != null && video.index > 0 ? video.index : null;

  const rows: AttributionRow[] = [];
  for (const attr of video.attributes) {
    // The video itself stays IN both the corpus and its own "with" side.
    // Removing it would compare this video against a cohort defined partly by
    // its absence, and with n as small as 8 that shifts the median visibly.
    const withIt = scored.filter((v) => v.attributes.some((a) => a.key === attr.key));
    const without = scored.filter((v) => !v.attributes.some((a) => a.key === attr.key));
    if (!withIt.length || !without.length) continue;

    const medianWith = median(withIt.map((v) => v.index));
    const medianWithout = median(without.map((v) => v.index));
    if (!(medianWithout > 0)) continue;

    rows.push({
      key: attr.key,
      label: attr.label,
      family: attr.family,
      nWith: withIt.length,
      nWithout: without.length,
      medianWith,
      medianWithout,
      ratio: medianWith / medianWithout,
      underpowered: withIt.length < MIN_SIDE || without.length < MIN_SIDE,
    });
  }

  /* Powered rows first, then by distance from parity in either direction --
     an attribute associated with HALF the usual reach is exactly as worth
     reading as one associated with double, and sorting by raw ratio would
     bury it at the bottom. */
  rows.sort((a, b) => {
    if (a.underpowered !== b.underpowered) return a.underpowered ? 1 : -1;
    return Math.abs(Math.log(b.ratio)) - Math.abs(Math.log(a.ratio));
  });

  const powered = rows.filter((r) => !r.underpowered);
  return {
    index,
    clientMedian,
    vsClient: index != null && clientMedian ? index / clientMedian : null,
    cohort: scored.length,
    rows,
    nothingComparable: index != null && powered.length === 0,
  };
}

/** Is this row worth a reader's attention, or is it parity? */
export function isNotable(row: AttributionRow): boolean {
  return !row.underpowered && (row.ratio > BAND_HI || row.ratio < BAND_LO);
}

/* ---- Turning a video into attributes --------------------------------------
   Kept here so the video page and any future caller derive the SAME
   attributes. A second implementation that bucketed length differently would
   make two screens disagree about the same video. */

export type VideoFacts = {
  hookType?: string | null;
  hookTypeLabel?: string | null;
  lengthSeconds?: number | null;
  topicLabels?: string[] | null;
  postedAt?: Date | null;
  hasTranscript?: boolean;
};

/**
 * Length bands, not raw seconds.
 *
 * A continuous variable cannot be split into with/without at all, and the
 * bands are the ones short-form editors actually think in. Deliberately
 * coarse: finer bands would push every cell under MIN_SIDE and the whole
 * table would go quiet.
 */
export function lengthBand(seconds: number): { key: string; label: string } {
  if (seconds < 15) return { key: "length:under_15s", label: "Under 15s" };
  if (seconds < 30) return { key: "length:15_30s", label: "15–30s" };
  if (seconds < 60) return { key: "length:30_60s", label: "30–60s" };
  if (seconds < 180) return { key: "length:1_3m", label: "1–3 min" };
  return { key: "length:over_3m", label: "Over 3 min" };
}

export function attributesOf(facts: VideoFacts): AttributeValue[] {
  const out: AttributeValue[] = [];

  if (facts.hookType) {
    out.push({
      key: `hook:${facts.hookType}`,
      label: `${facts.hookTypeLabel ?? facts.hookType} hook`,
      family: "Hook",
    });
  }

  if (facts.lengthSeconds != null && facts.lengthSeconds > 0) {
    const b = lengthBand(facts.lengthSeconds);
    out.push({ key: b.key, label: b.label, family: "Length" });
  }

  for (const raw of facts.topicLabels ?? []) {
    const topic = String(raw ?? "").trim();
    if (topic) out.push({ key: `topic:${topic}`, label: topic, family: "Topic" });
  }

  if (facts.postedAt) {
    const day = facts.postedAt.getUTCDay();
    if (day === 0 || day === 6) {
      out.push({ key: "posted:weekend", label: "Posted at a weekend", family: "Timing" });
    } else {
      out.push({ key: "posted:weekday", label: "Posted on a weekday", family: "Timing" });
    }
    const hour = facts.postedAt.getUTCHours();
    out.push(
      hour < 12
        ? { key: "posted:am", label: "Posted before noon", family: "Timing" }
        : { key: "posted:pm", label: "Posted after noon", family: "Timing" },
    );
  }

  return out;
}
