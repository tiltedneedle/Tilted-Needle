-- Allow 'competitor_scan' as an ingest job kind.
--
-- Subject is a COMPETITOR row. One job samples one rival's recent posts and
-- rewrites that competitor's whole sample, which is why it recomputes every
-- rel_index in the same pass: the baseline is the median of the sample, so
-- adding posts moves it for all of them.
--
-- MEASURED, 2026-08-25, before this was written -- yt-dlp profile listing:
--   youtube     WORKS. id, title, view_count, duration, url.
--   instagram   BROKEN. "Unable to extract data" on the user page.
--   tiktok      BROKEN. "Unable to extract secondary user ID."
--
-- So this kind is honestly YouTube-only today. The other two extractors are
-- broken upstream in exactly the way that already leaves 74 TikTok-only
-- client videos unreachable; single-POST extraction still works for
-- Instagram, which is the route a manual paste would take. The handler
-- refuses a platform it cannot serve rather than recording an empty sample as
-- though the rival had posted nothing -- an empty sample and an unreachable
-- one are different facts, and only one of them is about the competitor.
alter table ingest_jobs drop constraint if exists ingest_jobs_kind_valid;

alter table ingest_jobs add constraint ingest_jobs_kind_valid
  check (kind in (
    'comments', 'transcript', 'replay', 'analyse', 'weekly_read',
    'vision_extract', 'ig_caption', 'transcript_asr', 'describe', 'ideas',
    'competitor_scan'
  ));
