-- The ingest layer: transcripts, replay maps, comments, AI outputs, and the
-- job queue that fills them (PRD-video-intelligence §6).
--
-- One structural decision worth stating up front: ingest_jobs IS the worker's
-- API. The Oracle worker exposes no HTTP endpoint at all -- it polls this
-- table, does the work, and writes results back. That removes an entire class
-- of surface: no inbound port, no TLS certificate, no auth layer to get
-- wrong. "Re-fetch this transcript" is an INSERT, not a request.

-- ---------------------------------------------------------------------------
-- Transcripts
-- ---------------------------------------------------------------------------

-- Attached to the CONTENT ITEM, not the platform post. The same edit posted
-- to YouTube, TikTok and Instagram has one transcript, and it describes all
-- three -- which is what lets transcript-driven analysis cover platforms that
-- expose no transcript of their own, wherever a YouTube cut exists (§6.1).
create table video_transcripts (
  id                uuid primary key default uuid_generate_v4(),
  workspace_id      uuid not null references workspaces on delete cascade,
  content_item_id   uuid not null references content_items on delete cascade,
  -- Which post it was actually pulled from, for provenance.
  source_post_id    uuid references platform_posts on delete set null,
  -- 'public' = the undocumented timedtext route; 'manual' = pasted by a human;
  -- 'import' = came in with a client's own export.
  source            text not null default 'public',
  language          text,
  -- TRUE = machine-generated (ASR). P2 established this is the common case and
  -- that it matters: ASR mangles names, brands and accents, which is exactly
  -- the vocabulary this corpus gets searched for.
  is_generated      boolean,
  full_text         text not null,
  -- [{start_ms, dur_ms, text}] -- timings are what make a transcript line
  -- clickable and what aligns it to the replay curve.
  segments          jsonb not null default '[]'::jsonb,
  fetched_at        timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  unique (content_item_id)
);

-- Generated, so it can never drift from full_text the way a trigger-maintained
-- column does when someone updates through a path that forgot the trigger.
alter table video_transcripts
  add column search_vector tsvector
  generated always as (to_tsvector('english', coalesce(full_text, ''))) stored;

create index video_transcripts_search on video_transcripts using gin (search_vector);
create index video_transcripts_workspace on video_transcripts (workspace_id);

-- ---------------------------------------------------------------------------
-- Replay intensity
-- ---------------------------------------------------------------------------

-- Named for what it is. This is NOT audience retention: a peak means a segment
-- was re-watched, and a trough does not mean viewers left (§3.3). True
-- retention, when a client supplies it, lives in post_analytics.retention_curve
-- and is never plotted on the same axis as this.
create table video_replay_map (
  id                uuid primary key default uuid_generate_v4(),
  workspace_id      uuid not null references workspaces on delete cascade,
  platform_post_id  uuid not null references platform_posts on delete cascade,
  -- [{pct: 0..1, intensity: 0..1}] -- ~100 buckets across the duration, so the
  -- x-axis is percent-of-video and clips of different lengths compare.
  points            jsonb not null,
  captured_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  unique (platform_post_id)
);

create index video_replay_map_workspace on video_replay_map (workspace_id);

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

-- Stored raw enough to re-analyse without refetching: prompt versions change,
-- and paying the API again to re-read text we already hold would be waste.
create table post_comments (
  id                uuid primary key default uuid_generate_v4(),
  workspace_id      uuid not null references workspaces on delete cascade,
  platform_post_id  uuid not null references platform_posts on delete cascade,
  external_id       text not null,
  author            text,
  text              text not null,
  like_count        integer,
  published_at      timestamptz,
  fetched_at        timestamptz not null default now(),
  unique (platform_post_id, external_id)
);

create index post_comments_post on post_comments (platform_post_id);
create index post_comments_workspace on post_comments (workspace_id);

-- ---------------------------------------------------------------------------
-- AI outputs
-- ---------------------------------------------------------------------------

create table ai_analyses (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references workspaces on delete cascade,
  subject_type    text not null,   -- 'post' | 'content_item' | 'client'
  subject_id      uuid not null,
  kind            text not null,   -- 'comment_themes' | 'attention_map' | ...
  prompt_version  integer not null,
  model           text not null,
  -- Hash of the exact inputs. With the unique constraint below, identical
  -- inputs can never be paid for twice -- the single most effective cost
  -- control available, since the LLM is the only paid line in the platform.
  input_digest    text not null,
  -- Structured against a fixed schema, never free prose alone: the UI renders
  -- fields, and a response that fails validation is never shown raw.
  output          jsonb not null,
  input_tokens    integer,
  output_tokens   integer,
  created_at      timestamptz not null default now(),
  unique (subject_type, subject_id, kind, prompt_version, input_digest)
);

create index ai_analyses_subject on ai_analyses (subject_type, subject_id, kind);
create index ai_analyses_workspace on ai_analyses (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- The queue
-- ---------------------------------------------------------------------------

create table ingest_jobs (
  id            uuid primary key default uuid_generate_v4(),
  workspace_id  uuid not null references workspaces on delete cascade,
  kind          text not null,
  subject_id    uuid not null,
  status        text not null default 'pending',
  attempts      integer not null default 0,
  -- Backoff and jitter both live here: a job is invisible until this passes.
  not_before    timestamptz not null default now(),
  -- Set when a worker claims the job. A claim older than the lease timeout is
  -- treated as a dead worker and the job returns to pending, which is what
  -- makes "worker killed mid-job" a non-event.
  leased_at     timestamptz,
  leased_by     text,
  last_error    text,
  priority      integer not null default 100,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint ingest_jobs_status_valid
    check (status in ('pending', 'running', 'done', 'failed', 'unavailable')),
  constraint ingest_jobs_kind_valid
    check (kind in ('comments', 'transcript', 'replay', 'analyse', 'weekly_read', 'vision_extract'))
);

-- The worker's hot path, and the only query it runs in a loop.
create index ingest_jobs_claimable on ingest_jobs (priority, not_before)
  where status = 'pending';
-- Recovering leases that expired because a worker died.
create index ingest_jobs_leased on ingest_jobs (leased_at) where status = 'running';
-- Enqueue must be idempotent: re-running discovery must not pile up duplicate
-- work for the same subject. One outstanding job per (kind, subject).
create unique index ingest_jobs_one_outstanding on ingest_jobs (kind, subject_id)
  where status in ('pending', 'running');

-- The worker's heartbeat. A single row per worker, so /data can show how long
-- ago it last spoke -- the liveness signal that makes an Oracle instance being
-- reclaimed visible in minutes rather than whenever someone notices stale data.
create table worker_heartbeat (
  worker_id     text primary key,
  last_seen_at  timestamptz not null default now(),
  -- Free-form status the worker publishes: queue depth, cooldown state, the
  -- month's token spend. Read-only to the app.
  detail        jsonb not null default '{}'::jsonb
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table video_transcripts enable row level security;
alter table video_replay_map  enable row level security;
alter table post_comments     enable row level security;
alter table ai_analyses       enable row level security;
alter table ingest_jobs       enable row level security;
alter table worker_heartbeat  enable row level security;

-- Transcripts and replay maps inherit the content item's client scoping, the
-- same way post_analytics does: a client user sees their own material and
-- nobody else's.
create policy video_transcripts_select on video_transcripts for select to authenticated
  using (
    exists (
      select 1 from content_items ci
      where ci.id = video_transcripts.content_item_id
        and can_read_client(ci.workspace_id, ci.client_id)
    )
  );
-- Staff may paste a transcript by hand; clients may not write anything.
create policy video_transcripts_write on video_transcripts for all to authenticated
  using (is_workspace_member(workspace_id) and not is_client_user(workspace_id))
  with check (is_workspace_member(workspace_id) and not is_client_user(workspace_id));

create policy video_replay_map_select on video_replay_map for select to authenticated
  using (
    exists (
      select 1 from platform_posts pp
      join content_items ci on ci.id = pp.content_item_id
      where pp.id = video_replay_map.platform_post_id
        and can_read_client(ci.workspace_id, ci.client_id)
    )
  );
create policy video_replay_map_write on video_replay_map for all to authenticated
  using (can_manage_workspace(workspace_id))
  with check (can_manage_workspace(workspace_id));

create policy post_comments_select on post_comments for select to authenticated
  using (
    exists (
      select 1 from platform_posts pp
      join content_items ci on ci.id = pp.content_item_id
      where pp.id = post_comments.platform_post_id
        and can_read_client(ci.workspace_id, ci.client_id)
    )
  );
create policy post_comments_write on post_comments for all to authenticated
  using (can_manage_workspace(workspace_id))
  with check (can_manage_workspace(workspace_id));

-- AI output is staff-facing analysis of the whole book of work. A client user
-- must not read it even about their own content: it routinely compares them to
-- other clients, and that comparison is the agency's, not theirs.
create policy ai_analyses_select on ai_analyses for select to authenticated
  using (is_workspace_member(workspace_id) and not is_client_user(workspace_id));
create policy ai_analyses_write on ai_analyses for all to authenticated
  using (can_manage_workspace(workspace_id))
  with check (can_manage_workspace(workspace_id));

-- Managers can see the queue and enqueue work; nobody else touches it. The
-- worker uses the service key and bypasses all of this, as the sync does.
create policy ingest_jobs_select on ingest_jobs for select to authenticated
  using (can_manage_workspace(workspace_id) and not is_client_user(workspace_id));
create policy ingest_jobs_write on ingest_jobs for all to authenticated
  using (can_manage_workspace(workspace_id) and not is_client_user(workspace_id))
  with check (can_manage_workspace(workspace_id) and not is_client_user(workspace_id));

-- Heartbeat is not workspace-scoped (one worker serves the deployment), so it
-- is readable by any signed-in staff member and writable only by the service
-- role -- which has no policy here and bypasses RLS entirely.
create policy worker_heartbeat_select on worker_heartbeat for select to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- Claiming a job
-- ---------------------------------------------------------------------------

-- Atomic claim. SKIP LOCKED is what makes more than one worker safe: two
-- pollers racing take different rows instead of blocking or double-working.
-- Restricted to service_role because only the worker claims jobs.
create function claim_ingest_jobs(p_worker text, p_limit integer default 5)
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
    where status = 'pending' and not_before <= now()
    order by priority, not_before
    limit p_limit
    for update skip locked
  )
  returning j.*;
$$;

revoke execute on function claim_ingest_jobs(text, integer) from public, authenticated, anon;
grant execute on function claim_ingest_jobs(text, integer) to service_role;

-- Return jobs whose worker died mid-run. Called by the worker on each pass,
-- so a killed process costs one lease timeout rather than a stuck queue.
create function reclaim_expired_leases(p_older_than interval default '15 minutes')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update ingest_jobs
  set status = 'pending',
      leased_at = null,
      leased_by = null,
      not_before = now(),
      last_error = coalesce(last_error, 'lease expired; worker presumed dead'),
      updated_at = now()
  where status = 'running'
    and leased_at is not null
    and leased_at < now() - p_older_than;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function reclaim_expired_leases(interval) from public, authenticated, anon;
grant execute on function reclaim_expired_leases(interval) to service_role;
