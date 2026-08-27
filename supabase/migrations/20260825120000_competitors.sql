-- Competitor pages, listed per client, and the posts we sample from them.
--
-- STRUCTURALLY SEPARATE FROM platform_posts, AND THAT IS THE WHOLE DESIGN.
-- Every rollup, report, ranking, leaderboard and inference run in this product
-- reads platform_posts. Putting a competitor's video there -- even with a flag
-- -- means every one of those surfaces silently absorbs somebody else's reach
-- into a client's numbers, and the failure would be invisible: totals would
-- just be larger. A flag is a convention that one forgotten `.eq()` breaks. A
-- separate table cannot be forgotten, because nothing joins to it by accident.
--
-- The client report never sees this. That is a product decision (competitor
-- material is internal thinking, not something a client pays to receive) and
-- it is also why the isolation has to be structural: buildClientReport reads
-- the same tables the dashboards do.
--
-- WHY A COMPETITOR'S VIEW COUNT IS NOT COMPARABLE TO A CLIENT'S. A competitor
-- with 10M followers doing 1M views is performing WORSE, relative to
-- themselves, than a client with 5k followers doing 50k. Raw counts across
-- accounts measure audience size, not craft. So competitor_posts carries the
-- raw figures AND a per-competitor baseline, and everything downstream reads
-- the ratio -- exactly the normalisation perfIndex already does for clients.
-- "8x their own normal" is a claim that survives the follower gap; "1M views"
-- is not.

create table if not exists competitors (
  id            uuid primary key default uuid_generate_v4(),
  workspace_id  uuid not null references workspaces on delete cascade,
  -- CLIENT-SCOPED, as asked. A competitor is only ever a competitor OF
  -- someone: the same agency may track one account as a rival for client A
  -- and ignore it for client B, and a workspace-wide list could not express
  -- that.
  client_id     uuid not null references clients on delete cascade,
  platform_slug text not null references platforms (slug),
  -- Stored without the leading @, normalised lower-case by the app, so
  -- "@Foo" and "foo" cannot both be added.
  handle        text not null,
  -- What a human calls them, when the handle is not the brand name.
  display_name  text,
  -- Why this account is on the list. Free text on purpose: the reason is a
  -- judgement ("their format is what the client keeps asking for"), and a
  -- controlled vocabulary would flatten it.
  note          text,
  is_archived   boolean not null default false,
  added_by      uuid references auth.users on delete set null,
  created_at    timestamptz not null default now(),
  last_scanned_at timestamptz,
  last_scan_error text,
  -- One row per account per client. Adding the same rival twice is a mistake,
  -- not a use case.
  unique (client_id, platform_slug, handle)
);

create index if not exists competitors_client on competitors (workspace_id, client_id)
  where not is_archived;

-- A sampled post from a competitor page.
--
-- SAMPLED, not tracked. We take the recent N and re-read them occasionally;
-- there is no snapshot history and no growth series, because we are not
-- measuring their trajectory -- we are looking for what worked well enough to
-- be worth learning from. Storing a time series here would double the ingest
-- cost for a question nobody is asking.
create table if not exists competitor_posts (
  id             uuid primary key default uuid_generate_v4(),
  workspace_id   uuid not null references workspaces on delete cascade,
  competitor_id  uuid not null references competitors on delete cascade,
  -- The platform's own id, so a re-scan updates rather than duplicates.
  external_id    text not null,
  url            text,
  title          text,
  -- The opening line, when the platform gives one. Feeds idea generation the
  -- same way content_items.hook does.
  caption        text,
  thumbnail_url  text,
  posted_at      timestamptz,
  duration_seconds integer,
  views          bigint,
  likes          bigint,
  comments       bigint,
  -- NULL until the competitor has enough sampled posts to have a median.
  -- views / that median. This is the only figure any downstream reader
  -- should use to compare a competitor's video to anything.
  rel_index      numeric,
  fetched_at     timestamptz not null default now(),
  unique (competitor_id, external_id)
);

create index if not exists competitor_posts_competitor
  on competitor_posts (competitor_id, views desc nulls last);

alter table competitors      enable row level security;
alter table competitor_posts enable row level security;

-- Staff only, both ways. A CLIENT USER MUST NEVER SEE THIS: the list names
-- who we consider their rivals and why, which is our working note, not their
-- deliverable. is_client_user is the same guard idea_suggestions uses.
create policy competitors_select on competitors for select to authenticated
  using (is_workspace_member(workspace_id) and not is_client_user(workspace_id));

create policy competitors_write on competitors for all to authenticated
  using (can_manage_workspace(workspace_id) and not is_client_user(workspace_id))
  with check (can_manage_workspace(workspace_id) and not is_client_user(workspace_id));

create policy competitor_posts_select on competitor_posts for select to authenticated
  using (is_workspace_member(workspace_id) and not is_client_user(workspace_id));

-- Written by the worker on the service key. No authenticated write policy at
-- all: these are SAMPLED figures, and a hand-edited competitor number would
-- be indistinguishable from a measured one the moment it was stored.
comment on table competitor_posts is
  'Sampled competitor posts. Service-role writes only -- never hand-edited, '
  'and never joined into platform_posts rollups.';

comment on column competitor_posts.rel_index is
  'views / this competitor''s own median views. The only cross-account-safe '
  'comparison here: raw counts measure audience size, not craft.';
