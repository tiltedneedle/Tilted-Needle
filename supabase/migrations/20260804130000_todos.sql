-- ---------------------------------------------------------------------------
-- Daily to-dos
--
-- The team already runs on a daily assignment sheet: every morning a manager
-- writes out who edits what, per client. This table is that sheet, structured.
-- Deliberately no deadline column -- an assignment IS its date (assigned_on),
-- and the history is managed date-wise, one sheet per day.
--
-- Not merged into the existing tasks table (projects/tasks): those are
-- long-lived billing/tracking dimensions attached to projects; a to-do is a
-- one-day instruction to one person, usually about one client's video, and
-- the record of who was told to do what on which day.
-- ---------------------------------------------------------------------------

create table todos (
  id           uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces on delete cascade,
  -- The assignee. references profiles, matching content_assignments.
  user_id      uuid not null references profiles on delete cascade,
  -- Optional: internal chores have no client.
  client_id    uuid references clients on delete set null,
  assigned_on  date not null default current_date,
  description  text not null,
  is_done      boolean not null default false,
  done_at      timestamptz,
  created_by   uuid references profiles on delete set null,
  created_at   timestamptz not null default now()
);

-- The two read shapes: a day's whole sheet (manager) and one person's day.
create index on todos (workspace_id, assigned_on desc);
create index on todos (user_id, assigned_on desc);

alter table todos enable row level security;

-- Managers see the whole sheet; everyone else sees only their own rows.
-- A client-role user is never owner/admin/manager and is never assigned
-- staff work, so both arms exclude them naturally.
create policy todos_select on todos for select to authenticated
  using (
    can_manage_workspace(workspace_id)
    or (user_id = auth.uid() and is_workspace_member(workspace_id))
  );

-- Only managers hand out work.
create policy todos_insert on todos for insert to authenticated
  with check (can_manage_workspace(workspace_id));

-- Managers edit anything; an assignee can update their own row -- that is
-- what lets them tick it done. (RLS cannot scope an update to one column;
-- an assignee editing their own task's wording is acceptable, the sheet is
-- workspace-internal.)
create policy todos_update on todos for update to authenticated
  using (
    can_manage_workspace(workspace_id)
    or (user_id = auth.uid() and is_workspace_member(workspace_id))
  )
  with check (
    can_manage_workspace(workspace_id)
    or (user_id = auth.uid() and is_workspace_member(workspace_id))
  );

create policy todos_delete on todos for delete to authenticated
  using (can_manage_workspace(workspace_id));
