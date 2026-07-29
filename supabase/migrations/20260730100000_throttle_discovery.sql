-- ---------------------------------------------------------------------------
-- Throttle discovery on metered accounts
--
-- The sync cron runs every 15 minutes (vercel.json). The auto-refresh path is
-- already safe at that cadence -- findDuePosts only returns posts whose own
-- age-tier interval has elapsed. Discovery had no equivalent gate: it asked
-- the vendor for an account's recent posts on every single tick, and Apify
-- bills for every row returned whether or not it turns out to be a post we
-- already track. Run unthrottled against real accounts, that reads the same
-- ~12 mostly-already-known posts 96 times a day and burns the entire monthly
-- discovery pool (200) in a few hours, on ONE account.
--
-- last_discovered_at makes discovery a per-account cooldown instead of a
-- per-tick action: the sync runner now skips the discovery spend entirely
-- when the last attempt was too recent, regardless of whether it succeeded.
-- ---------------------------------------------------------------------------

alter table accounts
  add column if not exists last_discovered_at timestamptz;

comment on column accounts.last_discovered_at is
  'When discovery was last attempted for this account. Gates re-spending on a metered platform between cron ticks that have nothing new to find.';
