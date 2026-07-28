-- commit_import_batch counted "unmapped members" only as rows in
-- import_member_map with resolved_user_id null. If a member had staged
-- import_rows but NO import_member_map row at all -- the caller simply
-- never created one -- the count was zero, the block never fired, and the
-- join in the commit query silently produced no rows for that member: their
-- hours were dropped without any error, the exact silent-data-loss failure
-- mode this feature exists to prevent. Found by testing a row with no
-- corresponding member-map entry, not by reviewing the code.
--
-- Fixed by counting every distinct member_name present in the batch's rows
-- against import_member_map, rather than only member_map rows that already
-- exist.

create or replace function commit_import_batch(p_batch_id uuid)
returns integer
language plpgsql
security invoker
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
  if v_status = 'committed' then
    raise exception 'this batch has already been committed';
  end if;

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
