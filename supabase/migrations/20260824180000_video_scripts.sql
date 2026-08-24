-- The script: what the video was MEANT to say.
--
-- A TRANSCRIPT AND A SCRIPT ARE NOT THE SAME ARTEFACT, and storing them in one
-- column would destroy the only interesting thing about having both. A
-- transcript is a RECORD -- fetched, ASR'd or pasted after the fact, and
-- describing what actually went out. A script is an INTENTION, written before
-- the shoot by a person. The gap between them is the performance itself: the
-- line that got cut, the hook that was rewritten on camera, the CTA nobody
-- remembered to say.
--
-- Separate table rather than a column on content_items, mirroring
-- video_transcripts, for the same three reasons that one is a table: the body
-- is long and would bloat every content_items read that never touches it; it
-- carries its own authorship and timestamps; and it wants its own full-text
-- index without dragging the parent row into one.
--
-- ONE SCRIPT PER VIDEO, edited in place. Not versioned, deliberately: nothing
-- in this product reads an old draft, and a version table nobody queries is a
-- table that only ever grows. `written_by` and `updated_at` answer the
-- question people actually ask of a script -- whose is this and how current.
--
-- No `source` column, unlike video_transcripts. A transcript needs one because
-- it can arrive four ways and they differ in trustworthiness. A script arrives
-- exactly one way: somebody typed it.

create table if not exists video_scripts (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references workspaces on delete cascade,
  content_item_id uuid not null references content_items on delete cascade,
  body            text not null,
  -- Who last wrote it. set null on delete: losing the author must never take
  -- the script with it.
  written_by      uuid references auth.users on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (content_item_id)
);

-- Generated rather than trigger-maintained, so it cannot drift from body when
-- someone writes through a path that forgot the trigger. Same reasoning as
-- video_transcripts.search_vector.
alter table video_scripts
  add column if not exists search_vector tsvector
  generated always as (to_tsvector('english', coalesce(body, ''))) stored;

create index if not exists video_scripts_search on video_scripts using gin (search_vector);
create index if not exists video_scripts_workspace on video_scripts (workspace_id);

alter table video_scripts enable row level security;

-- Inherits the content item's client scoping, exactly as transcripts do.
create policy video_scripts_select on video_scripts for select to authenticated
  using (
    exists (
      select 1 from content_items ci
      where ci.id = video_scripts.content_item_id
        and can_read_client(ci.workspace_id, ci.client_id)
    )
  );

-- Staff write scripts; clients never do. A client being able to edit the plan
-- for their own video would make the record of what we intended editable by
-- the person we intended it for.
create policy video_scripts_write on video_scripts for all to authenticated
  using (is_workspace_member(workspace_id) and not is_client_user(workspace_id))
  with check (is_workspace_member(workspace_id) and not is_client_user(workspace_id));

comment on table video_scripts is
  'What a video was written to say, entered by hand. Distinct from '
  'video_transcripts, which records what it actually said.';
