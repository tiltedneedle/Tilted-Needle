-- The retrieval layer: pgvector, in the database already running.
--
-- NOT PINECONE, AND NOT NOTHING -- both were considered and the reasoning
-- matters more than the choice (PRD §8):
--
--   Pinecone has no RLS. Every table here is workspace-scoped and the worker's
--   service key is a deliberate exemption; putting transcript and comment text
--   in a second system means re-implementing workspace isolation under a
--   different security model. And every real query here is a JOIN -- "nearest
--   AND same client AND scored AND platform = X" -- which is one statement in
--   pgvector and a round-trip dance with a metadata filter anywhere else.
--
--   "Nothing" was correct before Phase 1, when vector search over nine
--   documents was strictly worse than passing all nine. The corpus is now
--   hundreds of transcripts and thousands of comments, and one job is
--   genuinely unbuildable in SQL: merging comment themes. Each analysis
--   invents its own vocabulary, so "how much is it", "pricing?" and "what's
--   the cost" share zero lexical overlap -- tsvector and pg_trgm cannot merge
--   what embeddings can.
--
-- THE SHAPE IS DRIVEN BY THE 500 MB FREE TIER.
--
-- text-embedding-3-small at API dimensions=512, stored as halfvec(512):
-- vector(n) costs 4n+8 bytes and native 1536-dim would be ~332 MB before
-- indexes against a 500 MB tier; halfvec(512) is ~56 MB all in. The dimension
-- reduction happens through the API PARAMETER, never client-side truncation --
-- the API re-normalises, a client-side slice leaves unnormalised vectors and
-- silently wrong cosine distances. A 1,032-byte row also sits inline under the
-- TOAST threshold, so no extra heap fetch per row.
--
-- NO ANN INDEX, ON PURPOSE. An exact scan of ~54k halfvec(512) rows is
-- 30-50 ms unfiltered and sub-millisecond once WHERE client_id applies, which
-- is every real query. The stronger argument is statistical: neighbour sets
-- feed matched-control comparisons, and an approximate neighbour set injects
-- an unquantified ~5% selection error into a number the UI prints a confidence
-- state next to. This codebase's discipline is that numbers are checkable.

create extension if not exists vector;

create table embeddings (
  id            uuid primary key default uuid_generate_v4(),
  workspace_id  uuid not null references workspaces on delete cascade,
  -- What kind of text this is, which is also the unit of retrieval:
  --   theme_label     -- a comment-theme label, for merging vocabularies
  --   hook_descriptor -- topic-stripped hook style, for archetype discovery
  --   transcript      -- a whole transcript, for novelty scoring and search
  kind          text not null check (kind in ('theme_label', 'hook_descriptor', 'transcript')),
  -- The row this embeds, in whichever table `kind` implies. Deliberately not a
  -- foreign key: the subjects live in three different tables, and an
  -- embedding outliving its subject is caught by re-embedding, not by
  -- cascade rules across a polymorphic reference.
  subject_id    uuid not null,
  client_id     uuid references clients on delete cascade,
  -- The exact text that was embedded. Kept because an embedding is only
  -- reusable while its source text is unchanged, and diffing against the
  -- source table per kind would need three different joins.
  content       text not null,
  embedding     halfvec(512) not null,
  -- A full re-embed costs about five cents, so a model change is a BACKFILL,
  -- not a migration -- these columns are what make that safe.
  model         text not null,
  dimensions    integer not null,
  created_at    timestamptz not null default now(),
  unique (kind, subject_id)
);

-- The only index. Every real query filters here first, and the remaining scan
-- is exact and fast.
create index embeddings_ws_kind on embeddings (workspace_id, kind);

alter table embeddings enable row level security;

create policy embeddings_select on embeddings for select to authenticated
  using (can_manage_workspace(workspace_id) and not is_client_user(workspace_id));

-- Merged themes: the first client-level audience statement the system can
-- make. Source themes stay in ai_analyses untouched; this table is the merge
-- result, rebuilt whenever the inputs change.
create table merged_themes (
  id             uuid primary key default uuid_generate_v4(),
  workspace_id   uuid not null references workspaces on delete cascade,
  client_id      uuid not null references clients on delete cascade,
  label          text not null,
  sentiment      text,
  -- The union of the source themes' VERIFIED comment ids. The counting
  -- discipline survives the merge: tallyThemes counts ids the model returned
  -- and the system checked, so a merged count is a union of checked sets,
  -- never a number the model asserted.
  comment_ids    uuid[] not null,
  comment_count  integer not null,
  -- Which per-post theme rows merged into this one, for audit.
  source_count   integer not null,
  post_count     integer not null,
  computed_at    timestamptz not null default now()
);

create index merged_themes_client on merged_themes (workspace_id, client_id);

alter table merged_themes enable row level security;

create policy merged_themes_select on merged_themes for select to authenticated
  using (can_manage_workspace(workspace_id) and not is_client_user(workspace_id));

comment on table embeddings is
  'halfvec(512) via text-embedding-3-small dimensions=512 -- the API '
  'parameter, never client-side truncation, which leaves unnormalised vectors '
  'and silently wrong cosine distances. No ANN index on purpose: exact scans '
  'are fast at this scale and approximate neighbours would inject unquantified '
  'selection error into numbers the UI labels with confidence states.';
