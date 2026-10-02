/**
 * How long one sync request may keep starting work, and what it reads first
 * when it cannot read everything. Kept dependency-free so it can be tested
 * directly under Node's native loader (no "@/" path aliases, which only Next's
 * bundler resolves) -- see discoveryThrottle.ts for the same pattern.
 *
 * WHY A CLOCK, WHEN THE REQUEST IS ALREADY CAPPED AT FOUR ACCOUNTS
 *
 * A count of accounts bounds the work; it says nothing about how long the work
 * takes, and that is not ours to decide. TikTok is read one video per request,
 * so a batch costs (videos tracked) x (however long TikTok takes to answer),
 * and the first number only ever grows.
 *
 * Measured from the scheduled runs: until 24 September a four-account TikTok
 * request took 45-60 seconds. From that evening, with nothing deployed, 13 of
 * the next 27 runs took 160-285 seconds for the same four accounts, and in
 * nine of them a request died at the 300-second limit with a 504 -- which
 * failed the job, mailed an alert, and left the accounts behind it unsynced
 * until the following run. Asked directly on 2 October, TikTok's embed
 * endpoint answered 16 of 30 requests with "503 overload-protect triggered",
 * and the ones it did serve took a median of 0.9 seconds and as long as 8.
 *
 * No batch size survives that. Four accounts that fit when a video takes half
 * a second do not fit when it takes two and a half, and a size that fits
 * today stops fitting as the library grows. So the request is bounded by the
 * thing that actually kills it: once the budget is spent nothing new starts,
 * what was read is kept, and the caller is told how much is left so it can
 * ask again.
 */

/**
 * After this long, a sync request starts nothing new.
 *
 * 180 of the route's 300 seconds. The other 120 are for whatever is already
 * in flight when the budget runs out, and that is deliberately generous:
 * TikTok's loop stops within one request (ten seconds), but a YouTube or
 * Instagram account cannot be interrupted halfway, and one of those has been
 * seen to take most of a minute on its own.
 */
export const SYNC_BUDGET_MS = 180_000;

export type ReadCandidate = {
  externalId: string;
  /** platform_posts.last_scraped_at; null or absent when never read. */
  lastScrapedAt?: string | null;
};

/**
 * The posts to read for one account, in the order to read them.
 *
 * STALEST FIRST, for the same reason accounts are ordered that way: when a
 * read is cut short -- by the budget, or by the platform refusing some of the
 * requests -- the posts that missed out are exactly the ones the next read
 * starts with. In a fixed order the tail of a large account would be the part
 * that is cut every single time.
 *
 * `staleBefore` is the instant the caller's pass began. Anything read since
 * then is left out, which is what lets a second request RESUME an account the
 * first one ran out of time on, rather than start it again from the top and
 * run out at the same place.
 *
 * Ties keep the order they arrived in, so before any post has a stamp this is
 * the order the sync has always used.
 */
export function readOrder(posts: ReadCandidate[], staleBefore?: string): string[] {
  const pin = staleBefore ? Date.parse(staleBefore) : NaN;
  return posts
    .map((p, index) => ({
      id: p.externalId,
      at: p.lastScrapedAt ? Date.parse(p.lastScrapedAt) : NaN,
      index,
    }))
    // An unreadable pin or stamp must never hide a post: NaN fails every
    // comparison, so each is tested for explicitly and read as "not yet".
    .filter((p) => Number.isNaN(pin) || Number.isNaN(p.at) || p.at < pin)
    .sort((a, b) => {
      const aNever = Number.isNaN(a.at);
      const bNever = Number.isNaN(b.at);
      if (aNever !== bNever) return aNever ? -1 : 1;
      if (!aNever && a.at !== b.at) return a.at - b.at;
      return a.index - b.index;
    })
    .map((p) => p.id);
}

/**
 * How many accounts a pass still has to visit once this request is done.
 *
 * `eligible` is counted BEFORE the request took its batch, so it shrinks from
 * one request to the next as accounts are finished. The scheduled workflow
 * used to divide it by the batch size to work out how many requests a whole
 * pass needs, and compared that against the number of requests made so far --
 * measuring the remainder against a count from the start. For nine accounts
 * that reads "three requests" on the first and "two" on the second, so it
 * stopped after two and the ninth account was left out of every run.
 *
 * Reported by the route so the caller does not have to derive it: everything
 * not attempted, plus anything attempted and cut short.
 */
export function accountsRemaining(eligible: number, results: { partial?: boolean }[]): number {
  const cutShort = results.filter((r) => r.partial).length;
  return Math.max(0, eligible - results.length + cutShort);
}
