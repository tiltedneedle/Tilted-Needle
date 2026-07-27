-- Phase 4: rates, budgets, expenses, invoicing.
--
-- Rates live as explicit columns on the entities they belong to rather than in
-- a generic scope table, because the resolution order is a fixed five-level
-- precedence and reading it off named columns is far harder to get subtly
-- wrong than matching rows by a scope discriminator.
--
-- Precedence (highest first), matching Clockify:
--   task > project member > project > workspace member > workspace default

alter table workspaces
  add column default_billable_rate numeric,
  add column currency text not null default 'USD';

alter table memberships
  add column billable_rate numeric,
  -- What the person costs the business. Never shown to non-managers: this is
  -- effectively salary information.
  add column cost_rate numeric;

alter table projects
  add column billable_rate numeric,
  add column budget_amount numeric,
  add column budget_hours numeric;

alter table tasks
  add column billable_rate numeric;

-- Per-member override within one project -- a senior editor billed higher on
-- a specific client, without changing their workspace rate.
create table project_members (
  id            uuid primary key default uuid_generate_v4(),
  workspace_id  uuid not null references workspaces on delete cascade,
  project_id    uuid not null references projects on delete cascade,
  user_id       uuid not null references profiles on delete cascade,
  billable_rate numeric,
  created_at    timestamptz not null default now(),
  unique (project_id, user_id)
);

create index on project_members (project_id);

create table expenses (
  id           uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces on delete cascade,
  project_id   uuid references projects on delete set null,
  user_id      uuid not null references profiles on delete cascade,
  category     text,
  notes        text,
  amount       numeric not null,
  spent_on     date not null default current_date,
  is_billable  boolean not null default true,
  -- Set once invoiced so the same expense cannot be billed twice.
  invoice_id   uuid,
  created_at   timestamptz not null default now()
);

create index on expenses (workspace_id, spent_on desc);
create index on expenses (project_id);

create table invoices (
  id           uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces on delete cascade,
  client_id    uuid references clients on delete set null,
  number       text not null,
  status       text not null default 'draft',
  issued_on    date not null default current_date,
  due_on       date,
  currency     text not null default 'USD',
  tax_percent  numeric not null default 0,
  discount_amount numeric not null default 0,
  notes        text,
  created_at   timestamptz not null default now(),
  unique (workspace_id, number)
);

create index on invoices (workspace_id, issued_on desc);

create table invoice_lines (
  id          uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces on delete cascade,
  invoice_id  uuid not null references invoices on delete cascade,
  description text not null,
  -- Hours for time lines, units for expense lines.
  quantity    numeric not null,
  unit_amount numeric not null,
  sort_order  integer not null default 0
);

create index on invoice_lines (invoice_id);

-- Marks tracked time as billed so a second invoice cannot include it again.
alter table time_entries
  add column invoice_id uuid references invoices on delete set null;

create index on time_entries (invoice_id);

alter table expenses
  add constraint expenses_invoice_fk
  foreign key (invoice_id) references invoices on delete set null;

-- ---------------------------------------------------------------------------
-- Rate resolution
--
-- Kept in SQL as well as TypeScript because reports aggregate over thousands
-- of entries; doing this per row in the application would mean shipping every
-- rate table to the client.
-- ---------------------------------------------------------------------------

create function resolve_billable_rate(entry_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    t.billable_rate,        -- task
    pm.billable_rate,       -- project member
    p.billable_rate,        -- project
    m.billable_rate,        -- workspace member
    w.default_billable_rate -- workspace default
  )
  from time_entries te
  join workspaces w on w.id = te.workspace_id
  left join tasks t on t.id = te.task_id
  left join projects p on p.id = te.project_id
  left join project_members pm
    on pm.project_id = te.project_id and pm.user_id = te.user_id
  left join memberships m
    on m.workspace_id = te.workspace_id and m.user_id = te.user_id
  where te.id = entry_id;
$$;

-- ---------------------------------------------------------------------------
-- RLS
--
-- Financial data is manager-only throughout. Cost rates in particular are
-- close to salary data, so members must not be able to read other members'
-- rows even within their own workspace.
-- ---------------------------------------------------------------------------

alter table project_members enable row level security;
alter table expenses       enable row level security;
alter table invoices       enable row level security;
alter table invoice_lines  enable row level security;

create policy project_members_select on project_members for select to authenticated
  using (can_manage_workspace(workspace_id));
create policy project_members_write on project_members for all to authenticated
  using (can_manage_workspace(workspace_id))
  with check (can_manage_workspace(workspace_id));

-- Members file and see their own expenses; managers see everything.
create policy expenses_select on expenses for select to authenticated
  using (
    (user_id = auth.uid() and is_workspace_member(workspace_id))
    or can_manage_workspace(workspace_id)
  );
create policy expenses_insert on expenses for insert to authenticated
  with check (user_id = auth.uid() and is_workspace_member(workspace_id));
create policy expenses_update on expenses for update to authenticated
  using (
    (user_id = auth.uid() and is_workspace_member(workspace_id) and invoice_id is null)
    or can_manage_workspace(workspace_id)
  );
create policy expenses_delete on expenses for delete to authenticated
  using (
    (user_id = auth.uid() and is_workspace_member(workspace_id) and invoice_id is null)
    or can_manage_workspace(workspace_id)
  );

create policy invoices_all on invoices for all to authenticated
  using (can_manage_workspace(workspace_id))
  with check (can_manage_workspace(workspace_id));

create policy invoice_lines_all on invoice_lines for all to authenticated
  using (can_manage_workspace(workspace_id))
  with check (can_manage_workspace(workspace_id));
