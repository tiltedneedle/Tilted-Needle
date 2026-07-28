-- Phase 1.5: Clockify historical backfill (PRD section 11, "Handling note" +
-- phasing table). Time-entry descriptions already carry video titles by
-- convention (PRD 7.5); this is what turns that convention into a real
-- content_item_id, and gives Phase 3 scoring history to work with on day
-- one instead of two months after launch.
--
-- Staged, not direct: a wrong fuzzy match silently misattributes someone's
-- work, so every row is held for human review before it becomes a real
-- time_entry. Nothing here writes to time_entries until commit_import_batch
-- is called, and only for rows a manager has actually reviewed.

create extension if not exists pg_trgm;

create table import_batches (
  id            uuid primary key default uuid_generate_v4(),
  workspace_id  uuid not null references workspaces on delete cascade,
  source        text not null default 'clockify',
  status        text not null default 'staged', -- staged | committed | discarded
  created_by    uuid references profiles on delete set null,
  created_at    timestamptz not null default now(),
  committed_at  timestamptz,
  row_count     integer not null default 0
);

create table import_rows (
  id                     uuid primary key default uuid_generate_v4(),
  batch_id               uuid not null references import_batches on delete cascade,
  workspace_id           uuid not null references workspaces on delete cascade,
  external_id            text,
  description            text not null,
  project_name           text,
  task_name              text,
  member_name            text,
  member_email           text,
  started_at             timestamptz not null,
  ended_at               timestamptz,
  duration_seconds       integer,
  is_billable            boolean not null default true,
  -- The algorithm's best guess and its confidence, kept separate from what a
  -- reviewer actually chooses -- overwriting the suggestion would destroy the
  -- record of whether a human agreed with it or overrode it.
  suggested_content_item_id uuid references content_items on delete set null,
  match_confidence       numeric,
  resolved_content_item_id uuid references content_items on delete set null,
  status                 text not null default 'pending' -- pending | approved | skipped | rejected
);

create index on import_rows (batch_id);
create index on import_rows (workspace_id);

-- One row per distinct Clockify member seen in a batch. Import is blocked
-- from committing until every member is mapped: an unmapped row has no
-- valid user_id to write to time_entries.user_id (not null).
create table import_member_map (
  id             uuid primary key default uuid_generate_v4(),
  batch_id       uuid not null references import_batches on delete cascade,
  workspace_id   uuid not null references workspaces on delete cascade,
  clockify_name  text not null,
  clockify_email text,
  resolved_user_id uuid references profiles on delete set null,
  unique (batch_id, clockify_name)
);

-- ---------------------------------------------------------------------------
-- Fuzzy matching
--
-- Trigram similarity against this workspace's content titles. Returns the
-- single best match and its score so the caller can apply its own threshold
-- rather than hard-coding one in SQL.
-- ---------------------------------------------------------------------------

create function suggest_content_match(p_workspace_id uuid, p_description text)
returns table (content_item_id uuid, score real)
language sql
stable
security invoker
set search_path = public
as $$
  select ci.id, similarity(lower(p_description), lower(ci.title)) as score
  from content_items ci
  where ci.workspace_id = p_workspace_id
  order by score desc
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- RLS -- manager-only throughout. This is an internal ops tool for
-- reconciling historical data, not a member-facing feature.
-- ---------------------------------------------------------------------------

alter table import_batches   enable row level security;
alter table import_rows      enable row level security;
alter table import_member_map enable row level security;

create policy import_batches_all on import_batches for all to authenticated
  using (can_manage_workspace(workspace_id))
  with check (can_manage_workspace(workspace_id));

create policy import_rows_all on import_rows for all to authenticated
  using (can_manage_workspace(workspace_id))
  with check (can_manage_workspace(workspace_id));

create policy import_member_map_all on import_member_map for all to authenticated
  using (can_manage_workspace(workspace_id))
  with check (can_manage_workspace(workspace_id));

-- ---------------------------------------------------------------------------
-- Commit
--
-- Writes real time_entries for approved/skipped rows only, atomically with
-- marking the batch committed. Blocks outright if any member is still
-- unmapped, rather than silently attributing their hours to whoever clicked
-- commit.
-- ---------------------------------------------------------------------------

-- security definer, not invoker: the INSERT into time_entries must write
-- rows for whichever team member a Clockify entry was mapped to, not only
-- the manager running the import, and the normal time_entries RLS policy
-- requires user_id = auth.uid(). The authorization that matters is
-- re-implemented explicitly above (can_manage_workspace, workspace scoping,
-- rows drawn only from this batch's own staged data) rather than borrowed
-- from the caller's row-level policies -- the same pattern as kiosk_clock.
create function commit_import_batch(p_batch_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_status text;
  v_unmapped_count integer;
  v_inserted integer;
begin
  select workspace_id, status into v_workspace_id, v_status
  from import_batches where id = p_batch_id;
  if v_workspace_id is null then
    raise exception 'import batch not found';
  end if;
  if not can_manage_workspace(v_workspace_id) then
    raise exception 'insufficient privileges';
  end if;
  -- Without this, calling commit twice re-inserts every approved/skipped
  -- row a second time -- found by actually calling it twice in a test.
  if v_status = 'committed' then
    raise exception 'this batch has already been committed';
  end if;

  -- Counts every distinct member seen in the batch's rows against
  -- import_member_map, not just member_map rows that already exist: a
  -- member with staged rows but no member_map row at all must block commit
  -- too, or their hours are silently dropped by the join below rather than
  -- refused (found by testing exactly that case, not by review).
  select count(*) into v_unmapped_count
  from (select distinct member_name from import_rows where batch_id = p_batch_id) r
  left join import_member_map mm
    on mm.batch_id = p_batch_id and mm.clockify_name = r.member_name
  where mm.resolved_user_id is null;
  if v_unmapped_count > 0 then
    raise exception '% Clockify member(s) are not yet mapped to an app member', v_unmapped_count;
  end if;

  with rows_to_commit as (
    select r.*, mm.resolved_user_id
    from import_rows r
    join import_member_map mm
      on mm.batch_id = r.batch_id and mm.clockify_name = r.member_name
    where r.batch_id = p_batch_id
      and r.status in ('approved', 'skipped')
      and r.ended_at is not null
  ),
  inserted as (
    insert into time_entries
      (workspace_id, user_id, description, started_at, ended_at, is_billable, content_item_id)
    select
      v_workspace_id, resolved_user_id, description, started_at, ended_at, is_billable,
      case when status = 'approved' then resolved_content_item_id else null end
    from rows_to_commit
    returning 1
  )
  select count(*) into v_inserted from inserted;

  update import_batches
    set status = 'committed', committed_at = now()
    where id = p_batch_id;

  return v_inserted;
end;
$$;

revoke execute on function commit_import_batch(uuid) from public, anon;
grant execute on function commit_import_batch(uuid) to authenticated;
