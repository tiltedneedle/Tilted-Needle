-- Ready for the first client users.
--
-- Team admin is about to be able to invite a client's own people (the
-- Client role, bound to one client), and they will also sign in to the
-- client system portal with the same account. Until now the role existed
-- only in tests: "the workspace has no client users at all". A client user
-- holds a real session and the publishable key ships in every browser, so
-- whatever row-level security allows them, they can read with a plain REST
-- call, whatever the app's pages show. Every policy in force was read with
-- that person in mind (145 policies, 73 tables). These are the ones that
-- let them further than their own client:
--
--   1. content_merges: readable by any workspace member, and its journal is
--      every merged video's contents verbatim, for every client.
--   2. expenses: "user_id = auth.uid() and is_workspace_member" lets a
--      client file, edit and delete expenses in the agency's books.
--   3. claim_transcription_budget / refund_transcription_budget: SECURITY
--      DEFINER with no check on the caller, and executable by anyone. Only
--      the worker calls them, as the service role.
--   4. set_client_membership: the function that makes someone a client
--      user upserts over ANY existing membership, so a manager could turn
--      the owner (or any colleague) into a client with one call, and it
--      never checked that the client belongs to the workspace.
--
-- Left as they are, deliberately: workspaces_select (a member may read
-- their own workspace's row), and the three "using (true)" tables
-- (platforms, scrape_schedule, worker_heartbeat), which hold no client data.

-- 1 -------------------------------------------------------------------------
drop policy if exists merges_select on content_merges;
create policy merges_select on content_merges for select
  using (is_workspace_member(workspace_id) and not is_client_user(workspace_id));

-- 2 -------------------------------------------------------------------------
-- Members file and see their own expenses; managers see everything; a
-- client user has no part in the agency's expenses at all.
drop policy if exists expenses_select on expenses;
create policy expenses_select on expenses for select to authenticated
  using (
    not is_client_user(workspace_id)
    and (
      (user_id = auth.uid() and is_workspace_member(workspace_id))
      or can_manage_workspace(workspace_id)
    )
  );

drop policy if exists expenses_insert on expenses;
create policy expenses_insert on expenses for insert to authenticated
  with check (
    user_id = auth.uid()
    and is_workspace_member(workspace_id)
    and not is_client_user(workspace_id)
  );

drop policy if exists expenses_update on expenses;
create policy expenses_update on expenses for update to authenticated
  using (
    not is_client_user(workspace_id)
    and (
      (user_id = auth.uid() and is_workspace_member(workspace_id) and invoice_id is null)
      or can_manage_workspace(workspace_id)
    )
  );

drop policy if exists expenses_delete on expenses;
create policy expenses_delete on expenses for delete to authenticated
  using (
    not is_client_user(workspace_id)
    and (
      (user_id = auth.uid() and is_workspace_member(workspace_id) and invoice_id is null)
      or can_manage_workspace(workspace_id)
    )
  );

-- 3 -------------------------------------------------------------------------
-- The worker spends and refunds this budget as the service role. Nobody
-- with a browser session has any business calling either.
revoke execute on function claim_transcription_budget(uuid, bigint) from public, anon, authenticated;
grant execute on function claim_transcription_budget(uuid, bigint) to service_role;
revoke execute on function refund_transcription_budget(uuid, bigint) from public, anon, authenticated;
grant execute on function refund_transcription_budget(uuid, bigint) to service_role;

-- 4 -------------------------------------------------------------------------
-- Making someone a client user: a manager's act, on a person who is not
-- already staff here, for a client of this workspace. It may move a client
-- user from one client to another; it may not turn staff into a client
-- (that would be a demotion by the back door, the owner included), and
-- nobody does it to themselves.
create or replace function set_client_membership(
  ws uuid,
  target_user uuid,
  target_client uuid
)
returns memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  result memberships;
  existing_role workspace_role;
begin
  if not can_manage_workspace(ws) then
    raise exception 'insufficient privileges';
  end if;

  if target_user = auth.uid() then
    raise exception 'You cannot make yourself a client user.';
  end if;

  if not exists (
    select 1 from clients c
    where c.id = target_client
      and c.workspace_id = ws
      and c.deleted_at is null
  ) then
    raise exception 'That client is not in this workspace.';
  end if;

  select role into existing_role
  from memberships
  where workspace_id = ws and user_id = target_user;

  if found and existing_role <> 'client' then
    raise exception 'That person is already in this workspace as %. Remove them from the team first.', existing_role;
  end if;

  insert into memberships (workspace_id, user_id, role, seat, client_id, weekly_capacity_hours)
  values (ws, target_user, 'client', 'limited', target_client, 0)
  on conflict (workspace_id, user_id)
    do update set client_id = excluded.client_id
  returning * into result;

  return result;
end;
$$;

comment on function set_client_membership(uuid, uuid, uuid) is
  'Makes a person a client user of one client in this workspace (role client, limited seat, no capacity). Managers only; never over an existing staff membership, never on yourself, and only for a client of this workspace.';
