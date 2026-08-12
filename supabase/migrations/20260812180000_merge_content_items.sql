-- Merge the same video's separate rows into one.
--
-- The sync creates one content_item per discovered post per account, so a
-- video cross-posted to Instagram, TikTok and YouTube becomes THREE unrelated
-- rows. Each needs its own credits, each is scored separately, and the video
-- appears three times in every list. The data model already supports the
-- merged shape -- platform_posts holds one row per account under one item --
-- so merging is a matter of moving rows, not changing the schema.
--
-- WHY A DATABASE FUNCTION, and not a sequence of client calls.
--
--   1. content_assignments has SELECT, INSERT and DELETE policies and NO
--      UPDATE policy. Credits literally cannot be repointed through PostgREST.
--   2. A merge that dies halfway is worse than one that never ran: hours and
--      credits would be left pointing at a row about to be deleted, and
--      time_entries.content_item_id is ON DELETE SET NULL, so they would
--      silently detach rather than fail loudly.
--
-- One transaction, or nothing.

create table if not exists content_merges (
  id           uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces on delete cascade,
  survivor_id  uuid not null references content_items on delete cascade,
  loser_ids    uuid[] not null,
  -- Everything the merge destroyed or overwrote, verbatim. This is what makes
  -- the operation reversible: a tombstone would say WHAT vanished, the
  -- journal says exactly what it contained.
  journal      jsonb not null,
  merged_by    uuid references profiles on delete set null,
  merged_at    timestamptz not null default now(),
  undone_at    timestamptz
);

create index if not exists content_merges_ws_idx on content_merges (workspace_id, merged_at desc);

alter table content_merges enable row level security;

drop policy if exists merges_select on content_merges;
create policy merges_select on content_merges for select
  using (is_workspace_member(workspace_id));

-- No insert/update/delete policies on purpose: rows are written only by the
-- SECURITY DEFINER functions below, which do their own authorisation.

drop function if exists merge_content_items(uuid, uuid[], text, date, uuid, boolean);

create function merge_content_items(
  p_survivor uuid,
  p_losers uuid[],
  p_title text default null,
  p_produced_at date default null,
  p_client_id uuid default null,
  p_allow_client_change boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_actor uuid := auth.uid();
  v_journal jsonb := '{}'::jsonb;
  v_clash record;
  v_clients uuid[];
  v_keep_transcript uuid;
  v_merge_id uuid;
begin
  /* ---- Refusals, all BEFORE any write ---------------------------------- */

  if p_losers is null or array_length(p_losers, 1) is null then
    raise exception 'Nothing to merge.';
  end if;

  if p_survivor = any(p_losers) then
    raise exception 'A video cannot be merged into itself.';
  end if;

  -- A cross-posted video lives on two to five platforms. A twenty-row merge
  -- is not a big merge, it is a mistake, and it is unrecoverable by hand.
  if array_length(p_losers, 1) > 4 then
    raise exception 'Refusing to merge % videos at once. A cross-posted video has at most a few platforms; check the selection.', array_length(p_losers, 1) + 1;
  end if;

  select workspace_id into v_ws from content_items where id = p_survivor;
  if v_ws is null then
    raise exception 'The video being merged into no longer exists.';
  end if;

  if exists (
    select 1 from content_items
     where id = any(p_losers) and (workspace_id is distinct from v_ws)
  ) then
    raise exception 'All videos in a merge must belong to the same workspace.';
  end if;

  if (select count(*) from content_items where id = any(p_losers)) <> array_length(p_losers, 1) then
    raise exception 'One of the selected videos no longer exists. Refresh and try again.';
  end if;

  if not can_manage_workspace(v_ws) then
    raise exception 'Only a manager can merge videos.';
  end if;

  /* Two of the set posted to the SAME account.
     That is the one arrangement that is never a cross-post: a single account
     cannot hold the same video twice, so these are two different videos and
     merging them would silently pool the metrics of both. Refused by name so
     the message says which account, rather than leaving someone to guess. */
  select a.handle, a.platform_slug into v_clash
    from platform_posts p
    join accounts a on a.id = p.account_id
   where p.content_item_id = p_survivor or p.content_item_id = any(p_losers)
   group by a.handle, a.platform_slug, p.account_id
  having count(distinct p.content_item_id) > 1
   limit 1;
  if found then
    raise exception 'These are different videos: two of them are posted to the same account (@% on %). Merging would combine unrelated metrics.', v_clash.handle, v_clash.platform_slug;
  end if;

  /* Different clients is either a genuine reassignment or a serious mistake,
     and the function cannot tell which -- so it refuses unless told. */
  select array_agg(distinct client_id) into v_clients
    from content_items
   where (id = p_survivor or id = any(p_losers)) and client_id is not null;
  if array_length(v_clients, 1) > 1 and not p_allow_client_change then
    raise exception 'These videos belong to different clients. Confirm which client the merged video belongs to before continuing.';
  end if;

  /* ---- Journal everything that is about to be destroyed ----------------- */

  v_journal := jsonb_build_object(
    'items', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
                from content_items c where c.id = any(p_losers)),
    'survivor_before', (select to_jsonb(c) from content_items c where c.id = p_survivor),
    'assignments', (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
                      from content_assignments a where a.content_item_id = any(p_losers)),
    'posts', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'from', p.content_item_id)), '[]'::jsonb)
                from platform_posts p where p.content_item_id = any(p_losers)),
    -- {id, from} pairs, not bare ids. Recording only the id would tell undo
    -- that an hour moved but not where it moved FROM, and an undo that has to
    -- guess which video someone's time belongs to is not an undo.
    'time_entries', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'from', t.content_item_id)), '[]'::jsonb)
                       from time_entries t where t.content_item_id = any(p_losers)),
    'import_suggested', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'from', r.suggested_content_item_id)), '[]'::jsonb)
                           from import_rows r where r.suggested_content_item_id = any(p_losers)),
    'import_resolved', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'from', r.resolved_content_item_id)), '[]'::jsonb)
                          from import_rows r where r.resolved_content_item_id = any(p_losers)),
    'transcripts', (select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb)
                      from video_transcripts v where v.content_item_id = any(p_losers)),
    'analyses', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
                   from ai_analyses x
                  where x.subject_type = 'content_item' and x.subject_id = any(p_losers))
  );

  /* ---- Move rows. THE ORDER IS LOAD-BEARING. --------------------------- */

  -- 1. time_entries FIRST. ON DELETE SET NULL, so anything still pointing at
  --    a loser when it is deleted loses its link silently -- hours that were
  --    booked against real work, detached with no error.
  update time_entries set content_item_id = p_survivor
   where content_item_id = any(p_losers);

  -- 2. import_rows, for the same reason, and because commit_import_batch
  --    reads resolved_content_item_id when it writes the real time entries.
  update import_rows set suggested_content_item_id = p_survivor
   where suggested_content_item_id = any(p_losers);
  update import_rows set resolved_content_item_id = p_survivor
   where resolved_content_item_id = any(p_losers);

  -- 3. Transcripts: unique (content_item_id) allows exactly one. Keep the
  --    survivor's if it has one; otherwise the best loser's, preferring a
  --    hand-pasted transcript over machine ASR (which mangles names and
  --    brands), then the longest. Everything not kept is already journalled.
  select id into v_keep_transcript from video_transcripts where content_item_id = p_survivor;
  if v_keep_transcript is null then
    select id into v_keep_transcript
      from video_transcripts
     where content_item_id = any(p_losers)
     order by (source = 'manual') desc, length(coalesce(full_text, '')) desc
     limit 1;
    if v_keep_transcript is not null then
      update video_transcripts set content_item_id = p_survivor where id = v_keep_transcript;
    end if;
  end if;
  delete from video_transcripts
   where content_item_id = any(p_losers)
     and (v_keep_transcript is null or id <> v_keep_transcript);

  -- 4. Credits: insert-then-delete, never UPDATE -- there is no UPDATE policy
  --    on this table, and a duplicate (item,user,role) would violate the
  --    unique constraint. A manual credit beats a derived one on conflict.
  insert into content_assignments (workspace_id, content_item_id, user_id, role_id, source)
  select a.workspace_id, p_survivor, a.user_id, a.role_id, a.source
    from content_assignments a
   where a.content_item_id = any(p_losers)
  on conflict (content_item_id, user_id, role_id) do update
    set source = 'manual'
   where content_assignments.source = 'derived' and excluded.source = 'manual';

  delete from content_assignments where content_item_id = any(p_losers);

  -- 5. The posts themselves. Snapshots, analytics, comments and replay maps
  --    all key off platform_post_id, so they travel with the post untouched.
  update platform_posts set content_item_id = p_survivor
   where content_item_id = any(p_losers);

  -- 6. AI analyses are archived and dropped rather than repointed: each one
  --    describes the video it was written about, and its unique key includes
  --    an input_digest that no longer matches the merged item. Repointing
  --    would attach stale prose to a video it does not describe.
  delete from ai_analyses
   where subject_type = 'content_item' and subject_id = any(p_losers);

  -- 7. Queued work for rows about to vanish. Terminal rows stay as history.
  delete from ingest_jobs
   where subject_id = any(p_losers)
     and status in ('pending', 'running');

  /* ---- Survivorship on the survivor ------------------------------------ */

  update content_items c set
    -- Explicit pick when given: the sync writes each platform's own caption,
    -- so there is no defensible automatic winner.
    title = coalesce(nullif(btrim(p_title), ''), c.title),
    -- EARLIEST, not the survivor's. Cross-posting later does not change when
    -- the video was produced, and taking the survivor's date can push the
    -- merged row out of a date filter it belonged in.
    produced_at = least(
      c.produced_at,
      (select min(l.produced_at) from content_items l where l.id = any(p_losers))
    ),
    client_id = case when p_allow_client_change then p_client_id else c.client_id end,
    -- Backfill only. Never overwrite something the survivor already says.
    subject = coalesce(c.subject, (select l.subject from content_items l
                                    where l.id = any(p_losers) and l.subject is not null limit 1)),
    hook = coalesce(c.hook, (select l.hook from content_items l
                              where l.id = any(p_losers) and l.hook is not null limit 1)),
    music_used = coalesce(c.music_used, (select l.music_used from content_items l
                                          where l.id = any(p_losers) and l.music_used is not null limit 1)),
    description = coalesce(c.description, (select l.description from content_items l
                                            where l.id = any(p_losers) and l.description is not null limit 1)),
    length_seconds = coalesce(c.length_seconds, (select l.length_seconds from content_items l
                                                  where l.id = any(p_losers) and l.length_seconds is not null limit 1))
  where c.id = p_survivor;

  -- 8. The losers are gone. Their posts, hours and credits already moved.
  delete from content_items where id = any(p_losers);

  insert into content_merges (workspace_id, survivor_id, loser_ids, journal, merged_by)
  values (v_ws, p_survivor, p_losers, v_journal, v_actor)
  returning id into v_merge_id;

  return v_merge_id;
end;
$$;

revoke all on function merge_content_items(uuid, uuid[], text, date, uuid, boolean) from public, anon;
grant execute on function merge_content_items(uuid, uuid[], text, date, uuid, boolean) to authenticated;

/* ---------------------------------------------------------------------------
   Undo.

   Re-inserts the loser rows WITH THEIR ORIGINAL UUIDS and reverses every
   movement the journal recorded. It deliberately does NOT revert edits made
   to the survivor after the merge -- those are somebody's later work, and
   silently discarding them would be a second destructive act dressed as a
   rescue. The UI says so before anyone presses it.
--------------------------------------------------------------------------- */
drop function if exists undo_content_merge(uuid);

create function undo_content_merge(p_merge_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  rec jsonb;
begin
  select * into m from content_merges where id = p_merge_id;
  if not found then
    raise exception 'That merge does not exist.';
  end if;
  if not can_manage_workspace(m.workspace_id) then
    raise exception 'Only a manager can undo a merge.';
  end if;
  if m.undone_at is not null then
    raise exception 'That merge has already been undone.';
  end if;
  if not exists (select 1 from content_items where id = m.survivor_id) then
    raise exception 'The merged video has since been deleted; this merge cannot be undone.';
  end if;

  -- Recreate the losers with their original ids, so every journalled
  -- reference below resolves.
  for rec in select * from jsonb_array_elements(m.journal -> 'items') loop
    insert into content_items (
      id, workspace_id, client_id, title, subject, hook, music_used,
      length_seconds, produced_at, notes, description, topic_labels,
      review_state, reviewed_at, reviewed_by, created_at
    )
    values (
      (rec ->> 'id')::uuid,
      (rec ->> 'workspace_id')::uuid,
      nullif(rec ->> 'client_id', '')::uuid,
      rec ->> 'title',
      rec ->> 'subject',
      rec ->> 'hook',
      rec ->> 'music_used',
      nullif(rec ->> 'length_seconds', '')::integer,
      nullif(rec ->> 'produced_at', '')::date,
      rec ->> 'notes',
      rec ->> 'description',
      case when rec -> 'topic_labels' = 'null'::jsonb then null
           else (select array_agg(value #>> '{}') from jsonb_array_elements(rec -> 'topic_labels')) end,
      coalesce(rec ->> 'review_state', 'approved'),
      nullif(rec ->> 'reviewed_at', '')::timestamptz,
      nullif(rec ->> 'reviewed_by', '')::uuid,
      nullif(rec ->> 'created_at', '')::timestamptz
    )
    on conflict (id) do nothing;
  end loop;

  -- Posts back to the item they came from.
  for rec in select * from jsonb_array_elements(m.journal -> 'posts') loop
    update platform_posts
       set content_item_id = (rec ->> 'from')::uuid
     where id = (rec ->> 'id')::uuid;
  end loop;

  -- Credits: remove the merged copies, restore the originals verbatim.
  delete from content_assignments
   where content_item_id = m.survivor_id
     and (user_id, role_id) in (
       select (a ->> 'user_id')::uuid, (a ->> 'role_id')::uuid
         from jsonb_array_elements(m.journal -> 'assignments') a
     );

  for rec in select * from jsonb_array_elements(m.journal -> 'assignments') loop
    insert into content_assignments (id, workspace_id, content_item_id, user_id, role_id, source, created_at)
    values (
      (rec ->> 'id')::uuid,
      (rec ->> 'workspace_id')::uuid,
      (rec ->> 'content_item_id')::uuid,
      (rec ->> 'user_id')::uuid,
      (rec ->> 'role_id')::uuid,
      coalesce(rec ->> 'source', 'manual'),
      nullif(rec ->> 'created_at', '')::timestamptz
    )
    on conflict do nothing;
  end loop;

  -- Transcripts back where they were.
  delete from video_transcripts
   where content_item_id = m.survivor_id
     and id in (select (t ->> 'id')::uuid from jsonb_array_elements(m.journal -> 'transcripts') t);
  for rec in select * from jsonb_array_elements(m.journal -> 'transcripts') loop
    -- Every column, including segments and source_post_id: a transcript
    -- restored without its timings is a different, worse transcript, and the
    -- loss would be invisible until someone tried to use them.
    insert into video_transcripts (
      id, workspace_id, content_item_id, source_post_id, source, language,
      is_generated, full_text, segments, fetched_at, created_at
    )
    values (
      (rec ->> 'id')::uuid,
      (rec ->> 'workspace_id')::uuid,
      (rec ->> 'content_item_id')::uuid,
      nullif(rec ->> 'source_post_id', '')::uuid,
      rec ->> 'source',
      rec ->> 'language',
      nullif(rec ->> 'is_generated', '')::boolean,
      rec ->> 'full_text',
      rec -> 'segments',
      nullif(rec ->> 'fetched_at', '')::timestamptz,
      nullif(rec ->> 'created_at', '')::timestamptz
    )
    on conflict (content_item_id) do nothing;
  end loop;

  /* Hours and import rows back to the exact video they were booked against.
     Only the rows the journal recorded as having MOVED are sent back --
     anything logged against the survivor since the merge stays put, because
     it was booked against the merged video deliberately. */
  for rec in select * from jsonb_array_elements(m.journal -> 'time_entries') loop
    update time_entries set content_item_id = (rec ->> 'from')::uuid
     where id = (rec ->> 'id')::uuid;
  end loop;

  for rec in select * from jsonb_array_elements(m.journal -> 'import_suggested') loop
    update import_rows set suggested_content_item_id = (rec ->> 'from')::uuid
     where id = (rec ->> 'id')::uuid;
  end loop;

  for rec in select * from jsonb_array_elements(m.journal -> 'import_resolved') loop
    update import_rows set resolved_content_item_id = (rec ->> 'from')::uuid
     where id = (rec ->> 'id')::uuid;
  end loop;

  update content_items c
     set title = m.journal -> 'survivor_before' ->> 'title',
         produced_at = nullif(m.journal -> 'survivor_before' ->> 'produced_at', '')::date,
         client_id = nullif(m.journal -> 'survivor_before' ->> 'client_id', '')::uuid
   where c.id = m.survivor_id;

  update content_merges set undone_at = now() where id = p_merge_id;
end;
$$;

revoke all on function undo_content_merge(uuid) from public, anon;
grant execute on function undo_content_merge(uuid) to authenticated;

comment on function merge_content_items(uuid, uuid[], text, date, uuid, boolean) is
  'Merges cross-posted duplicates into one video, in a single transaction. '
  'Refuses when two of the set share an account (they are different videos), '
  'when clients differ without explicit confirmation, or when more than five '
  'rows are selected. Everything destroyed is journalled into content_merges '
  'so undo_content_merge can reverse it.';
