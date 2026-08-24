-- Allow 'ideas' as an ingest job kind, so the button can queue what until now
-- only a CLI could run.
--
-- Idea generation was reachable exclusively from a shell: the Insights tab
-- could show suggestions and record adopt/decline against them, but nothing
-- in the product could CREATE one. That made the feedback loop half a loop.
--
-- It goes through the queue rather than running inside the server action for
-- two reasons. First, a model call over a hundred-row evidence table takes
-- ten to twenty seconds, which is a poor thing to hold an HTTP request open
-- for and a worse thing to lose to a serverless timeout halfway through a
-- paid call. Second, the queue is where this project's spend controls live --
-- the worker checks the monthly ceiling and the per-kind budget at CLAIM
-- time, so a job that should not run is never started. A server action
-- calling the model directly would bypass both.
--
-- Subject is the CLIENT: ideas are generated per client, from that client's
-- own evidence, and subject_id is what stops two people queueing the same
-- work twice.

alter table ingest_jobs drop constraint if exists ingest_jobs_kind_valid;

alter table ingest_jobs add constraint ingest_jobs_kind_valid
  check (kind in (
    'comments', 'transcript', 'replay', 'analyse', 'weekly_read',
    'vision_extract', 'ig_caption', 'transcript_asr', 'describe', 'ideas'
  ));
