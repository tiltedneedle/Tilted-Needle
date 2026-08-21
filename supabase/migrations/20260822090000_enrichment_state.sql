-- The only place a verdict about missing data is allowed to live.
--
-- WHY THIS TABLE EXISTS
--
-- Today "this video has no transcript" and "we have not fetched it yet" are
-- the same observable state: no row in video_transcripts. Four genuinely
-- different answers all collapse into ingest_jobs.status='unavailable' plus a
-- last_error string that every retry overwrites:
--
--     the platform published no caption track          (a fact, forever)
--     the video is silent or music-only                (a fact, forever)
--     this platform has no captions at all             (a fact, until it does)
--     the extraction box was down / rate-limited       (NOT a fact at all)
--
-- Conflating the last one with the first three is what condemned 146 videos
-- in August 2026 -- 72 YouTube Shorts filtered out by a platform map with no
-- `youtube_shorts` key, and 74 TikTok posts written off because the yt-dlp
-- service was unreachable. `unavailable` is terminal: enqueue.settled()
-- excludes it forever and requeue.mjs refuses to touch it, so none of them
-- could recover without a hand-written UPDATE against production.
--
-- THE RULE THAT PREVENTS ALL OF THAT, and the only rule this table has:
--
--     Only a handler that REACHED THE PLATFORM AND GOT AN ANSWER may write
--     here. No row means never attempted, or attempted and failed in
--     transport. A transport failure writes nothing.
--
-- That single constraint is what makes the absence of a row meaningful, and
-- it is why the verdict is deliberately kept OUT of ingest_jobs: the queue is
-- about work in flight, and it is rewritten by every retry. A verdict has to
-- outlive the queue that discovered it.
--
-- It also gives buildClientEvidence a real denominator. "34 of 61 comments
-- grouped" is honest; "no themes" against an unknown denominator is not, and
-- a hypothesis that requires a transcript must drop unobserved videos rather
-- than counting them as absent evidence.

create table enrichment_state (
  subject_type    text not null check (subject_type in ('content_item', 'platform_post')),
  subject_id      uuid not null,
  kind            text not null check (kind in ('transcript', 'comments')),
  workspace_id    uuid not null references workspaces on delete cascade,

  -- The four answers, kept distinct because they have different lifetimes.
  --   ok                     -- data exists; the row records HOW it was got
  --   no_speech              -- ASR ran and found no words (music, ambience)
  --   no_captions_published  -- the platform serves captions, this post has none
  --   platform_unsupported   -- e.g. Instagram publishes no caption track at all
  --   none_exist             -- the post genuinely has zero comments
  state           text not null check (state in
    ('ok', 'no_speech', 'no_captions_published', 'platform_unsupported', 'none_exist')),

  -- Which route produced this answer. A verdict from a weaker route can be
  -- revisited when a better one ships; a verdict from the best available
  -- route cannot.
  method          text,
  method_version  integer not null default 1,

  -- For no_speech, the ASR output that was rejected, so a wrong call is
  -- auditable rather than merely asserted.
  note            text,

  decided_at      timestamptz not null default now(),

  -- Set for verdicts that are true now but need not stay true --
  -- platform_unsupported above all, since platforms add caption support.
  -- Null means "settled; only a new method_version reopens this".
  recheck_after   timestamptz,

  primary key (subject_type, subject_id, kind)
);

-- The denominator queries are all "which subjects of this workspace/kind are
-- still unanswered", so that is the index.
create index enrichment_state_ws_kind on enrichment_state (workspace_id, kind, state);

-- Due-for-recheck sweeps, kept narrow because most rows never carry a date.
create index enrichment_state_recheck on enrichment_state (recheck_after)
  where recheck_after is not null;

alter table enrichment_state enable row level security;

-- Same shape as ingest_jobs: staff of the workspace may read it, clients
-- never, and the worker writes through the service role, which bypasses RLS
-- and therefore has no policy here.
create policy enrichment_state_select on enrichment_state for select to authenticated
  using (can_manage_workspace(workspace_id) and not is_client_user(workspace_id));

comment on table enrichment_state is
  'Verdicts about why data is missing. Only written by a handler that reached '
  'the platform and got an answer; a transport failure writes nothing, so the '
  'absence of a row always means "unknown", never "none".';
