/**
 * Where a poster frame comes from, per platform, for free.
 *
 * Discovery fills these in for new posts on the platforms whose discovery
 * response happens to carry one (YouTube's snippet, Instagram's displayUrl).
 * That leaves two gaps a self-running system cannot have:
 *
 *   - TikTok's discovery carries no image at all, so every TikTok post would
 *     arrive without one, forever.
 *   - Anything that existed before the column did, or that arrived through a
 *     path that did not set it.
 *
 * So the sync fills gaps itself on every run, using only routes that cost
 * nothing. Nothing here spends metered credit and nothing here needs a key.
 *
 * WHAT IS NOT SOLVED HERE. These URLs rot. Instagram's and TikTok's are
 * signed and will eventually stop resolving, and this fills a MISSING
 * thumbnail rather than replacing a dead one -- we do not store when a URL was
 * fetched, so there is nothing to age it against. The tile already degrades to
 * a neutral box when an image fails, so the failure is cosmetic and quiet
 * rather than broken. Refreshing on expiry would need a fetched-at column and
 * a re-check budget; it is a real piece of work, not an oversight.
 */

/** How many gaps one sync run will try to close for a single account. */
export const THUMBNAIL_FILL_CAP = 25;

/**
 * YouTube needs no request at all: the URL is a pure function of the video id.
 * mqdefault (320x180) exists for every video ever uploaded; maxres does not,
 * and asking for a missing one returns a placeholder image rather than an
 * error -- which would look like a broken thumbnail while reporting success.
 */
export function youtubeThumbnail(externalId: string): string | null {
  return /^[A-Za-z0-9_-]{11}$/.test(externalId)
    ? `https://i.ytimg.com/vi/${externalId}/mqdefault.jpg`
    : null;
}

/**
 * TikTok publishes a keyless oEmbed endpoint that returns thumbnail_url.
 * One real request per video, so callers pace it: this is a courtesy from an
 * endpoint nobody is obliged to give us, and hammering it is how a free route
 * stops being free.
 */
export async function tiktokThumbnail(
  externalId: string,
  handle: string | null,
  url: string | null,
): Promise<string | null> {
  const target =
    url ?? `https://www.tiktok.com/@${(handle ?? "").replace(/^@/, "")}/video/${externalId}`;
  try {
    const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(target)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { thumbnail_url?: string };
    return body?.thumbnail_url ?? null;
  } catch {
    // A missing thumbnail is cosmetic. Never let it fail a sync.
    return null;
  }
}

/**
 * The free poster frame for one post, or null when this platform has no free
 * route. Instagram returns null on purpose: its only source is the metered
 * discovery response, which already sets the column when it runs, and paying
 * Apify to decorate a row is not a trade worth making.
 */
export async function freeThumbnailFor(
  platformSlug: string,
  externalId: string,
  handle: string | null,
  url: string | null,
): Promise<string | null> {
  if (platformSlug === "youtube" || platformSlug === "youtube_shorts") {
    return youtubeThumbnail(externalId);
  }
  if (platformSlug === "tiktok") return tiktokThumbnail(externalId, handle, url);
  return null;
}
