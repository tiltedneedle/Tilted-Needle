-- Poster frame per post, so the content list can be scanned by eye.
--
-- On platform_posts rather than content_items on purpose: one content item
-- legitimately holds several posts -- one per platform it was published to --
-- and each platform generates its own poster frame from its own encode. Put
-- it on the item and you have to pick a winner at write time, then explain
-- why the tile shows the TikTok frame for a video whose YouTube cut differs.
--
-- Storing the URL, not the image. There is no storage bucket wired up in this
-- project, and re-hosting other platforms' media is a separate decision with
-- its own bandwidth and rights questions. The consequence is accepted and
-- designed for: these are CDN URLs, some of them signed and short-lived, so
-- the value is allowed to rot and the tile falls back to a neutral box.
alter table platform_posts
  add column if not exists thumbnail_url text;

comment on column platform_posts.thumbnail_url is
  'Poster frame URL as the platform reported it at discovery. Nullable, and '
  'allowed to go stale: Instagram''s CDN links are signed and expire. A dead '
  'URL is a cosmetic loss only -- the tile renders a placeholder, never a '
  'broken-image glyph. Never treated as evidence that a post exists.';
