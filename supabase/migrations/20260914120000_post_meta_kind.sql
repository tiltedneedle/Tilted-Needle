-- post_meta: fill what the platform tells a free reader and nothing else did.
--
-- Measured 2026-09-14 across the library: TikTok posts missing a duration
-- 159/171, missing their sound 171/171, missing shares 171/171; Instagram
-- missing a caption 61/199. Every one of those fields comes back from the
-- single yt-dlp call the Phoenix box already makes per video for transcripts
-- -- nothing ever asked for them. The video-length analysis was blind on
-- TikTok, and the sound a post uses (the same field that separates a
-- creator talking from a library song) was recorded nowhere.
--
-- Runs only on a host with a yt-dlp box; the planner checks /health first.
alter table ingest_jobs drop constraint if exists ingest_jobs_kind_valid;
alter table ingest_jobs add constraint ingest_jobs_kind_valid
  check (kind in (
    'comments', 'transcript', 'replay', 'analyse', 'weekly_read',
    'vision_extract', 'ig_caption', 'transcript_asr', 'describe', 'ideas',
    'competitor_scan', 'transcript_apify', 'post_meta'
  ));
