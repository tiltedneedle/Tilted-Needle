-- Phase 0: foundation schema.
--
-- The workspace is the tenant root, matching Clockify's own model and the
-- team's existing London / DXB / NOVA split. Nothing crosses a workspace
-- boundary except a user's identity.

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type workspace_role as enum ('owner', 'admin', 'manager', 'member', 'client');
create type seat_type     as enum ('full', 'limited');
create type task_status   as enum ('active', 'done');

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

create table profiles (
  id         uuid primary key references auth.users on delete cascade,
  full_name  text,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- Keep profiles in step with auth.users without a round trip from the client.
create function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

create table workspaces (
  id         uuid primary key default uuid_generate_v4(),
  name       text not null,
  slug       text not null unique,
  owner_id   uuid not null references auth.users on delete restrict,
  created_at timestamptz not null default now()
);

create table memberships (
  id           uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  role         workspace_role not null default 'member',
  seat         seat_type not null default 'full',
  -- Departed members are deactivated, never deleted: their tracked time is
  -- history and must survive them (PRD 7.4).
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index on memberships (user_id) where is_active;
create index on memberships (workspace_id) where is_active;

-- ---------------------------------------------------------------------------
-- RLS helpers
--
-- These MUST be security definer. A policy on memberships that selects from
-- memberships to check access recurses infinitely; routing the check through
-- a definer function bypasses RLS for that lookup and breaks the cycle.
-- ---------------------------------------------------------------------------

create function is_workspace_member(ws uuid)
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
  );
$$;

create function has_workspace_role(ws uuid, roles workspace_role[])
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
      and role = any(roles)
  );
$$;

-- Admin-or-better, the common write gate for shared workspace data.
create function can_manage_workspace(ws uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select has_workspace_role(ws, array['owner', 'admin', 'manager']::workspace_role[]);
$$;

-- ---------------------------------------------------------------------------
-- Core tracking entities
-- ---------------------------------------------------------------------------

create table clients (
  id           uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces on delete cascade,
  name         text not null,
  email        text,
  address      text,
  note         text,
  is_archived  boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (workspace_id, name)
);

create table projects (
  id           uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces on delete cascade,
  client_id    uuid references clients on delete set null,
  name         text not null,
  color        text not null default '#6366f1',
  is_billable  boolean not null default true,
  is_archived  boolean not null default false,
  estimate_hours numeric,
  created_at   timestamptz not null default now(),
  unique (workspace_id, name)
);

create index on projects (workspace_id) where not is_archived;
create index on projects (client_id);

create table tasks (
  id           uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces on delete cascade,
  project_id   uuid not null references projects on delete cascade,
  name         text not null,
  status       task_status not null default 'active',
  is_archived  boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (project_id, name)
);

create index on tasks (project_id) where not is_archived;

create table tags (
  id           uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces on delete cascade,
  name         text not null,
  is_archived  boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (workspace_id, name)
);

create table time_entries (
  id           uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  project_id   uuid references projects on delete set null,
  task_id      uuid references tasks on delete set null,
  -- Today this free-text field carries the video title by convention (PRD 7.5).
  -- Phase 2 adds video_id alongside it; the text stays so nothing breaks.
  description  text not null default '',
  started_at   timestamptz not null,
  -- null means the timer is still running.
  ended_at     timestamptz,
  is_billable  boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint ended_after_started check (ended_at is null or ended_at > started_at)
);

-- Stored so reports can aggregate without recomputing per row.
alter table time_entries
  add column duration_seconds integer
  generated always as (
    case when ended_at is null then null
         else extract(epoch from (ended_at - started_at))::integer end
  ) stored;

create index on time_entries (workspace_id, started_at desc);
create index on time_entries (user_id, started_at desc);
create index on time_entries (project_id);

-- At most one running timer per user per workspace.
create unique index one_running_timer_per_user
  on time_entries (workspace_id, user_id)
  where ended_at is null;

create table time_entry_tags (
  time_entry_id uuid not null references time_entries on delete cascade,
  tag_id        uuid not null references tags on delete cascade,
  primary key (time_entry_id, tag_id)
);

create function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger time_entries_touch
  before update on time_entries
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- The repository is public and the publishable key ships in the browser
-- bundle, so RLS is the only tenant boundary. Every table, no exceptions.
-- ---------------------------------------------------------------------------

alter table profiles        enable row level security;
alter table workspaces      enable row level security;
alter table memberships     enable row level security;
alter table clients         enable row level security;
alter table projects        enable row level security;
alter table tasks           enable row level security;
alter table tags            enable row level security;
alter table time_entries    enable row level security;
alter table time_entry_tags enable row level security;

-- profiles: read anyone you share a workspace with, write only yourself.
create policy profiles_select on profiles for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from memberships m_self
      join memberships m_other on m_other.workspace_id = m_self.workspace_id
      where m_self.user_id = auth.uid() and m_self.is_active
        and m_other.user_id = profiles.id and m_other.is_active
    )
  );
create policy profiles_update on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- workspaces
create policy workspaces_select on workspaces for select to authenticated
  using (is_workspace_member(id));
create policy workspaces_insert on workspaces for insert to authenticated
  with check (owner_id = auth.uid());
create policy workspaces_update on workspaces for update to authenticated
  using (has_workspace_role(id, array['owner', 'admin']::workspace_role[]));
create policy workspaces_delete on workspaces for delete to authenticated
  using (has_workspace_role(id, array['owner']::workspace_role[]));

-- memberships
create policy memberships_select on memberships for select to authenticated
  using (user_id = auth.uid() or is_workspace_member(workspace_id));
-- Bootstrap: the first membership is written by the workspace creator for
-- themselves, before any admin membership exists to authorise it.
create policy memberships_insert on memberships for insert to authenticated
  with check (
    can_manage_workspace(workspace_id)
    or (
      user_id = auth.uid()
      and exists (
        select 1 from workspaces w
        where w.id = workspace_id and w.owner_id = auth.uid()
      )
    )
  );
create policy memberships_update on memberships for update to authenticated
  using (can_manage_workspace(workspace_id));
create policy memberships_delete on memberships for delete to authenticated
  using (has_workspace_role(workspace_id, array['owner', 'admin']::workspace_role[]));

-- Shared workspace data: members read, managers write.
create policy clients_select on clients for select to authenticated
  using (is_workspace_member(workspace_id));
create policy clients_write on clients for all to authenticated
  using (can_manage_workspace(workspace_id))
  with check (can_manage_workspace(workspace_id));

create policy projects_select on projects for select to authenticated
  using (is_workspace_member(workspace_id));
create policy projects_write on projects for all to authenticated
  using (can_manage_workspace(workspace_id))
  with check (can_manage_workspace(workspace_id));

create policy tasks_select on tasks for select to authenticated
  using (is_workspace_member(workspace_id));
create policy tasks_write on tasks for all to authenticated
  using (can_manage_workspace(workspace_id))
  with check (can_manage_workspace(workspace_id));

create policy tags_select on tags for select to authenticated
  using (is_workspace_member(workspace_id));
create policy tags_write on tags for all to authenticated
  using (can_manage_workspace(workspace_id))
  with check (can_manage_workspace(workspace_id));

-- time_entries: members see and edit their own; managers see the whole
-- workspace (they have to, to run team reports and approve timesheets).
create policy time_entries_select on time_entries for select to authenticated
  using (
    (user_id = auth.uid() and is_workspace_member(workspace_id))
    or can_manage_workspace(workspace_id)
  );
create policy time_entries_insert on time_entries for insert to authenticated
  with check (user_id = auth.uid() and is_workspace_member(workspace_id));
create policy time_entries_update on time_entries for update to authenticated
  using (
    (user_id = auth.uid() and is_workspace_member(workspace_id))
    or can_manage_workspace(workspace_id)
  );
create policy time_entries_delete on time_entries for delete to authenticated
  using (
    (user_id = auth.uid() and is_workspace_member(workspace_id))
    or can_manage_workspace(workspace_id)
  );

create policy time_entry_tags_all on time_entry_tags for all to authenticated
  using (
    exists (
      select 1 from time_entries te
      where te.id = time_entry_id
        and (
          (te.user_id = auth.uid() and is_workspace_member(te.workspace_id))
          or can_manage_workspace(te.workspace_id)
        )
    )
  )
  with check (
    exists (
      select 1 from time_entries te
      where te.id = time_entry_id
        and (
          (te.user_id = auth.uid() and is_workspace_member(te.workspace_id))
          or can_manage_workspace(te.workspace_id)
        )
    )
  );

-- ---------------------------------------------------------------------------
-- Workspace bootstrap
--
-- Creating a workspace and its owner membership must be atomic; a failure
-- between the two would strand a workspace nobody can reach.
-- ---------------------------------------------------------------------------

create function create_workspace(ws_name text, ws_slug text)
returns workspaces
language plpgsql
security definer
set search_path = public
as $$
declare
  new_ws workspaces;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into workspaces (name, slug, owner_id)
  values (ws_name, ws_slug, auth.uid())
  returning * into new_ws;

  insert into memberships (workspace_id, user_id, role, seat)
  values (new_ws.id, auth.uid(), 'owner', 'full');

  return new_ws;
end;
$$;
