-- Fixes purge_deleted_clients, which could never delete anything.
--
-- The function declared RETURNS TABLE (client_id uuid, ...). In plpgsql that
-- creates an OUT parameter named client_id, which then collides with the
-- column of the same name inside the body:
--
--     delete from content_items where client_id = c.id;
--                                     ^^^^^^^^^
--     ERROR: column reference "client_id" is ambiguous
--
-- The whole function raised, so every purge failed. It looked healthy from the
-- outside: the migration applied, the function existed, and the sync route
-- swallows purge errors on purpose so that housekeeping cannot abort a metrics
-- run. A binned client would simply have sat there forever, with the UI
-- counting down to a deletion that was never going to happen.
--
-- Two changes, either of which would have been enough; both applied because
-- this function deletes data and should not rely on a subtlety:
--   1. The OUT parameters are renamed with a purged_ prefix, so no output name
--      can shadow a column.
--   2. The DELETE qualifies its column as content_items.client_id.

drop function if exists purge_deleted_clients(integer);

create or replace function purge_deleted_clients(p_grace_days integer default 7)
returns TABLE (purged_client_id uuid, purged_client_name text, purged_items integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  n integer;
begin
  if p_grace_days < 1 then
    raise exception 'grace window must be at least one day, got %', p_grace_days;
  end if;

  for c in
    select clients.id, clients.name
    from clients
    where clients.deleted_at is not null
      and clients.deleted_at < now() - make_interval(days => p_grace_days)
  loop
    -- Content first, and explicitly. The FK is ON DELETE SET NULL, so removing
    -- the client alone would leave every video behind with a null client --
    -- orphaned and unreachable. platform_posts and post_snapshots cascade from
    -- content_items, so they go with it.
    delete from content_items where content_items.client_id = c.id;
    get diagnostics n = row_count;

    -- Accounts are unlinked rather than deleted: an account is a connection to
    -- a real social profile and may be reassigned. The FK's SET NULL is the
    -- correct behaviour and is left to do its job.
    delete from clients where clients.id = c.id;

    purged_client_id := c.id;
    purged_client_name := c.name;
    purged_items := n;
    return next;
  end loop;
end;
$$;

comment on function purge_deleted_clients(integer) is
  'Permanently removes clients binned more than p_grace_days ago, and all of '
  'their content. Returns one row per client purged. Called from the sync '
  'route so it runs on the same cadence as everything else.';

revoke all on function purge_deleted_clients(integer) from public;
revoke all on function purge_deleted_clients(integer) from anon;
revoke all on function purge_deleted_clients(integer) from authenticated;
