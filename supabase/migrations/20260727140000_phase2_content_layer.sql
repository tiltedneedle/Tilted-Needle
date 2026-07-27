-- Phase 2: the multi-platform content layer.
--
-- Content and posts are separate entities because the same video is
-- cross-posted and performs very differently on each platform (PRD 3.5).
-- Scoring never pools across platforms; each is evaluated on its own metrics
-- and baseline, and only finished per-platform scores are averaged (PRD 5).

-- ---------------------------------------------------------------------------
-- Platform registry
--
-- A global reference table, not an enum: adding a platform is an INSERT plus a
-- connector, never a schema change or a branch in the scoring engine (PRD 9.5).
-- ---------------------------------------------------------------------------

create table platforms (
  slug                 text primary key,
  display_name         text not null,
  -- none = manual entry only; oauth = user consent; oauth_review = consent
  -- plus platform app review before it works for anyone else.
  auth_model           text not null default 'oauth',
  supports_public_read boolean not null default false,
  -- What counts as a "view" here. Never compare raw counts across rows of
  -- this table -- that is the whole reason scoring is per-platform.
  view_semantics       text not null default 'unclear',
  available_metrics    jsonb not null default '[]'::jsonb,
  -- Which metric drives each role on this platform. Absent role = not scored
  -- here rather than silently substituted with views.
  scoring_config       jsonb not null default '{}'::jsonb,
  maturity_window_days integer not null default 7,
  sort_order           integer not null default 100,
  is_enabled           boolean not null default true
);

insert into platforms
  (slug, display_name, auth_model, supports_public_read, view_semantics,
   available_metrics, scoring_config, maturity_window_days, sort_order)
values
  ('instagram', 'Instagram', 'oauth_review', false, 'unclear',
   '["views","likes","comments","shares","saves","reach"]'::jsonb,
   '{"idea":"reach_per_follower","script":"avg_watch_seconds","editor":"avg_watch_seconds","qc":"comment_sentiment"}'::jsonb,
   7, 10),
  ('tiktok', 'TikTok', 'oauth', false, 'immediate',
   '["views","likes","comments","shares"]'::jsonb,
   '{"idea":"views","script":"completion_rate","editor":"completion_rate","qc":"comment_sentiment"}'::jsonb,
   7, 20),
  ('youtube', 'YouTube', 'oauth', true, '30s',
   '["views","likes","comments","impressions","ctr","avg_watch_seconds"]'::jsonb,
   '{"idea":"ctr","videographer":"ctr","script":"retention_30s","editor":"avg_watch_seconds","qc":"dislike_ratio"}'::jsonb,
   28, 30),
  ('facebook', 'Facebook', 'oauth_review', false, '3s',
   '["views","likes","comments","shares","reach"]'::jsonb,
   '{"idea":"reach","script":"avg_watch_seconds","editor":"complete_views","qc":"reaction_mix"}'::jsonb,
   7, 40);

-- ---------------------------------------------------------------------------
-- Accounts, content, posts
-- ---------------------------------------------------------------------------

create table accounts (
  id            uuid primary key default uuid_generate_v4(),
  workspace_id  uuid not null references workspaces on delete cascade,
  client_id     uuid references clients on delete set null,
  platform_slug text not null references platforms (slug),
  handle        text not null,
  -- manual until an integration is connected; the pipeline is identical
  -- either way, only platform_posts.source differs (PRD 9.5).
  connection_mode text not null default 'manual',
  is_archived   boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (workspace_id, platform_slug, handle)
);

create index on accounts (workspace_id) where not is_archived;

create table content_items (
  id             uuid primary key default uuid_generate_v4(),
  workspace_id   uuid not null references workspaces on delete cascade,
  client_id      uuid references clients on delete set null,
  title          text not null,
  -- Columns the team fills reliably in the current sheet (94-100%).
  subject        text,
  hook           text,
  music_used     text,
  length_seconds integer,
  produced_at    date,
  notes          text,
  created_at     timestamptz not null default now()
);

create index on content_items (workspace_id, produced_at desc);
create index on content_items (client_id);

create table platform_posts (
  id                uuid primary key default uuid_generate_v4(),
  workspace_id      uuid not null references workspaces on delete cascade,
  content_item_id   uuid not null references content_items on delete cascade,
  account_id        uuid not null references accounts on delete cascade,
  external_id       text,
  url               text,
  posted_at         date,
  -- 'manual' or 'api'. Hand-entered and synced posts flow through the same
  -- pipeline; this column is the only difference.
  source            text not null default 'manual',
  is_best_performing boolean not null default false,
  comment_sentiment text,
  engagement_note   text,
  created_at        timestamptz not null default now(),
  unique (content_item_id, account_id)
);

create index on platform_posts (workspace_id, posted_at desc);
create index on platform_posts (content_item_id);

-- Time series, not a current value: scoring evaluates at a fixed maturity
-- window, which needs history (PRD 5 Step 1).
create table post_snapshots (
  id               uuid primary key default uuid_generate_v4(),
  workspace_id     uuid not null references workspaces on delete cascade,
  platform_post_id uuid not null references platform_posts on delete cascade,
  captured_at      timestamptz not null default now(),
  views            bigint,
  likes            bigint,
  comments         bigint,
  shares           bigint,
  saves            bigint,
  reach            bigint,
  avg_watch_seconds numeric,
  source           text not null default 'manual'
);

create index on post_snapshots (platform_post_id, captured_at desc);

-- ---------------------------------------------------------------------------
-- Roles and assignments
-- ---------------------------------------------------------------------------

create table roles (
  id           uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces on delete cascade,
  -- Stable key used to look up scoring_config on the platform registry.
  slug         text not null,
  name         text not null,
  sort_order   integer not null default 100,
  unique (workspace_id, slug)
);

create table content_assignments (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references workspaces on delete cascade,
  content_item_id uuid not null references content_items on delete cascade,
  user_id         uuid not null references profiles on delete cascade,
  role_id         uuid not null references roles on delete cascade,
  -- 'derived' when inferred from tracked time, 'manual' when set by hand.
  -- The sheet's role columns had 0% compliance, so derivation is the default
  -- path and manual is the correction (PRD 3.5).
  source          text not null default 'manual',
  created_at      timestamptz not null default now(),
  unique (content_item_id, user_id, role_id)
);

create index on content_assignments (content_item_id);
create index on content_assignments (user_id);

-- The join that makes this more than a Clockify clone: hours and cost per
-- piece of content, and performance per hour invested (PRD 6.7).
alter table time_entries
  add column content_item_id uuid references content_items on delete set null;

create index on time_entries (content_item_id);

-- Seed the five production roles into every existing workspace.
insert into roles (workspace_id, slug, name, sort_order)
select w.id, r.slug, r.name, r.sort_order
from workspaces w
cross join (values
  ('idea',         'Video Idea',   10),
  ('script',       'Script',       20),
  ('videographer', 'Videographer', 30),
  ('editor',       'Editor',       40),
  ('qc',           'Quality Control', 50)
) as r(slug, name, sort_order)
on conflict do nothing;

-- New workspaces get them too.
create or replace function create_workspace(ws_name text, ws_slug text)
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

  insert into roles (workspace_id, slug, name, sort_order)
  values
    (new_ws.id, 'idea', 'Video Idea', 10),
    (new_ws.id, 'script', 'Script', 20),
    (new_ws.id, 'videographer', 'Videographer', 30),
    (new_ws.id, 'editor', 'Editor', 40),
    (new_ws.id, 'qc', 'Quality Control', 50);

  return new_ws;
end;
$$;

-- ---------------------------------------------------------------------------
-- Latest metrics per post.
--
-- security_invoker so the view is filtered by the querying user's RLS rather
-- than the view owner's -- without it this would leak every workspace's data.
-- ---------------------------------------------------------------------------

create view post_current_metrics
with (security_invoker = on) as
select distinct on (s.platform_post_id)
  s.platform_post_id,
  s.captured_at,
  s.views, s.likes, s.comments, s.shares, s.saves, s.reach,
  s.avg_watch_seconds
from post_snapshots s
order by s.platform_post_id, s.captured_at desc;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table platforms           enable row level security;
alter table accounts            enable row level security;
alter table content_items       enable row level security;
alter table platform_posts      enable row level security;
alter table post_snapshots      enable row level security;
alter table roles               enable row level security;
alter table content_assignments enable row level security;

-- Platform registry is shared reference data: readable by any signed-in user,
-- writable only by the service role (which bypasses RLS).
create policy platforms_select on platforms for select to authenticated using (true);

create policy accounts_select on accounts for select to authenticated
  using (is_workspace_member(workspace_id));
create policy accounts_write on accounts for all to authenticated
  using (can_manage_workspace(workspace_id))
  with check (can_manage_workspace(workspace_id));

-- Members create and edit content; deleting is a manager action because it
-- cascades to posts, snapshots, and assignments.
create policy content_select on content_items for select to authenticated
  using (is_workspace_member(workspace_id));
create policy content_insert on content_items for insert to authenticated
  with check (is_workspace_member(workspace_id));
create policy content_update on content_items for update to authenticated
  using (is_workspace_member(workspace_id));
create policy content_delete on content_items for delete to authenticated
  using (can_manage_workspace(workspace_id));

create policy posts_select on platform_posts for select to authenticated
  using (is_workspace_member(workspace_id));
create policy posts_insert on platform_posts for insert to authenticated
  with check (is_workspace_member(workspace_id));
create policy posts_update on platform_posts for update to authenticated
  using (is_workspace_member(workspace_id));
create policy posts_delete on platform_posts for delete to authenticated
  using (can_manage_workspace(workspace_id));

create policy snapshots_select on post_snapshots for select to authenticated
  using (is_workspace_member(workspace_id));
create policy snapshots_insert on post_snapshots for insert to authenticated
  with check (is_workspace_member(workspace_id));
-- Snapshots are an append-only history; correcting a number means adding a
-- newer one, not rewriting the past.
create policy snapshots_delete on post_snapshots for delete to authenticated
  using (can_manage_workspace(workspace_id));

create policy roles_select on roles for select to authenticated
  using (is_workspace_member(workspace_id));
create policy roles_write on roles for all to authenticated
  using (can_manage_workspace(workspace_id))
  with check (can_manage_workspace(workspace_id));

create policy assignments_select on content_assignments for select to authenticated
  using (is_workspace_member(workspace_id));
create policy assignments_insert on content_assignments for insert to authenticated
  with check (is_workspace_member(workspace_id));
create policy assignments_delete on content_assignments for delete to authenticated
  using (is_workspace_member(workspace_id));
