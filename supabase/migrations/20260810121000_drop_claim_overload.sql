-- Drop the old two-argument claim_ingest_jobs.
--
-- Adding p_kinds with a default did NOT replace the previous function -- a
-- different argument list is a different function in Postgres, so both now
-- exist. Every existing caller passes two arguments, which matches BOTH
-- candidates, and PostgREST refuses with:
--
--   Could not choose the best candidate function between: ...
--
-- So the "backwards compatible default" was the opposite: it broke every
-- existing call while the new three-argument form worked fine. Caught by
-- probing both signatures after the migration rather than assuming.
--
-- The three-argument version keeps p_kinds defaulting to null, so two-argument
-- calls resolve to it unambiguously once the old one is gone.

drop function if exists claim_ingest_jobs(text, integer);
