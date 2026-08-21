-- Phase 2 storage: what each video IS, separately from how it performed.
--
-- THREE TABLES BECAUSE THEY HAVE THREE DIFFERENT LIFETIMES
--
-- video_features is pure arithmetic over data already held. A full recompute
-- of the corpus is milliseconds, so it is a CACHE, not a record: changing a
-- threshold means bumping extractor_version and re-running, never writing a
-- migration. It exists only so the engine reads one table instead of
-- re-parsing every transcript on every run.
--
-- video_descriptors costs tokens. It must survive a Tier 1 recompute
-- untouched, which is the whole reason it is not just more columns on the
-- table above -- one careless `delete from video_features` would otherwise
-- throw away the paid work along with the free work.
--
-- post_comment_metrics is per POST rather than per video, because comments
-- belong to a posting and cross-posted copies of one edit collect different
-- ones.
--
-- THE COLUMN THAT MATTERS MOST IS transcript_present.
--
-- Every transcript-derived column is null when no transcript exists, and null
-- there means UNOBSERVED, never "absent". A video nobody transcribed has not
-- "failed to ask a question". Read those nulls as false and all 87 currently
-- untranscribed videos silently join the "without" side of eleven of the
-- sixteen hypotheses at once, biasing every one of them the same way. That is
-- the same conflation of "no data" with "no" that condemned 146 videos in the
-- enrichment layer, and this column is what keeps the distinction legible to
-- anything reading the table directly.

create table video_features (
  content_item_id        uuid primary key references content_items on delete cascade,
  workspace_id           uuid not null references workspaces on delete cascade,
  -- Bump to force a recompute. No migration: the data is derived.
  extractor_version      integer not null,

  hook_text_15s          text,
  hook_word_count        integer,
  hook_has_question      boolean,
  hook_is_greeting       boolean,
  hook_second_person_rate numeric,
  hook_imperative_open   boolean,
  hook_numeral           boolean,

  words_per_second       numeric,
  words_per_second_3s    numeric,
  time_to_first_noun_ms  integer,
  question_density       numeric,
  numeral_density        numeric,
  type_token_ratio       numeric,
  flesch_kincaid         numeric,
  cta_present            boolean,
  cta_first_ms           integer,
  loop_marker            boolean,

  title_length           integer,
  title_has_question     boolean,
  title_has_numeral      boolean,

  length_seconds         numeric,
  -- Computed with the operating zone's offset AT the publish instant, never a
  -- fixed one. A fixed offset is wrong across a DST boundary, and the earlier
  -- fixed-offset bug moved videos across the exact hour boundary the finding
  -- was about -- so "posts before noon do better" was partly arithmetic.
  posted_hour            integer,
  posted_weekday         integer,

  transcript_present     boolean not null,
  computed_at            timestamptz not null default now()
);

create index video_features_ws on video_features (workspace_id);

create table video_descriptors (
  content_item_id      uuid primary key references content_items on delete cascade,
  workspace_id         uuid not null references workspaces on delete cascade,
  prompt_version       integer not null,
  model                text not null,
  -- Digest of the exact input. A descriptor is only reusable if the text it
  -- was derived from has not changed, and a transcript CAN change -- an ASR
  -- row is replaced the day a real caption track appears.
  input_digest         text not null,

  format               text,
  -- Topic-stripped by construction, and that is the point. A raw hook
  -- embedding encodes TOPIC, not style: "What's the best CRM in 2026?" and
  -- "What's the best espresso grinder?" are the same hook style and land far
  -- apart, while "Here's the best CRM" and "What's the best CRM?" are
  -- different styles and land almost on top of each other. Clustering raw
  -- hooks rediscovers topics the team already knows and misses the one thing
  -- they can change before the next shoot.
  hook_descriptor      jsonb not null,
  hook_descriptor_text text,
  promise_stated       boolean,
  promise_paid_off_ms  integer,
  -- Both valence and arousal are stored, but AROUSAL is what gets tested.
  -- Berger & Milkman (JMR 2012): high-arousal emotion travels -- awe, anger,
  -- anxiety -- while sadness suppresses sharing regardless of how negative it
  -- is. Storing only valence would test the wrong axis.
  emotional_arc        jsonb,
  claim_type           text,
  topic                text,
  entities             text[],
  created_at           timestamptz not null default now(),

  unique (content_item_id, prompt_version, input_digest)
);

create index video_descriptors_ws on video_descriptors (workspace_id);

create table post_comment_metrics (
  platform_post_id  uuid primary key references platform_posts on delete cascade,
  workspace_id      uuid not null references workspaces on delete cascade,
  extractor_version integer not null,
  -- Both counts are kept so the denominator is always reportable. "34 of 61
  -- comments grouped" is an honest statement; a bare theme list against an
  -- unknown denominator is not.
  analysed_count    integer not null,
  filtered_count    integer not null,
  mention_count     integer not null,
  question_count    integer not null,
  confusion_count   integer not null,
  intent_count      integer not null,
  median_length     integer,
  reply_ratio       numeric,
  computed_at       timestamptz not null default now()
);

create index post_comment_metrics_ws on post_comment_metrics (workspace_id);

-- RLS mirrors video_transcripts: staff of the workspace read, clients never,
-- and the worker writes through the service role, which bypasses RLS and so
-- needs no policy.
alter table video_features enable row level security;
alter table video_descriptors enable row level security;
alter table post_comment_metrics enable row level security;

create policy video_features_select on video_features for select to authenticated
  using (can_manage_workspace(workspace_id) and not is_client_user(workspace_id));
create policy video_descriptors_select on video_descriptors for select to authenticated
  using (can_manage_workspace(workspace_id) and not is_client_user(workspace_id));
create policy post_comment_metrics_select on post_comment_metrics for select to authenticated
  using (can_manage_workspace(workspace_id) and not is_client_user(workspace_id));

comment on column video_features.transcript_present is
  'False means the transcript-derived columns are UNOBSERVED, not absent. A '
  'video with no transcript has not "failed to ask a question" -- every '
  'transcript-derived hypothesis must drop these rows rather than count them '
  'on the negative side.';
