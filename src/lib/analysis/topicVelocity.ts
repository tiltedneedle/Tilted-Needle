/**
 * Which topics are gaining, and which are quietly dying.
 *
 * WHY topic_labels AND NOT THE OTHER TWO TOPIC FIELDS. Three columns in this
 * database could plausibly answer "what is this video about", and only one of
 * them can carry a trend:
 *
 *   video_descriptors.topic   132 distinct values across 140 rows. A model
 *                             writes a fresh sentence per video ("data-driven
 *                             excellence in corporate jet sales"), so nearly
 *                             every bucket has n=1 and no bucket has a history.
 *   merged_themes.label       139 distinct across 144 rows. Same shape, and
 *                             it describes COMMENTS rather than the video.
 *   content_items.topic_labels  17 distinct labels over 340 assignments --
 *                             Lifestyle 130, Health 99, Vehicle 29. A real
 *                             controlled vocabulary, reused across months.
 *
 * A velocity needs the same bucket to exist in two time windows. Only the
 * third column gives you that, so it is the only honest input here.
 *
 * OUTPUT IS A SHARE, NOT A COUNT, AND THAT CORRECTION IS THE WHOLE MODULE.
 *
 * The first version divided raw counts and reported "Lifestyle 13.86x rising".
 * It was measuring nothing of the sort. Measured on this corpus: 467 videos
 * went out in the recent 90 days against 30 in the prior 90 -- a 15.6x
 * workspace-wide surge -- so EVERY topic's raw ratio simply re-reported that
 * surge, and a topic actually losing ground would still have printed a large
 * rising number. Tagging coverage compounds it from the other side: 37% of
 * recent videos carry topic_labels against 57% of the prior window, so the
 * two counts are not even drawn from comparable samples.
 *
 * Dividing shares fixes both at once. Numerator and denominator come from the
 * same window and the same tagged population, so the surge and the coverage
 * gap cancel, and what survives is the only honest question: is this topic
 * taking up MORE OF THE SLATE than it used to. Lifestyle at 56% of tagged
 * recent output against 41% before is a real editorial shift of 1.37x, and
 * that is a different claim from 13.86x in every way that matters.
 *
 * The workspace-wide change is returned separately as context rather than
 * hidden, because "we made 15x more video" is itself the headline on a page
 * about what changed.
 *
 * TWO VELOCITIES, DELIBERATELY NOT COMBINED.
 *
 *   OUTPUT   what share of the slate this topic took. An agency DECISION.
 *   TRACTION how those videos performed, as a median index. An AUDIENCE
 *            response. Rising traction means people watched more.
 *
 * Averaging them into one "velocity" score would destroy the single most
 * useful reading this table produces: output up, traction down. That is a
 * team leaning harder into something the audience is tiring of, and it is
 * invisible in any blended number. They are reported side by side and never
 * summed.
 *
 * A topic in only one window has no velocity, and gets said so in words --
 * "new" or "dropped" -- rather than a ratio against zero.
 */

export const TOPIC_VELOCITY_VERSION = 1;

/** Each window is this many days. Recent = [now-90, now); prior = the 90 before. */
export const WINDOW_DAYS = 90;

/**
 * Below this a window's number is not stated.
 *
 * Lower than the hook floor of 8 on purpose, and the reason is what the two
 * numbers are for. A hook ratio invites "use this hook"; a topic trend invites
 * "look at this topic". The first is a recommendation and needs the engine's
 * floor, the second is a pointer at something a human will then go and read.
 * Below 4 even a pointer is noise, so that is where it stops.
 */
export const MIN_PER_WINDOW = 4;

export type TopicVideo = {
  topicLabels: string[] | null;
  /** When it went out. Videos with no date cannot be placed in a window. */
  postedAt: Date | null;
  /** perfIndex against the account's own baseline, or null if unscored. */
  index: number | null;
};

export type TopicTrend = {
  topic: string;
  /** Videos posted in each window (scored or not — this is output). */
  recentCount: number;
  priorCount: number;
  /** This topic's share of all TAGGED output in each window, 0..1. */
  recentShare: number | null;
  priorShare: number | null;
  /** Median index in each window, over the SCORED subset only. */
  recentMedian: number | null;
  priorMedian: number | null;
  /**
   * recentShare / priorShare — how much more of the slate this topic takes.
   * NOT a ratio of counts: see the module header for the 15.6x surge that
   * made raw counts report every topic as rising.
   */
  outputRatio: number | null;
  /** recentMedian / priorMedian. Null unless both windows clear the floor. */
  tractionRatio: number | null;
  status: "rising" | "falling" | "steady" | "new" | "dropped" | "thin";
  /** True when either window is below MIN_PER_WINDOW. */
  underpowered: boolean;
};

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * The band inside which a ratio is called steady.
 *
 * Same [0.87, 1.15] the client evidence UI uses for "no real difference".
 * Reusing it is the point: two surfaces calling the same ratio "flat" and
 * "rising" would be the system contradicting itself in front of a client.
 */
const STEADY_LO = 0.87;
const STEADY_HI = 1.15;

/** What changed workspace-wide, so a per-topic shift is read against it. */
export type TopicContext = {
  /** Videos carrying at least one label, per window. The share denominator. */
  recentTagged: number;
  priorTagged: number;
  /** Every video in the window, tagged or not. */
  recentTotal: number;
  priorTotal: number;
  /** recentTotal / priorTotal — the surge that raw counts mistook for trend. */
  volumeRatio: number | null;
  /** Share of output carrying any label. Divergence here biases everything. */
  recentCoverage: number | null;
  priorCoverage: number | null;
};

export function topicTrends(
  videos: TopicVideo[],
  now: Date = new Date(),
  windowDays: number = WINDOW_DAYS,
): { trends: TopicTrend[]; context: TopicContext } {
  const msWindow = windowDays * 86_400_000;
  const recentFrom = now.getTime() - msWindow;
  const priorFrom = recentFrom - msWindow;

  type Bucket = { recent: TopicVideo[]; prior: TopicVideo[] };
  const byTopic = new Map<string, Bucket>();
  const tagged = { recent: 0, prior: 0 };
  const total = { recent: 0, prior: 0 };

  for (const v of videos) {
    if (!v.postedAt) continue;                       // cannot be placed in time
    const t = v.postedAt.getTime();
    const where = t >= recentFrom && t < now.getTime()
      ? "recent"
      : t >= priorFrom && t < recentFrom
        ? "prior"
        : null;
    if (!where) continue;                            // outside both windows

    total[where]++;

    const labels = (v.topicLabels ?? [])
      .map((raw) => String(raw ?? "").trim())
      .filter(Boolean);
    if (labels.length) tagged[where]++;

    // A video carries several labels and counts under each. It is genuinely
    // about all of them, and forcing a primary would be a coin flip that
    // changes the answer. Note this makes the shares sum to MORE than 1 when
    // videos are multi-labelled -- which is correct: they are shares of
    // videos, not slices of a pie, and normalising them to sum to 1 would
    // shrink a topic because unrelated videos gained a second label.
    for (const topic of new Set(labels)) {
      if (!byTopic.has(topic)) byTopic.set(topic, { recent: [], prior: [] });
      byTopic.get(topic)![where].push(v);
    }
  }

  const context: TopicContext = {
    recentTagged: tagged.recent,
    priorTagged: tagged.prior,
    recentTotal: total.recent,
    priorTotal: total.prior,
    volumeRatio: total.prior > 0 ? total.recent / total.prior : null,
    recentCoverage: total.recent > 0 ? tagged.recent / total.recent : null,
    priorCoverage: total.prior > 0 ? tagged.prior / total.prior : null,
  };

  const out: TopicTrend[] = [];
  for (const [topic, b] of byTopic) {
    const recentCount = b.recent.length;
    const priorCount = b.prior.length;
    const recentIdx = b.recent.map((v) => v.index).filter((n): n is number => n != null && n > 0);
    const priorIdx = b.prior.map((v) => v.index).filter((n): n is number => n != null && n > 0);
    const recentMedian = median(recentIdx);
    const priorMedian = median(priorIdx);

    const underpowered = recentCount < MIN_PER_WINDOW || priorCount < MIN_PER_WINDOW;

    // Share of the TAGGED slate — the denominator that makes the two windows
    // comparable when both the volume and the tagging rate have moved.
    const recentShare = tagged.recent > 0 ? recentCount / tagged.recent : null;
    const priorShare = tagged.prior > 0 ? priorCount / tagged.prior : null;

    let status: TopicTrend["status"];
    let outputRatio: number | null = null;
    if (priorCount === 0 && recentCount > 0) {
      status = "new";
    } else if (recentCount === 0 && priorCount > 0) {
      status = "dropped";
    } else {
      outputRatio =
        recentShare != null && priorShare != null && priorShare > 0
          ? recentShare / priorShare
          : null;
      if (underpowered || outputRatio == null) status = "thin";
      else if (outputRatio > STEADY_HI) status = "rising";
      else if (outputRatio < STEADY_LO) status = "falling";
      else status = "steady";
    }

    // Traction needs BOTH windows scored above the floor. A median resting on
    // two videos is not a trend, and pairing it with a confident-looking
    // output ratio is how a thin number gets read as a solid one.
    const tractionRatio =
      recentMedian != null && priorMedian != null && priorMedian > 0
        && recentIdx.length >= MIN_PER_WINDOW && priorIdx.length >= MIN_PER_WINDOW
        ? recentMedian / priorMedian
        : null;

    out.push({
      topic, recentCount, priorCount, recentShare, priorShare,
      recentMedian, priorMedian, outputRatio, tractionRatio, status,
      underpowered,
    });
  }

  /* Ordering encodes what is worth looking at first, and the top of this list
     is deliberately not "biggest number". A topic whose output is climbing
     while its traction falls is the finding a team cannot see any other way,
     so it sorts above everything, including larger movements in agreement. */
  const diverging = (t: TopicTrend) =>
    t.tractionRatio != null && t.outputRatio != null
    && t.outputRatio > STEADY_HI && t.tractionRatio < STEADY_LO;

  const trends = out.sort((a, b) => {
    if (diverging(a) !== diverging(b)) return diverging(a) ? -1 : 1;
    if (a.underpowered !== b.underpowered) return a.underpowered ? 1 : -1;
    const av = Math.abs(Math.log(a.tractionRatio ?? a.outputRatio ?? 1));
    const bv = Math.abs(Math.log(b.tractionRatio ?? b.outputRatio ?? 1));
    return bv - av;
  });

  return { trends, context };
}
