-- Allow 'ig_caption' as an ingest job kind.
--
-- Not a new pipeline stage -- a TERMINAL MARKER. Some Instagram posts carry no
-- caption text at all. The backfill selects candidates on "description is
-- null", so such a post stays eligible forever and every run pays Apify again
-- to rediscover the same silence. Measured: one run spent 25 credits, wrote 0
-- fields, and the next dry run selected the identical posts.
--
-- Recording the answer as an ingest_jobs row with status 'unavailable' reuses
-- the exact concept that table already encodes -- "we asked, and there is
-- nothing to get" -- rather than inventing a column or, worse, writing a
-- sentinel string into content_items.description where it would later be read
-- as real caption text.
--
-- The constraint was right to reject this: it caught an unknown kind exactly
-- as designed. What failed was the script, which did not check the insert's
-- error and reported success it had not achieved.

alter table ingest_jobs drop constraint if exists ingest_jobs_kind_valid;

alter table ingest_jobs add constraint ingest_jobs_kind_valid
  check (kind in (
    'comments', 'transcript', 'replay', 'analyse', 'weekly_read',
    'vision_extract', 'ig_caption'
  ));
