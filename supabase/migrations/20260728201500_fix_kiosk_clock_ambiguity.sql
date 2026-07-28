-- kiosk_clock's RETURNS TABLE declared an output column named `user_id`,
-- which collides with the `user_id` column on both `memberships` and
-- `time_entries` referenced inside the function body. PL/pgSQL's default
-- variable_conflict setting treats that as an error rather than silently
-- picking one, so every call failed with "column reference user_id is
-- ambiguous" -- caught by actually invoking the function, not by review.

-- CREATE OR REPLACE cannot change a function's return type, and renaming a
-- RETURNS TABLE column counts as changing it -- the function must be
-- dropped first.
drop function if exists kiosk_clock(text, text, numeric, numeric);

create function kiosk_clock(
  p_device_token text,
  p_pin_hash text,
  p_latitude numeric default null,
  p_longitude numeric default null
)
returns table (action text, clocked_user_id uuid, entry_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  k kiosks;
  m memberships;
  open_entry time_entries;
begin
  select * into k from kiosks
    where device_token = p_device_token and is_active
    limit 1;
  if k.id is null then
    raise exception 'invalid or inactive kiosk device';
  end if;

  select * into m from memberships
    where workspace_id = k.workspace_id
      and kiosk_pin_hash = p_pin_hash
      and is_active
    limit 1;
  if m.id is null then
    raise exception 'pin not recognised';
  end if;

  select * into open_entry from time_entries te
    where te.workspace_id = k.workspace_id
      and te.user_id = m.user_id
      and te.ended_at is null
    limit 1;

  if open_entry.id is not null then
    update time_entries set ended_at = now()
      where id = open_entry.id;
    return query select 'clock_out'::text, m.user_id, open_entry.id;
  else
    insert into time_entries
      (workspace_id, user_id, project_id, kiosk_id, description, started_at, latitude, longitude)
    values
      (k.workspace_id, m.user_id, k.project_id, k.id, 'Kiosk clock-in', now(), p_latitude, p_longitude)
    returning id into open_entry;
    return query select 'clock_in'::text, m.user_id, open_entry.id;
  end if;
end;
$$;

revoke execute on function kiosk_clock(text, text, numeric, numeric) from authenticated, anon;
grant execute on function kiosk_clock(text, text, numeric, numeric) to service_role;
