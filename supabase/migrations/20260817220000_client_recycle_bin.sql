-- A recycle bin for clients: 7 days to change your mind, then a real purge.
--
-- WHY A THIRD STATE
--
-- Until now a client was either active or archived, and archived is not
-- delete: an archived client still exists, still owns its content, and still
-- appears wherever the UI deliberately shows inactive work. There was no way
-- to say "this was a mistake, remove it".
--
-- Delete could not simply be `delete from clients`. All three client_id
-- foreign keys are ON DELETE SET NULL, so a hard delete would leave the
-- content behind with a null client -- silently orphaned, indistinguishable
-- from a video nobody has assigned yet, and unrecoverable because the link is
-- what got erased. That is the opposite of a recycle bin.
--
-- So: deleted_at marks the row, and NOTHING else moves. content_items keep
-- pointing at the client, which is what makes restore a single column update
-- rather than a journal that has to be replayed. The read layer treats a
-- deleted client's content as unassigned; the data still knows.
--
-- AFTER THE GRACE WINDOW, everything goes -- the client and all its content,
-- as intended. That has to be explicit for the same reason: SET NULL would
-- keep the videos. purge_deleted_clients deletes the content first, letting
-- platform_posts and post_snapshots cascade from it, then the client.

alter table clients
  add column if not exists deleted_at timestamptz;

comment on column clients.deleted_at is
  'When this client was moved to the recycle bin. Null = live. Purged for good '
  '7 days later by purge_deleted_clients().';

-- Partial index: the bin is nearly always empty, so indexing only the deleted
-- rows keeps this small and makes "what is in the bin" a fast lookup.
create index if not exists clients_deleted_idx
  on clients (workspace_id, deleted_at)
  where deleted_at is not null;

-- ---------------------------------------------------------------------------
-- The purge
-- ---------------------------------------------------------------------------

create or replace function purge_deleted_clients(p_grace_days integer default 7)
returns TABLE (client_id uuid, client_name text, items_deleted integer)
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
    select id, name
    from clients
    where deleted_at is not null
      and deleted_at < now() - make_interval(days => p_grace_days)
  loop
    -- Content first, and explicitly. The FK is ON DELETE SET NULL, so
    -- removing the client alone would leave every video behind with a null
    -- client -- which is exactly the orphaning this design exists to avoid.
    -- platform_posts and post_snapshots hang off content_items and cascade
    -- from here.
    delete from content_items where client_id = c.id;
    get diagnostics n = row_count;

    -- Accounts are NOT deleted with the client, only unlinked. An account is a
    -- connection to a real social profile and may be reassigned; the FK's SET
    -- NULL is the right behaviour here and is left to do its job.
    delete from clients where id = c.id;

    client_id := c.id;
    client_name := c.name;
    items_deleted := n;
    return next;
  end loop;
end;
$$;

comment on function purge_deleted_clients(integer) is
  'Permanently removes clients binned more than p_grace_days ago, and all of '
  'their content. Returns one row per client purged. Called from the sync '
  'route so it runs on the same cadence as everything else.';

-- Service role only. This is the one function in the schema that destroys
-- data on purpose, so it must not be reachable from a user session -- the
-- app calls it from the sync route, which already runs with the service role
-- behind a shared secret.
revoke all on function purge_deleted_clients(integer) from public;
revoke all on function purge_deleted_clients(integer) from anon;
revoke all on function purge_deleted_clients(integer) from authenticated;
