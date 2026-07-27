-- Phase 5: the client portal.
--
-- Until now every read policy granted access on is_workspace_member() alone.
-- That was correct while only staff had logins, but a client-role member would
-- have seen every other client's content, and all internal time and cost data.
-- This migration binds client users to a single client and tightens every
-- policy they can reach.
--
-- The rule: a client user sees their own content and its published metrics.
-- Nothing about time, money, staffing, or any other client.

alter table memberships
  add column client_id uuid references clients on delete cascade;

-- A client-role membership without a client would see nothing (or, if a
-- policy were ever written loosely, everything). Make the pairing mandatory.
alter table memberships
  add constraint client_role_requires_client
  check (role <> 'client' or client_id is not null);

create index on memberships (client_id) where client_id is not null;

-- ---------------------------------------------------------------------------
-- Helpers
--
-- security definer for the same reason as is_workspace_member: a policy on a
-- table that reads memberships to authorise itself would recurse.
-- ---------------------------------------------------------------------------

create function is_client_user(ws uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from memberships
    where workspace_id = ws
      and user_id = auth.uid()
      and is_active
      and role = 'client'
  );
$$;

create function my_client_id(ws uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select client_id from memberships
  where workspace_id = ws
    and user_id = auth.uid()
    and is_active
    and role = 'client'
  limit 1;
$$;

/*
 * True when the current user may read rows belonging to `target_client`.
 *
 * Staff see every client. A client user sees only their own. Written so the
 * staff path short-circuits before touching the client lookup.
 */
create function can_read_client(ws uuid, target_client uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    case
      when not is_workspace_member(ws) then false
      when not is_client_user(ws) then true
      else target_client is not null and target_client = my_client_id(ws)
    end;
$$;

-- ---------------------------------------------------------------------------
-- Tighten the policies a client user can reach
-- ---------------------------------------------------------------------------

-- Clients: only their own row.
drop policy clients_select on clients;
create policy clients_select on clients for select to authenticated
  using (can_read_client(workspace_id, id));

-- Projects: staff see all; clients see only projects billed to them.
drop policy projects_select on projects;
create policy projects_select on projects for select to authenticated
  using (can_read_client(workspace_id, client_id));

-- Accounts: the handles publishing this client's content.
drop policy accounts_select on accounts;
create policy accounts_select on accounts for select to authenticated
  using (can_read_client(workspace_id, client_id));

-- Content: the heart of the portal.
drop policy content_select on content_items;
create policy content_select on content_items for select to authenticated
  using (can_read_client(workspace_id, client_id));

-- Client users are read-only. Writing is staff work.
drop policy content_insert on content_items;
create policy content_insert on content_items for insert to authenticated
  with check (is_workspace_member(workspace_id) and not is_client_user(workspace_id));

drop policy content_update on content_items;
create policy content_update on content_items for update to authenticated
  using (is_workspace_member(workspace_id) and not is_client_user(workspace_id));

-- Posts and snapshots inherit their content item's client. The EXISTS is a
-- primary-key lookup per row, which the planner handles cheaply.
drop policy posts_select on platform_posts;
create policy posts_select on platform_posts for select to authenticated
  using (
    exists (
      select 1 from content_items ci
      where ci.id = platform_posts.content_item_id
        and can_read_client(ci.workspace_id, ci.client_id)
    )
  );

drop policy posts_insert on platform_posts;
create policy posts_insert on platform_posts for insert to authenticated
  with check (is_workspace_member(workspace_id) and not is_client_user(workspace_id));

drop policy posts_update on platform_posts;
create policy posts_update on platform_posts for update to authenticated
  using (is_workspace_member(workspace_id) and not is_client_user(workspace_id));

drop policy snapshots_select on post_snapshots;
create policy snapshots_select on post_snapshots for select to authenticated
  using (
    exists (
      select 1
      from platform_posts pp
      join content_items ci on ci.id = pp.content_item_id
      where pp.id = post_snapshots.platform_post_id
        and can_read_client(ci.workspace_id, ci.client_id)
    )
  );

drop policy snapshots_insert on post_snapshots;
create policy snapshots_insert on post_snapshots for insert to authenticated
  with check (is_workspace_member(workspace_id) and not is_client_user(workspace_id));

-- ---------------------------------------------------------------------------
-- Deny the internal tables outright
--
-- Time, staffing, and role definitions are none of a client's business. These
-- carry no client_id to scope by, so the check is simply "not a client".
-- ---------------------------------------------------------------------------

drop policy time_entries_select on time_entries;
create policy time_entries_select on time_entries for select to authenticated
  using (
    not is_client_user(workspace_id)
    and (
      (user_id = auth.uid() and is_workspace_member(workspace_id))
      or can_manage_workspace(workspace_id)
    )
  );

drop policy time_entries_insert on time_entries;
create policy time_entries_insert on time_entries for insert to authenticated
  with check (
    user_id = auth.uid()
    and is_workspace_member(workspace_id)
    and not is_client_user(workspace_id)
  );

drop policy assignments_select on content_assignments;
create policy assignments_select on content_assignments for select to authenticated
  using (is_workspace_member(workspace_id) and not is_client_user(workspace_id));

drop policy assignments_insert on content_assignments;
create policy assignments_insert on content_assignments for insert to authenticated
  with check (is_workspace_member(workspace_id) and not is_client_user(workspace_id));

drop policy assignments_delete on content_assignments;
create policy assignments_delete on content_assignments for delete to authenticated
  using (is_workspace_member(workspace_id) and not is_client_user(workspace_id));

drop policy roles_select on roles;
create policy roles_select on roles for select to authenticated
  using (is_workspace_member(workspace_id) and not is_client_user(workspace_id));

drop policy tags_select on tags;
create policy tags_select on tags for select to authenticated
  using (is_workspace_member(workspace_id) and not is_client_user(workspace_id));

drop policy tasks_select on tasks;
create policy tasks_select on tasks for select to authenticated
  using (is_workspace_member(workspace_id) and not is_client_user(workspace_id));

-- Membership rows expose the staff roster. A client sees only their own.
drop policy memberships_select on memberships;
create policy memberships_select on memberships for select to authenticated
  using (
    user_id = auth.uid()
    or (is_workspace_member(workspace_id) and not is_client_user(workspace_id))
  );

-- Profiles: the existing policy reveals everyone sharing a workspace. A client
-- must not enumerate the team.
drop policy profiles_select on profiles;
create policy profiles_select on profiles for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from memberships m_self
      join memberships m_other on m_other.workspace_id = m_self.workspace_id
      where m_self.user_id = auth.uid()
        and m_self.is_active
        and m_self.role <> 'client'
        and m_other.user_id = profiles.id
        and m_other.is_active
    )
  );

-- Invoices, expenses, rates, and project_members are already manager-only,
-- and can_manage_workspace() never returns true for a client role.

-- ---------------------------------------------------------------------------
-- Inviting a client user
-- ---------------------------------------------------------------------------

create function set_client_membership(
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
begin
  if not can_manage_workspace(ws) then
    raise exception 'insufficient privileges';
  end if;

  insert into memberships (workspace_id, user_id, role, seat, client_id)
  values (ws, target_user, 'client', 'limited', target_client)
  on conflict (workspace_id, user_id)
    do update set role = 'client', seat = 'limited', client_id = excluded.client_id
  returning * into result;

  return result;
end;
$$;
