-- Let a worker claim only certain job kinds.
--
-- The reason is IP reputation, not tidiness. The jobs split into two classes:
--
--   safe     comments, enrichment, analyse, weekly_read -- official APIs and
--            the LLM. These do not care what IP they run from.
--   fragile  transcript -- routed through yt-dlp, and refused outright from
--            datacenter IP ranges.
--
-- A scheduled runner on shared cloud infrastructure can therefore do the safe
-- work autonomously, while the fragile work waits for a host with an IP worth
-- using. Without a filter IN THE CLAIM, such a runner would lease a transcript
-- job, fail it, and spend one of its four attempts -- so the queue would drain
-- itself into permanent failure while looking busy.
--
-- Filtering client-side after claiming is not equivalent: the row is already
-- leased and its attempt already spent by then.

create or replace function claim_ingest_jobs(
  p_worker text,
  p_limit integer default 5,
  -- NULL means "any kind", so every existing caller keeps working unchanged.
  p_kinds text[] default null
)
returns setof ingest_jobs
language sql
security definer
set search_path = public
as $$
  update ingest_jobs j
  set status = 'running',
      leased_at = now(),
      leased_by = p_worker,
      attempts = j.attempts + 1,
      updated_at = now()
  where j.id in (
    select id from ingest_jobs
    where status = 'pending'
      and not_before <= now()
      and (p_kinds is null or kind = any(p_kinds))
    order by priority, not_before
    limit p_limit
    for update skip locked
  )
  returning j.*;
$$;

revoke execute on function claim_ingest_jobs(text, integer, text[])
  from public, authenticated, anon;
grant execute on function claim_ingest_jobs(text, integer, text[]) to service_role;
