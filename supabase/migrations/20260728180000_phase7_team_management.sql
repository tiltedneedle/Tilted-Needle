-- Phase 7: approvals, time off, groups, capacity.
--
-- Scope note: "granular per-resource permissions" from the PRD is trimmed to
-- role-based access (already in place since Phase 0) plus groups for
-- organizing and filtering members -- the Team page screenshot showed a
-- GROUPS tab, which is what this actually builds. A full per-resource ACL
-- matrix is a materially larger feature (a permissions editor UI, checks on
-- every table) and is left for a dedicated pass rather than bolted on here.
--
-- Scheduling is similarly trimmed to weekly capacity vs. tracked hours,
-- not a drag-and-drop assignment calendar -- that is a scheduling *system*,
-- this is the number a manager actually needs day to day.

-- ---------------------------------------------------------------------------
-- Groups
-- ---------------------------------------------------------------------------

create table user_groups (
  id           uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces on delete cascade,
  name         text not null,
  created_at   timestamptz not null default now(),
  unique (workspace_id, name)
);

create table user_group_members (
  group_id uuid not null references user_groups on delete cascade,
  user_id  uuid not null references profiles on delete cascade,
  primary key (group_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Capacity
-- ---------------------------------------------------------------------------

alter table memberships
  add column weekly_capacity_hours numeric not null default 40;

-- ---------------------------------------------------------------------------
-- Timesheet approvals
--
-- A submission covers one person, one week. Locking works by checking for an
-- approved submission that covers the entry's date -- there is no separate
-- "locked" flag to fall out of sync with the approval it should mirror.
-- ---------------------------------------------------------------------------

create table timesheet_submissions (
  id            uuid primary key default uuid_generate_v4(),
  workspace_id  uuid not null references workspaces on delete cascade,
  user_id       uuid not null references profiles on delete cascade,
  period_start  date not null,
  period_end    date not null,
  status        text not null default 'submitted', -- submitted | approved | rejected
  note          text,
  submitted_at  timestamptz not null default now(),
  reviewed_by   uuid references profiles on delete set null,
  reviewed_at   timestamptz,
  review_note   text,
  unique (workspace_id, user_id, period_start)
);

create index on timesheet_submissions (workspace_id, user_id);

create function is_period_locked(ws uuid, target_user uuid, entry_date date)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from timesheet_submissions
    where workspace_id = ws
      and user_id = target_user
      and status = 'approved'
      and entry_date between period_start and period_end
  );
$$;

-- Editing or deleting a locked entry now requires a manager -- an approved
-- week is meant to be a closed number, not one that quietly drifts after
-- payroll or a client invoice has been built from it.
drop policy time_entries_update on time_entries;
create policy time_entries_update on time_entries for update to authenticated
  using (
    not is_client_user(workspace_id)
    and (
      can_manage_workspace(workspace_id)
      or (
        user_id = auth.uid()
        and is_workspace_member(workspace_id)
        and not is_period_locked(workspace_id, user_id, (started_at at time zone 'utc')::date)
      )
    )
  );

drop policy time_entries_delete on time_entries;
create policy time_entries_delete on time_entries for delete to authenticated
  using (
    not is_client_user(workspace_id)
    and (
      can_manage_workspace(workspace_id)
      or (
        user_id = auth.uid()
        and is_workspace_member(workspace_id)
        and not is_period_locked(workspace_id, user_id, (started_at at time zone 'utc')::date)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Time off
-- ---------------------------------------------------------------------------

create table time_off_policies (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references workspaces on delete cascade,
  name            text not null,
  days_per_year   numeric not null default 0,
  requires_approval boolean not null default true,
  is_archived     boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (workspace_id, name)
);

create table holidays (
  id           uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces on delete cascade,
  name         text not null,
  observed_on  date not null
);

create index on holidays (workspace_id, observed_on);

create table time_off_requests (
  id           uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces on delete cascade,
  user_id      uuid not null references profiles on delete cascade,
  policy_id    uuid not null references time_off_policies on delete restrict,
  start_date   date not null,
  end_date     date not null,
  hours        numeric not null,
  status       text not null default 'pending', -- pending | approved | rejected | cancelled
  note         text,
  reviewed_by  uuid references profiles on delete set null,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  constraint end_after_start check (end_date >= start_date)
);

create index on time_off_requests (workspace_id, user_id);

-- Balance is derived, not stored: allocation minus approved hours taken this
-- year. A stored running balance drifts the moment a request is edited or
-- cancelled after the fact; this recomputes from source every time instead.
create function time_off_balance(p_workspace uuid, p_user uuid, p_policy uuid, p_year int)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce((select days_per_year * 8 from time_off_policies
              where id = p_policy and workspace_id = p_workspace), 0)
    - coalesce((
        select sum(hours) from time_off_requests
        where workspace_id = p_workspace and user_id = p_user and policy_id = p_policy
          and status = 'approved'
          and extract(year from start_date) = p_year
      ), 0);
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table user_groups          enable row level security;
alter table user_group_members   enable row level security;
alter table timesheet_submissions enable row level security;
alter table time_off_policies    enable row level security;
alter table holidays             enable row level security;
alter table time_off_requests    enable row level security;

create policy user_groups_select on user_groups for select to authenticated
  using (is_workspace_member(workspace_id) and not is_client_user(workspace_id));
create policy user_groups_write on user_groups for all to authenticated
  using (can_manage_workspace(workspace_id))
  with check (can_manage_workspace(workspace_id));

create policy user_group_members_select on user_group_members for select to authenticated
  using (
    exists (select 1 from user_groups g where g.id = group_id
      and is_workspace_member(g.workspace_id) and not is_client_user(g.workspace_id))
  );
create policy user_group_members_write on user_group_members for all to authenticated
  using (exists (select 1 from user_groups g where g.id = group_id and can_manage_workspace(g.workspace_id)))
  with check (exists (select 1 from user_groups g where g.id = group_id and can_manage_workspace(g.workspace_id)));

-- Members submit their own timesheet; only managers approve or reject --
-- self-approval would defeat the entire point of the workflow.
create policy timesheet_select on timesheet_submissions for select to authenticated
  using (
    not is_client_user(workspace_id)
    and (user_id = auth.uid() or can_manage_workspace(workspace_id))
  );
create policy timesheet_insert on timesheet_submissions for insert to authenticated
  with check (
    user_id = auth.uid()
    and is_workspace_member(workspace_id)
    and not is_client_user(workspace_id)
  );
create policy timesheet_update on timesheet_submissions for update to authenticated
  using (
    can_manage_workspace(workspace_id)
    or (user_id = auth.uid() and status = 'submitted' and not is_client_user(workspace_id))
  );
create policy timesheet_delete on timesheet_submissions for delete to authenticated
  using (can_manage_workspace(workspace_id));

create policy time_off_policies_select on time_off_policies for select to authenticated
  using (is_workspace_member(workspace_id) and not is_client_user(workspace_id));
create policy time_off_policies_write on time_off_policies for all to authenticated
  using (can_manage_workspace(workspace_id))
  with check (can_manage_workspace(workspace_id));

create policy holidays_select on holidays for select to authenticated
  using (is_workspace_member(workspace_id) and not is_client_user(workspace_id));
create policy holidays_write on holidays for all to authenticated
  using (can_manage_workspace(workspace_id))
  with check (can_manage_workspace(workspace_id));

create policy time_off_requests_select on time_off_requests for select to authenticated
  using (
    not is_client_user(workspace_id)
    and (user_id = auth.uid() or can_manage_workspace(workspace_id))
  );
create policy time_off_requests_insert on time_off_requests for insert to authenticated
  with check (
    user_id = auth.uid()
    and is_workspace_member(workspace_id)
    and not is_client_user(workspace_id)
  );
-- A member can edit or withdraw their own request only while it is still
-- pending; once reviewed, it is a manager-only record.
create policy time_off_requests_update on time_off_requests for update to authenticated
  using (
    can_manage_workspace(workspace_id)
    or (user_id = auth.uid() and status = 'pending' and not is_client_user(workspace_id))
  );
create policy time_off_requests_delete on time_off_requests for delete to authenticated
  using (
    can_manage_workspace(workspace_id)
    or (user_id = auth.uid() and status = 'pending' and not is_client_user(workspace_id))
  );
