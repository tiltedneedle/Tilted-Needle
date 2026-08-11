-- Actually revoke read access to kiosk_pin_hash.
--
-- The previous migration used `revoke select (kiosk_pin_hash) on memberships`,
-- which applied without error and DID NOTHING. Postgres treats table-level and
-- column-level privileges as separate grants, and revoking a column privilege
-- does not cut down a table-level GRANT SELECT. The role still held SELECT on
-- the whole table, so the column stayed readable.
--
-- Verified the hard way: after that migration a signed-in read of the column
-- still succeeded. A migration applying cleanly is not evidence it worked.
--
-- The correct instrument is to drop the table-wide grant and re-grant every
-- column EXCEPT this one. Anything added to memberships later is therefore
-- unreadable until deliberately granted, which is the safe direction for a
-- table that has already accumulated one credential column by accident.
revoke select on memberships from authenticated, anon;

grant select (
  id,
  workspace_id,
  user_id,
  role,
  seat,
  is_active,
  created_at,
  billable_rate,
  cost_rate,
  client_id,
  weekly_capacity_hours
) on memberships to authenticated;

-- Row visibility is still decided by RLS (memberships_select); this only
-- decides which COLUMNS a permitted row may expose. The two are independent,
-- which is precisely why RLS alone could never have solved this.
