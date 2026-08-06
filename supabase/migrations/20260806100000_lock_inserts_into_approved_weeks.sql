-- ---------------------------------------------------------------------------
-- Close the last door into an approved week: inserts
--
-- Phase 7 locked UPDATE and DELETE on time entries inside an approved
-- timesheet period -- "an approved week is meant to be a closed number" --
-- but the INSERT policy still dated from phase 5, before the lock existed.
-- A member could therefore still add brand-new entries into their own
-- approved week, drifting the very total payroll or a client invoice may
-- already have been built from, without touching a single locked row.
--
-- Same rule as update/delete: managers may still insert corrections (they
-- can already edit locked entries); a member needs the period to be open.
-- ---------------------------------------------------------------------------

drop policy time_entries_insert on time_entries;
create policy time_entries_insert on time_entries for insert to authenticated
  with check (
    user_id = auth.uid()
    and is_workspace_member(workspace_id)
    and not is_client_user(workspace_id)
    and (
      can_manage_workspace(workspace_id)
      or not is_period_locked(workspace_id, user_id, (started_at at time zone 'utc')::date)
    )
  );
