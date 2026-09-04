-- Allow 'transcript_apify': transcription that needs no residential IP.
--
-- Every other transcript route in this system depends on one desktop being
-- switched on, because yt-dlp is refused from datacenter ranges. Apify fetches
-- on its own infrastructure, so this kind is IP-AGNOSTIC and belongs in the
-- GitHub Actions drain list -- which is what makes the pipeline autonomous
-- rather than desk-bound.
--
-- Subject is a CONTENT ITEM, matching `transcript` and `transcript_asr`: the
-- handler resolves it to whichever of its posts sits on a platform that has
-- an actor configured.
alter table ingest_jobs drop constraint if exists ingest_jobs_kind_valid;

alter table ingest_jobs add constraint ingest_jobs_kind_valid
  check (kind in (
    'comments', 'transcript', 'replay', 'analyse', 'weekly_read',
    'vision_extract', 'ig_caption', 'transcript_asr', 'describe', 'ideas',
    'competitor_scan', 'transcript_apify'
  ));
