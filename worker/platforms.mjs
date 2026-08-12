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
