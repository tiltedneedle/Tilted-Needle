-- ---------------------------------------------------------------------------
-- Public metrics sync
--
-- Polling public platform data on a schedule, with no client credentials.
-- Only YouTube can actually be read this way today; the other three platforms
-- reserve their metrics for the account owner. The schema does not encode
-- that distinction -- it lives in lib/providers, so adding a platform later
-- is a code change and not a migration.
--
-- What this migration adds is the state a scheduled job needs: where each
-- account got to, and a durable record of what each run did. Without the run
-- log a failing sync is invisible -- numbers simply stop moving, which looks
-- identical to "nothing was posted".
-- ---------------------------------------------------------------------------

-- Per-account sync state.
alter table accounts
  add column if not exists sync_enabled   boolean not null default true,
  -- The platform's own id for the account (a UC… channel id), resolved once
  -- from the handle so every later run skips that lookup.
  add column if not exists external_id    text,
  add column if not exists last_synced_at timestamptz,
  add column if not exists last_sync_error text;

create index if not exists accounts_sync_idx
  on accounts (workspace_id, last_synced_at)
  where sync_enabled and not is_archived;

-- One row per sync attempt per account.
create table if not exists sync_runs (
  id             uuid primary key default uuid_generate_v4(),
  workspace_id   uuid not null references workspaces on delete cascade,
  account_id     uuid references accounts on delete cascade,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  -- 'running' | 'ok' | 'error' | 'skipped'
  status         text not null default 'running',
  -- 'cron' | 'manual'
  trigger        text not null default 'cron',
  posts_seen     integer not null default 0,
  snapshots_written integer not null default 0,
  posts_created  integer not null default 0,
  error          text
);

create index if not exists sync_runs_recent_idx
  on sync_runs (workspace_id, started_at desc);

alter table sync_runs enable row level security;

-- Readable by anyone who can already see the workspace's content; writes come
-- from the service role in the scheduled job, never from a browser session.
-- Client users are excluded: a sync failure is an internal operational
-- detail, not something to surface to the customer whose channel it is.
drop policy if exists sync_runs_select on sync_runs;
create policy sync_runs_select on sync_runs
  for select using (
    exists (
      select 1 from memberships m
      where m.workspace_id = sync_runs.workspace_id
        and m.user_id = auth.uid()
        and m.is_active
        and m.role <> 'client'
    )
  );

-- Deliberately no insert/update/delete policy: with RLS enabled and none
-- granted, only the service role can write here. A run log a user could edit
-- would be worthless as a diagnostic.

-- A snapshot recorded by the poller is marked 'api' rather than 'manual', so
-- a hand-entered correction stays distinguishable from a fetched reading.
-- (post_snapshots.source already exists and defaults to 'manual'.)
comment on column post_snapshots.source is
  'manual = typed in by a person, api = fetched by the public metrics sync';

comment on column accounts.external_id is
  'Platform-native account id (e.g. a YouTube UC… channel id), resolved from handle on first sync';
