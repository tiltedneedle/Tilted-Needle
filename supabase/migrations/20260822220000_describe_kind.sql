-- Allow 'describe' as an ingest job kind: the Tier 2 descriptor purchase.
--
-- One cached model call per video (~$0.0001), extracting what a video IS --
-- format, hook style, promise, emotional arc -- as closed enums a hypothesis
-- can test. Runs anywhere (it talks only to the LLM API), costs tokens, and
-- is metered by the same monthly ledger as every other model call.

alter table ingest_jobs drop constraint if exists ingest_jobs_kind_valid;

alter table ingest_jobs add constraint ingest_jobs_kind_valid
  check (kind in (
    'comments', 'transcript', 'replay', 'analyse', 'weekly_read',
    'vision_extract', 'ig_caption', 'transcript_asr', 'describe'
  ));
