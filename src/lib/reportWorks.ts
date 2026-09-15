/**
 * What works, for the client report: which lengths and which days reach.
 *
 * The document said how each channel did and what the audience said, and
 * nothing about what to do more of. The system already holds the two levers
 * a client controls before a video goes out -- how long it is and when it is
 * posted -- and, since the yt-dlp box began filling `length_seconds`, holds
 * them for TikTok and Instagram as well as YouTube.
 *
 * MEASURED THE WAY THE APP MEASURES. Raw views would make every comparison a
 * comparison of channel size and video age, so each video is read as the
 * app's performance index: its views at the platform's maturity window over
 * the median of the ten videos this account published before it
 * (scoring.ts). "1.4x" means 1.4 times this channel's own norm at the time,
 * on every platform, which is what makes the bars on one page comparable.
 * Platforms are never pooled: a bucket is per account per platform.
 *
 * A BUCKET IS SHOWN ONLY WITH EIGHT VIDEOS IN IT. The same floor the app's
 * video attribution uses before it will rank a side (videoAttribution.ts
 * MIN_SIDE), and for the same reason: a median of two is one of the two. An
 * axis is a comparison, so it needs two buckets over the floor; a platform
 * needs one such axis; the page needs two such axes between its platforms.
 * A client never receives a page whose content is a note about how few
 * videos we could score.
 *
 * Posting day is weekday against weekend rather than seven days: with a
 * floor of eight per bucket, seven buckets cleared it on two accounts in the
 * whole workspace and two buckets clear it on most. It is also the question
 * clients actually ask.
 *
 * Pure. The builder feeds it posts; the document draws what comes back.
 */
import { scoreAccountPosts, median, type Snapshot } from "@/lib/scoring";

export type WorksPost = {
  postId: string;
  /** Reproduced verbatim when the video is cited as an example. */
  title: string;
  lengthSeconds: number | null;
  /** The publish instant, for scoring order and maturity. */
  postedAt: Date;
  /** The publish DAY in operating time (YYYY-MM-DD), for the weekday. */
  postedDay: string | null;
  snapshots: Snapshot[];
};

export type WorksBucket = {
  key: string;
  label: string;
  /** Scored videos in the bucket. */
  n: number;
  /** Median performance index; null while n is under the floor. */
  index: number | null;
};

export type WorksAxis = {
  key: "length" | "weekend";
  title: string;
  buckets: WorksBucket[];
  /** Two or more buckets over the floor: the axis can be read. */
  shown: boolean;
  /** One sentence, only when the axis is shown. */
  finding: string | null;
  /** best / worst among shown buckets; 1 when nothing separates them. */
  spread: number;
  /**
   * The strongest videos in the best bucket, when the axis has a real
   * spread: the finding with its evidence, so "over 90 seconds reached 3.9x"
   * comes with the three videos that made it true.
   */
  examples: WorksExample[];
};

export type WorksExample = { postId: string; title: string; index: number };
export const MAX_EXAMPLES = 3;

export type PlatformWorks = {
  platform: string;
  platformLabel: string;
  /** Videos with a performance index on this account. */
  scored: number;
  axes: WorksAxis[];
};

/** Videos a bucket needs before its median is shown. Same floor as videoAttribution.ts. */
export const MIN_BUCKET = 8;
/** Below this ratio between the best and worst bucket, the honest sentence is "no clear difference". */
export const MIN_SPREAD = 1.25;

const LENGTH_BUCKETS: { key: string; label: string; phrase: string; max: number }[] = [
  { key: "le30", label: "Under 30s", phrase: "under 30 seconds", max: 30 },
  { key: "le60", label: "30–60s", phrase: "30 to 60 seconds", max: 60 },
  { key: "le90", label: "60–90s", phrase: "60 to 90 seconds", max: 90 },
  { key: "gt90", label: "Over 90s", phrase: "over 90 seconds", max: Infinity },
];

const DAY_BUCKETS: { key: string; label: string; phrase: string }[] = [
  { key: "weekday", label: "Mon–Fri", phrase: "on weekdays" },
  { key: "weekend", label: "Sat–Sun", phrase: "at the weekend" },
];

export function lengthBucket(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  return LENGTH_BUCKETS.find((b) => seconds <= b.max)!.key;
}

export function dayBucket(day: string | null): string | null {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6 ? "weekend" : "weekday";
}

export function formatIndex(x: number): string {
  return `${x >= 10 ? Math.round(x) : x.toFixed(1)}×`;
}

type Scored = { postId: string; title: string; index: number };

function buildAxis(
  key: WorksAxis["key"],
  title: string,
  defs: { key: string; label: string; phrase: string }[],
  byBucket: Map<string, Scored[]>,
  noun: string,
): WorksAxis {
  const buckets: WorksBucket[] = defs.map((d) => {
    const xs = byBucket.get(d.key) ?? [];
    return { key: d.key, label: d.label, n: xs.length, index: xs.length >= MIN_BUCKET ? median(xs.map((x) => x.index)) : null };
  });
  const shownBuckets = buckets.filter((b) => b.index != null);
  const shown = shownBuckets.length >= 2;
  if (!shown) return { key, title, buckets, shown, finding: null, spread: 1, examples: [] };

  const best = shownBuckets.reduce((a, b) => (b.index! > a.index! ? b : a));
  const worst = shownBuckets.reduce((a, b) => (b.index! < a.index! ? b : a));
  const spread = worst.index! > 0 ? best.index! / worst.index! : Infinity;
  const phrase = (b: WorksBucket) => defs.find((d) => d.key === b.key)!.phrase;
  const real = spread >= MIN_SPREAD;
  const finding = real
    ? `videos ${phrase(best)} reached ${formatIndex(best.index!)} this channel's norm; ${phrase(worst)}, ${formatIndex(worst.index!)}.`
    : `${noun.toLowerCase()} made no clear difference: every bucket landed within ${Math.round((spread - 1) * 100)}% of the others.`;
  const examples = real
    ? [...(byBucket.get(best.key) ?? [])]
        // A video nobody titled is evidence the reader cannot check.
        .filter((x) => x.title.trim() && !/^untitled$/i.test(x.title.trim()))
        .sort((a, b) => b.index - a.index || a.postId.localeCompare(b.postId))
        .slice(0, MAX_EXAMPLES)
        .map(({ postId, title, index }) => ({ postId, title, index }))
    : [];
  return { key, title, buckets, shown, finding, spread, examples };
}

/**
 * One platform's account: score every post against the account's own history,
 * then bucket the indexes by length and by posting day.
 */
export function platformWorks(input: {
  platform: string;
  platformLabel: string;
  posts: WorksPost[];
  windowDays: number;
  now?: Date;
}): PlatformWorks {
  const scored = scoreAccountPosts(
    input.posts.map((p) => ({
      postId: p.postId,
      accountId: input.platform,
      platform: input.platform,
      postedAt: p.postedAt,
      snapshots: p.snapshots,
    })),
    input.windowDays,
    input.now,
  );
  const meta = new Map(input.posts.map((p) => [p.postId, p]));
  const byLength = new Map<string, Scored[]>();
  const byDay = new Map<string, Scored[]>();
  for (const s of scored) {
    const p = meta.get(s.postId);
    if (!p) continue;
    const row: Scored = { postId: p.postId, title: p.title, index: s.index };
    const l = lengthBucket(p.lengthSeconds);
    if (l) byLength.set(l, [...(byLength.get(l) ?? []), row]);
    const d = dayBucket(p.postedDay);
    if (d) byDay.set(d, [...(byDay.get(d) ?? []), row]);
  }
  return {
    platform: input.platform,
    platformLabel: input.platformLabel,
    scored: scored.length,
    axes: [
      buildAxis("length", "By video length", LENGTH_BUCKETS, byLength, "Length"),
      buildAxis("weekend", "By posting day", DAY_BUCKETS, byDay, "Posting day"),
    ],
  };
}

/** Platforms with at least one readable axis -- what the page draws. */
export function drawableWorks(works: PlatformWorks[]): PlatformWorks[] {
  return works.filter((w) => w.axes.some((a) => a.shown));
}

/** Readable axes a report needs before it gets a works page. */
export const MIN_AXES_FOR_PAGE = 2;

/**
 * Whether the page is drawn at all. One readable axis is two bars and a
 * sentence on an otherwise empty sheet -- rendered, it was 55% blank -- and
 * the document's rule is that a sheet is either worth a page or not there.
 * Two readable axes, on one platform or across two, fill it.
 */
export function worksPageShown(works: PlatformWorks[]): boolean {
  return works.reduce((n, w) => n + w.axes.filter((a) => a.shown).length, 0) >= MIN_AXES_FOR_PAGE;
}

/** A finding as a sentence of its own: capitalised. */
export function sentence(finding: string): string {
  return finding.charAt(0).toUpperCase() + finding.slice(1);
}

/**
 * The sentence the page opens with: the widest real spread anywhere, or the
 * honest negative when every readable axis is flat.
 */
export function worksLead(works: PlatformWorks[]): string {
  let best: { w: PlatformWorks; a: WorksAxis } | null = null;
  const drawable = drawableWorks(works);
  for (const w of drawable) {
    for (const a of w.axes) {
      if (!a.shown || a.spread < MIN_SPREAD) continue;
      if (!best || a.spread > best.a.spread) best = { w, a };
    }
  }
  if (best) return `On ${best.w.platformLabel}, ${best.a.finding}`;
  if (drawable.length === 0) return "Not enough scored videos to compare yet.";
  /* Flat everywhere. Named for what was actually read: a page that read only
     length must not say posting day made no difference. */
  const read = new Set(drawable.flatMap((w) => w.axes.filter((a) => a.shown).map((a) => a.key)));
  const names = [read.has("length") ? "video length" : null, read.has("weekend") ? "posting day" : null].filter((x): x is string => !!x);
  const platforms = drawable.map((w) => w.platformLabel);
  const list = (xs: string[], joiner: string) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${joiner} ${xs[xs.length - 1]}`);
  return `${sentence(list(names, "and"))} made no clear difference to reach on ${list(platforms, "or")}.`;
}
