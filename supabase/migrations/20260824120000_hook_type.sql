-- A controlled hook vocabulary, tagged by the people who shot the video.
--
-- content_items.hook already exists and holds the verbatim opening line. It
-- cannot answer "which hooks work": 28 non-empty values across 570 rows group
-- into 28 sets of one, and a per-client cell of n=1 is not a measurement.
-- video_descriptors.hook_descriptor has the same problem for the same reason
-- -- it is free text a model wrote.
--
-- hook_type is the grouping key those two lack. It is a SEPARATE column
-- rather than a replacement because the verbatim line is still the evidence:
-- the tagger reads `hook`, picks a `hook_type`, and a reviewer can check the
-- call later against the words that were actually said.
--
-- CONSTRAINED IN THE DATABASE, not just in the app. The whole value of this
-- column is that it has ten possible values; a typo'd eleventh would create a
-- silent bucket of one that quietly fails the n>=8 floor and never appears in
-- any table. The check constraint is the thing that makes the vocabulary real.
-- Keep it in step with HOOK_TYPES in src/lib/analysis/hookTypes.ts -- and if
-- a value is ever added, add it here in the same commit.
--
-- NULL means "nobody has tagged this yet", and that is a third state distinct
-- from both "no hook" and any particular hook. Every read path must treat it
-- as unknown and exclude it from denominators, exactly as enrichment_state
-- treats an absent row.

alter table content_items
  add column if not exists hook_type text,
  add column if not exists hook_type_set_by uuid references auth.users on delete set null,
  add column if not exists hook_type_set_at timestamptz;

alter table content_items
  drop constraint if exists content_items_hook_type_check;

alter table content_items
  add constraint content_items_hook_type_check check (
    hook_type is null or hook_type in (
      'question', 'bold_claim', 'statistic', 'story', 'problem',
      'curiosity_gap', 'direct_address', 'demonstration', 'contrarian',
      'list_promise'
    )
  );

-- Partial: the untagged majority is never the thing being looked up, and
-- indexing 542 nulls to find 28 rows would be the wrong shape from day one.
create index if not exists content_items_hook_type
  on content_items (workspace_id, client_id, hook_type)
  where hook_type is not null;

comment on column content_items.hook_type is
  'Controlled hook vocabulary, set by a human. NULL = untagged (unknown), '
  'which is not the same as "no hook". See src/lib/analysis/hookTypes.ts.';
