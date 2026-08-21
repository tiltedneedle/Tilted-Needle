/**
 * What actually works for a client, computed from data already in the system
 * (PRD-video-intelligence §5.3 platform fit, §5.4 metadata patterns).
 *
 * Every figure here is arithmetic over rows we already hold: boost scores,
 * lengths, publish times, and the cross-platform grouping content_items has
 * always provided and nobody has ever asked. No transcripts, no model, no
 * network. That matters twice over -- it works today while the transcript
 * route is refused, and it means the model's later job is narration over a
 * table it cannot influence.
 *
 * The discipline throughout is refusing to report a pattern that the sample
 * cannot support. Every comparison carries its n, and a split with too few
 * videos on either side returns null rather than a number that would read as
 * a finding.
 */
import { zoneOffsetMs, operatingZoneLabel } from "@/lib/tz";

/** Below this on either side of a split, a comparison is anecdote. */
export const MIN_PER_SIDE = 3;
/** Below this a client has no library worth characterising. */
export const MIN_LIBRARY = 8;

export type EvidenceVideo = {
  id: string;
  title: string;
  clientId: string | null;
  /** Highest boost index across this video's posts, when scored. */
  bestIndex: number | null;
  lengthSeconds: number | null;
  /** Full publish instant, when captured. Date-only loses the hour. */
  postedAtTs: string | null;
  /**
   * What is actually said in the opening seconds, from the transcript.
   * Null when no transcript exists -- and null must never be read as "said
   * nothing", so every hook split drops these videos rather than counting
   * them on the negative side.
   */
  hookText?: string | null;
  platforms: { platform: string; views: number }[];
};

export type Split = {
  label: string;
  /**
   * MEDIAN boost of the group that has the attribute -- not the mean.
   *
   * Social performance is violently heavy-tailed: one video at 500x baseline
   * sits in a library where the typical video is near 1x. Live data made the
   * cost obvious -- a mean put one client's TikTok at "66.9x baseline" and
   * claimed longer videos performed 19x better, both of which were a single
   * viral outlier wearing a statistic. A team reading that would go and make
   * longer videos on the strength of one lucky post.
   *
   * The median answers the question actually being asked: what does a TYPICAL
   * video with this attribute do.
   */
  withMedian: number;
  withN: number;
  /** Median boost of the group that does not. */
  withoutMedian: number;
  withoutN: number;
  /** withMedian / withoutMedian. Above 1 means the attribute is associated
      with better performance -- association, never cause, and the copy says so. */
  ratio: number;
  /** The largest single index in either group, so an outlier stays visible
      rather than being silently smoothed away by the median. */
  peak: number;
};

export type PlatformFit = {
  platform: string;
  /** Median boost of this client's posts on this platform (see Split). */
  medianIndex: number;
  n: number;
  /** Best single post, kept beside the median so a hit is not hidden. */
  peakIndex: number;
};

export type ClientEvidence = {
  clientId: string;
  videoCount: number;
  scoredCount: number;
  /** Null when the library is too small to characterise at all. */
  splits: Split[] | null;
  platformFit: PlatformFit[];
  /** Median length of the best quartile vs the rest, in seconds. */
  lengthHint: { topMedian: number; restMedian: number; n: number } | null;
  notes: string[];
};

/** Question marks are unreliable in ASR output, so match the words too. */
const QUESTION_OPEN = /(^|\s)(what|why|how|who|when|where|which|do you|did you|have you|ever)\b/i;
/** "Welcome back to the channel" -- the classic slow open. */
const GREETING_OPEN = /(welcome back|hey guys|what's up guys|hi everyone|welcome to (my|the) channel)/i;
/** Speaking to the viewer rather than about the subject. */
const DIRECT_ADDRESS = /\b(you|your|you're|yours)\b/i;

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Splits over the opening seconds. Each needs both sides populated (splitBy
 * enforces that), so a client whose videos all open the same way simply
 * reports nothing rather than a ratio of one group against nobody.
 */
function hookSplits(withHook: EvidenceVideo[]): (Split | null)[] {
  if (withHook.length < MIN_PER_SIDE * 2) return [];

  const paces = withHook.map((v) => words(v.hookText ?? ""));
  const medianPace = paces.length ? median(paces) : 0;

  return [
    splitBy(withHook, "Opening asks a question", (v) =>
      (v.hookText ?? "").includes("?") || QUESTION_OPEN.test(v.hookText ?? "")),
    splitBy(withHook, "Opening is a channel greeting", (v) =>
      GREETING_OPEN.test(v.hookText ?? "")),
    splitBy(withHook, "Opening speaks to the viewer directly", (v) =>
      DIRECT_ADDRESS.test(v.hookText ?? "")),
    medianPace > 0
      ? splitBy(
          withHook,
          `Faster opening (over ${Math.round(medianPace)} words in 15s)`,
          (v) => words(v.hookText ?? "") > medianPace,
        )
      : null,
  ];
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Compare scored videos that have an attribute against those that do not.
 * Returns null unless BOTH sides clear MIN_PER_SIDE -- a "pattern" resting on
 * two videos is astrology, and printing it with a caveat is not good enough
 * because the number is what gets remembered.
 */
export function splitBy(
  videos: EvidenceVideo[],
  label: string,
  predicate: (v: EvidenceVideo) => boolean,
): Split | null {
  const scored = videos.filter((v) => v.bestIndex != null);
  const withIt = scored.filter(predicate).map((v) => v.bestIndex!);
  const without = scored.filter((v) => !predicate(v)).map((v) => v.bestIndex!);
  if (withIt.length < MIN_PER_SIDE || without.length < MIN_PER_SIDE) return null;

  const a = median(withIt);
  const b = median(without);
  if (!(b > 0)) return null;
  return {
    label,
    withMedian: round(a),
    withN: withIt.length,
    withoutMedian: round(b),
    withoutN: without.length,
    ratio: round(a / b),
    peak: round(Math.max(...withIt, ...without)),
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Hour and weekday IN THE OPERATING ZONE, asked rather than assumed.
 *
 * These were `dubaiHour` and `dubaiWeekday`, and added a hardcoded four
 * hours. The operating zone moved to Asia/Karachi, which is UTC+5, so every
 * reading was an hour out -- and for anything posted in the first hour of a
 * Karachi day, a whole DAY out, because 00:30 Karachi is 23:30 the previous
 * day in UTC+4.
 *
 * Not cosmetic. These two functions are the entire basis of the "published
 * before noon" and "published at a weekend" findings, so a wrong offset
 * silently moves videos across the very boundary the finding is about, and
 * the model then reports the corrupted split as fact.
 *
 * zoneOffsetMs resolves the real offset for the instant in question, so this
 * also survives a zone with daylight saving -- which no fixed constant can,
 * whatever number is written in it.
 */
function operatingHour(iso: string): number {
  const at = new Date(iso);
  return new Date(at.getTime() + zoneOffsetMs(at)).getUTCHours();
}
function operatingWeekday(iso: string): number {
  const at = new Date(iso);
  return new Date(at.getTime() + zoneOffsetMs(at)).getUTCDay();
}

export function buildClientEvidence(
  clientId: string,
  videos: EvidenceVideo[],
): ClientEvidence {
  const notes: string[] = [];
  const scored = videos.filter((v) => v.bestIndex != null);

  // Platform fit works off individual posts, so it survives a small library
  // better than the splits do -- and it is the finding most likely to change
  // what the team actually does next.
  const byPlatform = new Map<string, number[]>();
  for (const v of scored) {
    for (const p of v.platforms) {
      if (!byPlatform.has(p.platform)) byPlatform.set(p.platform, []);
      byPlatform.get(p.platform)!.push(v.bestIndex!);
    }
  }
  const platformFit: PlatformFit[] = [...byPlatform.entries()]
    .filter(([, xs]) => xs.length >= MIN_PER_SIDE)
    .map(([platform, xs]) => ({
      platform,
      medianIndex: round(median(xs)),
      n: xs.length,
      peakIndex: round(Math.max(...xs)),
    }))
    .sort((a, b) => b.medianIndex - a.medianIndex);

  if (scored.length < MIN_LIBRARY) {
    notes.push(
      `Only ${scored.length} scored video${scored.length === 1 ? "" : "s"} — ` +
        `too few to characterise what works. Needs ${MIN_LIBRARY}.`,
    );
    return {
      clientId, videoCount: videos.length, scoredCount: scored.length,
      splits: null, platformFit, lengthHint: null, notes,
    };
  }

  const withLength = scored.filter((v) => v.lengthSeconds != null);
  const medianLength = withLength.length ? median(withLength.map((v) => v.lengthSeconds!)) : null;

  const splits = [
    // Title shape. Cheap to act on, and the only lever available before a
    // shoot is even scheduled.
    splitBy(scored, "Title asks a question", (v) => v.title.includes("?")),
    splitBy(scored, "Title contains a number", (v) => /\d/.test(v.title)),
    splitBy(scored, "Title over 50 characters", (v) => v.title.length > 50),

    // Length, split at this client's own median rather than an industry
    // number: what counts as long depends entirely on what they usually make.
    medianLength != null
      ? splitBy(
          scored.filter((v) => v.lengthSeconds != null),
          `Longer than this client's median (${Math.round(medianLength)}s)`,
          (v) => (v.lengthSeconds ?? 0) > medianLength,
        )
      : null,

    // What the opening actually SAYS. This is the payoff of gathering
    // transcripts at all: the hook is the one thing a team can change before
    // the next shoot, and until now nothing in the system could see it.
    //
    // Only videos WITH a transcript take part. A video with no transcript has
    // not "failed to ask a question" -- it is unobserved, and letting it sit
    // on the negative side of a split would quietly invent a finding.
    ...hookSplits(scored.filter((v) => (v.hookText ?? "").trim().length > 0)),

    // Timing. Needs posted_at_ts, which P2 started capturing -- the date-only
    // column cannot answer this and never could.
    splitBy(
      scored.filter((v) => v.postedAtTs),
      "Published at a weekend",
      (v) => [0, 6].includes(operatingWeekday(v.postedAtTs!)),
    ),
    splitBy(
      scored.filter((v) => v.postedAtTs),
      `Published before noon (${operatingZoneLabel()})`,
      (v) => operatingHour(v.postedAtTs!) < 12,
    ),
  ].filter((s): s is Split => s !== null);

  const hooked = scored.filter((v) => (v.hookText ?? "").trim().length > 0).length;
  if (hooked === 0) {
    notes.push("No transcripts yet, so nothing can be said about openings.");
  } else if (hooked < MIN_PER_SIDE * 2) {
    notes.push(
      `Opening patterns need transcripts; only ${hooked} of ${scored.length} scored ` +
        `videos have one so far.`,
    );
  }

  const timed = scored.filter((v) => v.postedAtTs).length;
  if (timed < MIN_PER_SIDE * 2) {
    notes.push(
      `Timing patterns need publish times; only ${timed} video${timed === 1 ? "" : "s"} ` +
        `carry one so far. New syncs capture them going forward.`,
    );
  }

  // Length of the best quartile against the rest.
  let lengthHint: ClientEvidence["lengthHint"] = null;
  if (withLength.length >= MIN_LIBRARY) {
    const ranked = [...withLength].sort((a, b) => b.bestIndex! - a.bestIndex!);
    const cut = Math.max(MIN_PER_SIDE, Math.floor(ranked.length / 4));
    const top = ranked.slice(0, cut);
    const rest = ranked.slice(cut);
    if (rest.length >= MIN_PER_SIDE) {
      lengthHint = {
        topMedian: Math.round(median(top.map((v) => v.lengthSeconds!))),
        restMedian: Math.round(median(rest.map((v) => v.lengthSeconds!))),
        n: withLength.length,
      };
    }
  }

  if (splits.length === 0) {
    notes.push("No attribute had enough videos on both sides to compare.");
  }

  return {
    clientId,
    videoCount: videos.length,
    scoredCount: scored.length,
    splits: splits.sort((a, b) => Math.abs(b.ratio - 1) - Math.abs(a.ratio - 1)),
    platformFit,
    lengthHint,
    notes,
  };
}

/**
 * The evidence as the model will receive it: a table, and an instruction to
 * write only about what is in it. Association language throughout -- these are
 * observational splits over a small library, and "videos with X performed
 * better" is the strongest claim the data supports. Not "X causes".
 */
export function evidenceToPrompt(e: ClientEvidence): string {
  const lines: string[] = [
    `Videos: ${e.videoCount} (${e.scoredCount} scored against their account baseline)`,
  ];

  if (e.platformFit.length > 0) {
    lines.push("", "Median boost by platform (1.0 = the account's own baseline):");
    for (const p of e.platformFit) {
      lines.push(
        `  ${p.platform}: median ${p.medianIndex}x across ${p.n} posts ` +
          `(best single post ${p.peakIndex}x)`,
      );
    }
  }

  if (e.splits?.length) {
    lines.push("", "Attribute comparisons (association only, not cause):");
    for (const s of e.splits) {
      lines.push(
        `  ${s.label}: median ${s.withMedian}x (n=${s.withN}) vs ` +
          `${s.withoutMedian}x (n=${s.withoutN}) — ratio ${s.ratio}`,
      );
    }
  }

  if (e.lengthHint) {
    lines.push(
      "",
      `Length: best quartile median ${e.lengthHint.topMedian}s, ` +
        `the rest ${e.lengthHint.restMedian}s (n=${e.lengthHint.n})`,
    );
  }

  if (e.notes.length) {
    lines.push("", "Limits of this data:");
    for (const n of e.notes) lines.push(`  ${n}`);
  }

  return lines.join("\n");
}

export const CLIENT_READ_SCHEMA = {
  type: "object",
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["text", "confidence"],
        properties: {
          text: { type: "string" },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
        },
      },
    },
  },
} as const;

export const CLIENT_READ_PROMPT = [
  "Write the week's read for one client, from the table below.",
  "",
  "Every figure you mention must appear in the table. Do not compute ratios,",
  "averages or rankings the table does not already give you.",
  "Say 'associated with' rather than 'causes': these are observational splits",
  "over a small library.",
  "All figures are MEDIANS. Never describe them as averages, and never claim a",
  "typical video performs like the best single post.",
  "Where the table lists limits, respect them — do not make a claim the sample",
  "size cannot carry, and set confidence to low when n is small.",
  "Three to five findings. Prefer the ones the team could act on.",
].join("\n");
