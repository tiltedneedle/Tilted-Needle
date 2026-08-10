-- Give ingest_jobs a real payload column.
--
-- vision_extract had been parking its storage object path in `last_error`,
-- because no payload column existed. That works exactly until something
-- writes to last_error -- which the worker does on EVERY retry and every
-- cooldown, by design, since that is what the column is for.
--
-- The failure is silent and total: a provider 429 (documented and expected on
-- the free tier) makes the worker write "blocked: ..." over the path and
-- return the job to pending. The next pass reads that error string as an
-- object path, the download fails, and the job settles as terminally
-- unavailable. The screenshot is never extracted, and because the object is
-- only deleted on successful confirmation, it is orphaned in the private
-- bucket permanently.
--
-- Found by an adversarial audit before it ever fired -- vision_extract has
-- not run in anger yet -- so there is no existing data to migrate. The
-- handler still falls back to last_error for any row queued before this.
-- Re-numbered from 20260810180000. That version was RECORDED in
-- schema_migrations while its DDL never ran -- the push reported "Applying"
-- and then died before "Finished", leaving the ledger claiming a change the
-- database did not have. Every future push would have skipped it forever, and
-- the only symptom was PostgREST insisting the column does not exist. The DDL
-- is idempotent, so re-running under a fresh version is safe.
alter table ingest_jobs add column if not exists payload jsonb;

comment on column ingest_jobs.payload is
  'Handler input for jobs that need one (e.g. vision_extract''s storage object path). Never use last_error for this: the worker overwrites it on retry.';
