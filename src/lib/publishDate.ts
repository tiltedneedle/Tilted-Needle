import { OPERATING_TZ, operatingDate } from "@/lib/tz";

/**
 * Which day a post was published on — one answer, for every surface.
 *
 * THE BUG THIS EXISTS TO END. A post carries two date fields and they do not
 * agree. `posted_at_ts` is the real instant the platform recorded;
 * `posted_at` is a UTC DATE SLICE of it, written by the providers as
 * `timestamp.slice(0, 10)`. Slicing an instant in UTC answers "what day was
 * it in Greenwich", which is not the question anyone is asking — and on live
 * data 103 of 443 posts fall on a different operating-timezone day than their
 * own UTC slice, five of them across a MONTH boundary.
 *
 * So a screen filtering on `posted_at` and a report selecting on `posted_at_ts`
 * put the same video in different months, and both look correct. That is the
 * worst kind of disagreement: no error, no empty state, two confident numbers.
 *
 * Everything that shows, filters, sorts, groups or aggregates a post by date
 * calls this. Nothing slices a timestamp itself.
 *
 * THE FALLBACK, and its honest limit. Fourteen Instagram posts have a date but
 * no instant, because Apify returned no timestamp for them. For those the UTC
 * slice is all that exists, and it is used as-is: it may be a day early for a
 * post published late in the evening, and there is no way to know which. The
 * alternative — re-reading fourteen posts through a metered vendor at the
 * client's expense to recover a time of day nobody displays — is not worth it.
 * `precision` says which case a row is, so a caller that genuinely cannot
 * tolerate the ambiguity can see it rather than having to guess.
 */

export type PublishedOn = {
  /** YYYY-MM-DD in the operating timezone, or null if nothing is recorded. */
  day: string | null;
  /**
   * "instant" -- derived from the platform's own timestamp. Exact.
   * "date"    -- only a UTC date slice existed. May be a day out at the edges.
   * "none"    -- the post carries no publish date at all.
   */
  precision: "instant" | "date" | "none";
};

export function publishedOn(
  post: { postedAtTs?: string | null; postedAt?: string | null },
  tz: string = OPERATING_TZ,
): PublishedOn {
  const ts = post.postedAtTs;
  if (ts) {
    const d = new Date(ts);
    // A malformed timestamp must not become "Invalid Date" formatted into a
    // day string; fall through to the slice rather than inventing one.
    if (!Number.isNaN(d.getTime())) {
      return { day: operatingDate(d, tz), precision: "instant" };
    }
  }

  const slice = post.postedAt;
  if (slice && /^\d{4}-\d{2}-\d{2}/.test(slice)) {
    return { day: slice.slice(0, 10), precision: "date" };
  }

  return { day: null, precision: "none" };
}

/** Just the day, for the many callers that do not care how precise it is. */
export function publishedDay(
  post: { postedAtTs?: string | null; postedAt?: string | null },
  tz: string = OPERATING_TZ,
): string | null {
  return publishedOn(post, tz).day;
}

/**
 * Is this post's publish day inside an inclusive range?
 *
 * String comparison, deliberately: both sides are YYYY-MM-DD in the same zone
 * by the time they get here, and that ordering is lexicographic. Parsing them
 * back into Dates would reintroduce exactly the zone question this module
 * exists to settle.
 *
 * A post with no date is NOT in any range. It cannot be placed, and quietly
 * including it would put undated work into whichever month happened to be on
 * screen.
 */
export function publishedWithin(
  post: { postedAtTs?: string | null; postedAt?: string | null },
  range: { start: string; end: string },
  tz: string = OPERATING_TZ,
): boolean {
  const { day } = publishedOn(post, tz);
  if (!day) return false;
  return day >= range.start && day <= range.end;
}

/**
 * A content item's publish day, preferring its posts over its own column.
 *
 * `content_items.produced_at` agrees with the post on all 457 posted rows
 * today, so this is not a correction — it is a guarantee that they cannot
 * drift apart later. The post is the platform's record; produced_at is our
 * copy of it, and where both exist the platform wins.
 *
 * Items with no post fall back to produced_at, which for hand-added work is
 * whatever a person typed and is the only date there is.
 */
export function itemPublishedDay(
  item: { producedAt?: string | null },
  posts: { postedAtTs?: string | null; postedAt?: string | null }[],
  tz: string = OPERATING_TZ,
): string | null {
  // Earliest post wins: a cross-posted video was published when it FIRST went
  // out, not when the last platform got it.
  const days = posts.map((p) => publishedOn(p, tz).day).filter((d): d is string => !!d);
  if (days.length > 0) return days.sort()[0];
  const produced = item.producedAt;
  return produced && /^\d{4}-\d{2}-\d{2}/.test(produced) ? produced.slice(0, 10) : null;
}
