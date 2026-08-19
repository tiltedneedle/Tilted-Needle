/**
 * Building a monthly client report from what the system can actually prove.
 *
 * Pure and dependency-free, because every rule here was derived from two real
 * documents the owner has already sent to paying clients, and getting one
 * wrong means a wrong number in front of those clients. Testing that against a
 * database and a browser would be testing the wrong thing.
 *
 * The two hard-won rules, both verified against live data rather than assumed:
 *
 *   RANK BY GAIN, DISPLAY LIFETIME. A top-3 ranked by lifetime views gets
 *   position 3 wrong on both of Entree's platforms; ranked by views gained
 *   inside the period it reproduces the owner's published order exactly. The
 *   numbers PRINTED beside each row are still lifetime-at-period-end, because
 *   that is what the client sees on their own screen.
 *
 *   SELECT BY ACTIVITY, NOT PUBLICATION. Entree's number 3 on both platforms
 *   was published on 30 June -- outside the month the report covers. Filtering
 *   on publish date drops the video the report is partly about. The candidate
 *   set is every post with a reading inside the period, whenever it went out.
 */

/* ---- Inputs --------------------------------------------------------------- */

export type ReportPeriod = {
  /** Inclusive, in the workspace's operating timezone. */
  start: string;
  end: string;
};

export type ReportSnapshot = {
  /** ISO instant. */
  capturedAt: string;
  views: number | null;
};

export type ReportPost = {
  postId: string;
  contentItemId: string;
  platform: string;
  /** Reproduced verbatim in the report -- typos, curly quotes and all. */
  title: string;
  /**
   * The publish instant, NOT the `posted_at` date column.
   *
   * posted_at is a UTC date slice, and 103 of 443 live posts disagree with
   * the operating-timezone date of their own instant -- five of them across a
   * month boundary, two being the exact video the real report lists as its
   * number 3. Anything comparing publication to a period must use this.
   */
  postedAtTs: string | null;
  likes: number | null;
  snapshots: ReportSnapshot[];
};

export type TopVideo = {
  postId: string;
  contentItemId: string;
  platform: string;
  title: string;
  /** Lifetime, as at period end -- what the client saw on the closing day. */
  views: number;
  /**
   * Lifetime likes AS AT TODAY, not as at period end.
   *
   * A deliberate inconsistency with `views`, and the report must say so rather
   * than let a reader assume the two figures share a date. post_snapshots
   * stores only `views`, so there is no historical like count to read: the
   * only like figure that exists is the current one on
   * post_current_metrics.
   *
   * Measured against Entree's published July report, this is where the numbers
   * diverge most -- their TikTok number 1 printed 3,606 likes and the same
   * post reads 5,214 today, because it kept collecting them through August.
   * Views differ by 3-6% (a few days of drift); likes by 45%.
   *
   * Fixing it properly means adding `likes` to post_snapshots and waiting a
   * month for history. Until then the report footnotes the like column.
   */
  likes: number;
  /** What it earned inside the period. This is what the ranking used. */
  gained: number;
  /**
   * How solid the ranking is for this row.
   *
   * "measured"          -- readings on both sides of the period; the gain is
   *                        real and attributable to the period.
   * "lifetime"          -- no reading before the period, but the video went
   *                        out within days of it opening, so its lifetime
   *                        count is a tight enough bound to rank on.
   * "since-publication" -- published INSIDE the period, first measured after
   *                        it closed. The figure is everything the video has
   *                        earned since it went out, which starts inside the
   *                        period and runs past it. Not a period gain, and the
   *                        report says so rather than implying one.
   */
  basis: "measured" | "lifetime" | "since-publication";
};

/** A post that exists but cannot be placed in the ranking, and why. */
export type UnmeasurableVideo = {
  postId: string;
  platform: string;
  title: string;
  reason:
    | "no-reading-by-period-end"
    | "no-readings-at-all"
    | "published-before-history";
};

/**
 * How long before the period a video may have been published and still have
 * its lifetime count stand in for its period gain.
 *
 * With no reading from before the period there is no baseline, and lifetime is
 * not an estimate of the gain -- it is a different quantity that happens to be
 * an upper bound. For a video published the day before the period that bound
 * is tight enough to use; for one published weeks earlier it is meaningless.
 *
 * Three days, and the live data is what sets it. Entree's July report lists as
 * its number 3 a video published on 30 JUNE -- one day out -- and the report
 * is right to: essentially all of that video's life ran inside July. The same
 * account's 14 June Reel had reached 2.49M by then, and letting lifetime stand
 * in for it ranked June's viral post as July's best video, above every video
 * actually made that month. One day in, seventeen days out.
 */
const LIFETIME_FALLBACK_GRACE_DAYS = 3;

function daysBetween(aDay: string, bDay: string): number {
  return (Date.parse(`${bDay}T00:00:00Z`) - Date.parse(`${aDay}T00:00:00Z`)) / 86_400_000;
}

/* ---- Time ----------------------------------------------------------------- */

/**
 * Does this instant fall on or before the last day of the period?
 *
 * Compared as dates, not instants: the period ends on a DAY, and a reading at
 * 23:40 on that day is inside it.
 *
 * BOTH SIDES ARRIVE AS OPERATING-TIMEZONE DAYS -- and that is now true rather
 * than merely asserted. This comment previously claimed the caller resolved
 * them while the caller passed raw instants straight through, so the slice
 * below silently answered in UTC. Five live posts published between 20:00 and
 * 23:59 UTC on the last day of June are 1 July locally, and every one of them
 * was ranked into a JUNE report as a top video. buildClientReport now maps
 * both snapshot captures and publish instants through operatingDate() before
 * they get here.
 *
 * This file still never guesses a zone: it has none to guess with, which is
 * the point. A pure comparator cannot be wrong about a timezone it is not
 * given -- only about one it was told it had.
 */
function onOrBefore(iso: string, day: string): boolean {
  return iso.slice(0, 10) <= day;
}

function onOrAfter(iso: string, day: string): boolean {
  return iso.slice(0, 10) >= day;
}

/* ---- Top videos ----------------------------------------------------------- */

/**
 * The best videos of the period, and the ones that could not be judged.
 *
 * Returns both halves deliberately. A post published on the 30th whose first
 * reading lands in the next month is invisible to a gain ranking, and silently
 * dropping it is how the month's best video goes missing from the report --
 * so it comes back as `unmeasurable` for the preview to show.
 *
 * Cross-posts stay separate. The same video on TikTok and Instagram is two
 * rows with two platforms, never merged: they are two posts with two
 * audiences, and the whole app refuses to pool them.
 */
export function pickTopVideos(
  posts: ReportPost[],
  period: ReportPeriod,
  limit = 3,
): { top: TopVideo[]; unmeasurable: UnmeasurableVideo[] } {
  const ranked: TopVideo[] = [];
  const unmeasurable: UnmeasurableVideo[] = [];

  for (const p of posts) {
    const readings = p.snapshots
      .filter((s) => s.views != null)
      .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));

    if (readings.length === 0) {
      unmeasurable.push({
        postId: p.postId,
        platform: p.platform,
        title: p.title,
        reason: "no-readings-at-all",
      });
      continue;
    }

    const publishedInPeriodEarly =
      p.postedAtTs != null &&
      onOrAfter(p.postedAtTs, period.start) &&
      onOrBefore(p.postedAtTs, period.end);

    // The last reading at or before the period ends is what the client's own
    // screen showed them on the closing day.
    const atEnd = [...readings].reverse().find((s) => onOrBefore(s.capturedAt, period.end));
    if (!atEnd) {
      /**
       * No reading inside the period -- but if the video was PUBLISHED inside
       * it, we still know something real: its first reading is everything it
       * has earned since it went out, and it went out in this period.
       *
       * This is the difference between a useful report and an empty one. Our
       * snapshot history begins 2026-07-29, so for June every video failed
       * this test and the report came back blank -- while five videos with
       * 82k, 53k and 49k views sat in the database, published that month,
       * discarded. Dropping a real video because our measurement started late
       * tells the client nothing; showing it with the right label tells them
       * what happened.
       *
       * It is NOT a period gain and is never called one: the figure runs past
       * the period's end, and the basis travels with the row so the document
       * can say what it is.
       */
      if (publishedInPeriodEarly) {
        const first = readings[0];
        ranked.push({
          postId: p.postId,
          contentItemId: p.contentItemId,
          platform: p.platform,
          title: p.title,
          views: first.views ?? 0,
          likes: p.likes ?? 0,
          gained: first.views ?? 0,
          basis: "since-publication",
        });
        continue;
      }
      // Published before the period and first measured after it: nothing here
      // is attributable, and there is no honest number to print.
      unmeasurable.push({
        postId: p.postId,
        platform: p.platform,
        title: p.title,
        reason: "no-reading-by-period-end",
      });
      continue;
    }

    // The last reading strictly BEFORE the period opened is the baseline the
    // period's gain is measured from. A post published inside the period has
    // none, and its entire lifetime is the period's gain -- which is correct,
    // not a fallback.
    const priorReadings = readings.filter((s) => !onOrAfter(s.capturedAt, period.start));
    const publishedInPeriod =
      p.postedAtTs != null &&
      onOrAfter(p.postedAtTs, period.start) &&
      onOrBefore(p.postedAtTs, period.end);

    let gained: number;
    let basis: TopVideo["basis"];
    if (priorReadings.length > 0) {
      gained = (atEnd.views ?? 0) - (priorReadings[priorReadings.length - 1].views ?? 0);
      basis = "measured";
    } else if (publishedInPeriod) {
      // Nothing before the period because there was no video before the
      // period. Its whole count was earned inside.
      gained = atEnd.views ?? 0;
      basis = "measured";
    } else if (
      p.postedAtTs != null &&
      daysBetween(p.postedAtTs.slice(0, 10), period.start) <= LIFETIME_FALLBACK_GRACE_DAYS
    ) {
      // Published just before the period opened, so almost all of its life ran
      // inside. Lifetime is a tight enough bound to rank on, and says so.
      gained = atEnd.views ?? 0;
      basis = "lifetime";
    } else {
      /**
       * Published well before the period, with no reading from before it.
       *
       * There is no honest number here. Lifetime is not this video's period
       * gain, it is its whole history -- and ranking on it put a 2.49M-view
       * Reel from 14 June at the top of a July report, above every video the
       * month actually produced. Better to say we cannot measure it than to
       * assert a figure that is wrong by orders of magnitude.
       */
      unmeasurable.push({
        postId: p.postId,
        platform: p.platform,
        title: p.title,
        reason: "published-before-history",
      });
      continue;
    }

    ranked.push({
      postId: p.postId,
      contentItemId: p.contentItemId,
      platform: p.platform,
      title: p.title,
      views: atEnd.views ?? 0,
      likes: p.likes ?? 0,
      gained,
      basis,
    });
  }

  /**
   * Measured rows outrank estimated ones, then gain decides, then postId so
   * the same input never produces two different reports.
   *
   * The tier matters: a "since-publication" figure covers a longer window than
   * a measured gain, so mixing them in one ordering would let the weaker
   * evidence win on a bigger number. Where real measurements exist they fill
   * the list; the estimates only appear when there is room left, which in
   * practice means a period that predates our history entirely.
   */
  const tier = (t: TopVideo) => (t.basis === "since-publication" ? 1 : 0);
  ranked.sort(
    (a, b) => tier(a) - tier(b) || b.gained - a.gained || a.postId.localeCompare(b.postId),
  );
  return { top: ranked.slice(0, limit), unmeasurable };
}

/* ---- Refusals ------------------------------------------------------------- */

export type ReportBlocker = { code: string; message: string };

/**
 * Reasons not to generate this report yet.
 *
 * A blocker is not a warning. Each of these means the document would be
 * confidently wrong rather than merely thin, and the fix is named so the
 * answer is an action rather than a shrug.
 */
export function reportBlockers(input: {
  period: ReportPeriod;
  accounts: { handle: string; platform: string; lastDiscoveredAt: string | null }[];
  /** Confirmed metric rows found for this period, by account handle. */
  confirmedHandles: string[];
}): ReportBlocker[] {
  const out: ReportBlocker[] = [];

  for (const a of input.accounts) {
    /**
     * Discovery decides which posts EXIST; scraping only refreshes the ones
     * already known. So a stale discovery date does not make the numbers
     * wrong -- it makes videos missing, which is worse, because a report with
     * a video missing looks complete.
     */
    if (!a.lastDiscoveredAt) {
      out.push({
        code: "never-discovered",
        message: `@${a.handle} (${a.platform}) has never been discovered, so the report cannot know which videos exist. Run a sync for this account, then generate again.`,
      });
    } else if (!onOrAfter(a.lastDiscoveredAt, input.period.end)) {
      out.push({
        code: "stale-discovery",
        message: `@${a.handle} (${a.platform}) was last discovered ${a.lastDiscoveredAt.slice(0, 10)}, before the period ended (${input.period.end}). Videos posted after that date are not in the system yet. Run a sync, then generate again.`,
      });
    }
  }

  // A period with no confirmed numbers would render every audience figure as a
  // gap. That is honest, but it is not a report anyone would send.
  if (input.confirmedHandles.length === 0) {
    out.push({
      code: "no-confirmed-period",
      message:
        "No confirmed analytics have been entered for this period. Add the account figures and confirm them first — a draft is not published to a report.",
    });
  }

  return out;
}

/* ---- Narrative ------------------------------------------------------------ */

const N = (n: number) => n.toLocaleString("en-GB");

/**
 * The adjective ladder.
 *
 * The live reports reach for a word based on how the month moved -- "another
 * strong month", "exceptional performance", "strong performance". Keyed to a
 * measured delta so the word and the numbers can never disagree, which is the
 * failure that makes generated prose obviously generated: "exceptional" above
 * a 4% decline.
 *
 * With no prior period there is no delta, so the language stays flat and
 * factual rather than borrowing enthusiasm it cannot support.
 */
function ladder(deltaPct: number | null): string {
  if (deltaPct == null) return "steady";
  if (deltaPct >= 100) return "exceptional";
  if (deltaPct >= 25) return "strong";
  if (deltaPct >= 5) return "improved";
  if (deltaPct > -5) return "consistent";
  if (deltaPct > -25) return "softer";
  return "notably quieter";
}

export type PlatformNarrativeInput = {
  platformLabel: string;
  views: number | null;
  likes: number | null;
  /** Period flow, not a total. The live report mislabels this; we do not. */
  netFollowers: number | null;
  followerNoun: "followers" | "subscribers";
  /** Percentage change in views against the prior period, or null if none. */
  viewsDeltaPct: number | null;
};

/**
 * The per-platform paragraph, in the shape the live reports already use.
 *
 * Formulaic by design: across three platform pages the sentence skeleton is
 * identical and only the name and the numbers change, so a template reproduces
 * it exactly rather than approximating it.
 *
 * What it will NOT do is write the filler. The live Shorts page, with no
 * editorial input behind it, falls back to sentences that carry no
 * information; generating those would be manufacturing the appearance of
 * analysis. A slot with nothing to say is left for a person, or left out.
 *
 * Every clause is conditional on its number existing. A null is a gap in what
 * we know, and the sentence simply does not make that claim -- it never
 * becomes "0 views", which is a different and false statement.
 */
export function platformNarrative(input: PlatformNarrativeInput): string {
  const { platformLabel, views, likes, netFollowers, followerNoun } = input;
  const adjective = ladder(input.viewsDeltaPct);

  const clauses: string[] = [];
  if (views != null) clauses.push(`generating ${N(views)} views`);
  if (netFollowers != null && netFollowers !== 0) {
    clauses.push(
      netFollowers > 0
        ? `gaining ${N(netFollowers)} new ${followerNoun}`
        : `losing ${N(Math.abs(netFollowers))} ${followerNoun}`,
    );
  }
  if (likes != null) clauses.push(`receiving ${N(likes)} likes`);

  if (clauses.length === 0) {
    // Nothing measured. Say that, rather than producing a sentence whose
    // shape implies numbers that are not there.
    return `No ${platformLabel} figures were recorded for this period.`;
  }

  // Two clauses join with a bare "and"; three or more take the serial comma,
  // which is what the live reports print ("generating X views, gaining Y new
  // followers, and receiving Z likes"). Getting this wrong produces
  // "X views, and Y likes", which reads as a typo and undermines every real
  // number beside it.
  const list =
    clauses.length === 1
      ? clauses[0]
      : clauses.length === 2
        ? `${clauses[0]} and ${clauses[1]}`
        : `${clauses.slice(0, -1).join(", ")}, and ${clauses[clauses.length - 1]}`;

  return `${platformLabel} delivered ${adjective} performance this month, ${list}.`;
}

/**
 * Percentage change, or null when the comparison cannot be made.
 *
 * Null rather than zero for a missing prior, and null rather than Infinity
 * when the prior was zero: "+∞%" and "+0%" are both claims about a comparison
 * that did not happen. The report renders a null delta as absent.
 */
export function deltaPct(current: number | null, prior: number | null): number | null {
  if (current == null || prior == null || prior === 0) return null;
  return ((current - prior) / prior) * 100;
}

/* ---- Measured from what we track ------------------------------------------ */

export type MeasuredTotals = {
  /** Views the account's videos gained INSIDE the period. */
  viewsGained: number | null;
  /** Likes and comments now, across videos active in the period. */
  likes: number | null;
  comments: number | null;
  /** Videos published inside the period. */
  published: number;
  /** Videos with enough readings to contribute a measured gain. */
  measured: number;
  /** Best single video's gain, for the narrative. */
  bestGain: number | null;
};

/**
 * What the system can state about a platform WITHOUT anyone typing anything.
 *
 * The report was leaning entirely on account_metrics -- figures a person
 * transcribes from the platform's own dashboard -- so a client with no entry
 * got a document with no numbers, however many videos we had been measuring
 * for them all month. That is the wrong default: snapshots are the thing this
 * system does automatically, and they can answer most of what a monthly report
 * asks.
 *
 * WHAT THIS IS NOT. It is not the platform's own figure and must never be
 * presented as one. The platform counts views on the whole account, including
 * posts we do not track and formats we never see -- Stories, lives, images. So
 * this is "the videos we track, measured", it is a floor rather than a total,
 * and the document labels it that way. When a real reported figure exists it
 * wins, every time.
 *
 * Views are GAINED-IN-PERIOD, summed across the account's own videos. That is
 * legitimate addition: same platform, same unit, different videos. It is the
 * one place summing is honest, and the rule the whole app follows -- never
 * across platforms -- is untouched.
 */
export function measurePlatform(posts: ReportPost[], period: ReportPeriod): MeasuredTotals {
  const { top } = pickTopVideos(posts, period, Number.MAX_SAFE_INTEGER);

  // Only rows whose gain is attributable to the period. A "since-publication"
  // figure runs past the period end, so adding it to a period total would
  // quietly inflate the month with next month's views.
  const attributable = top.filter((t) => t.basis === "measured");

  const published = posts.filter(
    (p) =>
      p.postedAtTs != null &&
      p.postedAtTs.slice(0, 10) >= period.start &&
      p.postedAtTs.slice(0, 10) <= period.end,
  ).length;

  const sum = (pick: (t: TopVideo) => number | null): number | null => {
    const vals = attributable.map(pick).filter((n): n is number => n != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };

  return {
    viewsGained: sum((t) => t.gained),
    likes: sum((t) => t.likes),
    comments: null,
    published,
    measured: attributable.length,
    bestGain: attributable.length ? Math.max(...attributable.map((t) => t.gained)) : null,
  };
}
