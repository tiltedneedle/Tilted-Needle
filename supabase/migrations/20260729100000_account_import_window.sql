-- ---------------------------------------------------------------------------
-- Per-account import window
--
-- How far back to pull when importing an account's videos, and on every later
-- refresh. Stored per account rather than as a global setting because the
-- right answer differs: a channel posting daily needs a shorter window than
-- one posting monthly, and pulling a decade of back catalogue for the first
-- would burn quota to no purpose.
--
-- Null means "no limit" -- import everything the platform will return, capped
-- by the runner's own page budget. It is deliberately not the default: an
-- unbounded first import against a large channel is the expensive mistake
-- here, so 30 days is the default and no-limit is opt-in.
-- ---------------------------------------------------------------------------

alter table accounts
  add column if not exists sync_window_days integer default 30;

alter table accounts
  drop constraint if exists accounts_sync_window_days_check;

alter table accounts
  add constraint accounts_sync_window_days_check
  check (sync_window_days is null or sync_window_days between 1 and 3650);

comment on column accounts.sync_window_days is
  'Only import videos posted within this many days. Null = no date limit.';

-- The channel/page title as the platform reports it, captured when the
-- account is verified. The handle alone is not enough to confirm the right
-- account was picked -- two channels can have confusingly similar handles.
alter table accounts
  add column if not exists display_name text;

comment on column accounts.display_name is
  'Platform-reported account name, captured at verification time';
