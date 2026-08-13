-- Let a terminally failed job be tried again, a bounded number of times.
--
-- attempts/MAX_ATTEMPTS already handles a job failing a few times in a row
-- within one run. What has no answer is the job that exhausts them and lands on
-- status='failed', because nothing anywhere resets that. Six analyse jobs sat
-- written off for days -- one of them for missing LLM config that had since
-- been set, and four for a schema mismatch that has since been fixed. Their
-- causes were gone and they stayed dead, because "failed" meant forever.
--
-- A second counter is needed rather than reusing attempts: the requeue has to
-- clear attempts for the job to be claimable at all, so attempts cannot also
-- be the memory of how many times we have already come back to it.
--
-- Deliberately NOT applied to 'unavailable'. That state is a considered answer
-- -- "no post on this item exposes comments", "instagram post has no caption"
-- -- not a failure, and retrying it forever would burn quota discovering the
-- same nothing. 142 comment jobs and 30 caption jobs are in that state on
-- purpose.

alter table ingest_jobs
  add column if not exists retry_round integer not null default 0;

comment on column ingest_jobs.retry_round is
  'How many times this job has been requeued after reaching status=failed. Bounded by worker/requeue.mjs; attempts is per-round and is cleared each time.';

-- The requeue scans by status and skips anything already exhausted, so it is
-- worth an index once the failed pile is non-trivial.
create index if not exists ingest_jobs_failed_retry_idx
  on ingest_jobs (status, retry_round)
  where status = 'failed';
