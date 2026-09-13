/**
 * Which platform slugs behave like YouTube to this worker.
 *
 * YouTube Shorts is a separate PLATFORM because its views are a different
 * unit -- counted on impression rather than after ~30 seconds watched -- and
 * pooling the two would be the category error the whole per-platform model
 * exists to prevent.
 *
 * But it is the same VIDEO SERVICE. A Short has captions like any other
 * YouTube video, has comments like any other YouTube video, and its id has
 * the same shape, so every route in this worker that reconstructs a
 * youtube.com URL or calls the Data API works on it unchanged.
 *
 * This constant exists so that distinction lives in ONE place. Five separate
 * `slug === "youtube"` checks were what stood between Shorts and silently
 * getting no transcripts and no comments -- each of them individually
 * reasonable, and collectively a feature that half worked.
 */
export const YOUTUBE_LIKE = ["youtube", "youtube_shorts"];

/** True when this slug can be read through YouTube's own routes. */
export function isYouTubeLike(slug) {
  return YOUTUBE_LIKE.includes(slug);
}

/**
 * Which platforms THIS HOST is allowed to fetch from, or null for any.
 *
 * The transcript kinds are split by IP reputation, and so are the hosts that
 * run them. Measured 2026-09-13 from the Oracle Phoenix box: TikTok serves
 * metadata, captions and audio; Instagram serves audio; YouTube refuses every
 * request with "Sign in to confirm you're not a bot" -- the same answer the
 * Singapore box got against seven client variants, a PO-token provider and
 * a cookie jar. A datacenter address does not get YouTube.
 *
 * Letting such a host CLAIM a YouTube job is worse than useless: the first
 * bot challenge cools the whole kind for two hours and stalls every TikTok
 * and Instagram job queued behind it. Attempts burn, nothing is fetched. So
 * a host declares what it can serve, and jobs for anything else are handed
 * straight back untouched -- no attempt spent, no verdict written, no
 * cooldown -- for a host that can.
 *
 *   TRANSCRIPT_PLATFORMS=tiktok,instagram    the Phoenix box
 *   (unset)                                  the desktop: residential IP, any
 */
export function hostPlatforms(env = process.env) {
  const raw = env.TRANSCRIPT_PLATFORMS?.trim();
  if (!raw) return null;
  const set = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
  return set.size ? set : null;
}
