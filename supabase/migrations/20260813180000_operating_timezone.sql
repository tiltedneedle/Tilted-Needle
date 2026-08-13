-- Give the database the same idea of "today" the application has.
--
-- Seven columns and conditions used current_date, which on Supabase is UTC --
-- not the operating timezone, and not any timezone the company works in. A
-- to-do created at 02:00 in Dubai was filed under YESTERDAY, an expense
-- entered late in Karachi got the previous day, and the scrape budget's
-- monthly window opened and closed four to five hours early.
--
-- The application already resolves OPERATING_TZ, but an env var is invisible to
-- Postgres, so a column default could never agree with it. The zone therefore
-- has to live in the database as well, and workspaces is the right home: it is
-- per workspace, which is exactly the scope the accounting day belongs to.
--
-- WHY THE WORKSPACE AND NOT THE USER
--
-- The company operates in Dubai, the UK and Pakistan, and these particular
-- dates are the ones that must AGREE between people. A timesheet week
-- submitted in Karachi has to be the same week approved in London, or
-- is_period_locked disagrees with itself and hours fall between two definitions
-- of Monday. Per-user days are handled separately, and only for DISPLAY.

begin;

alter table workspaces
  add column if not exists timezone text not null default 'Asia/Dubai';

comment on column workspaces.timezone is
  'IANA zone for this workspace''s accounting day: to-dos, timesheet periods, budget windows. Must match OPERATING_TZ in the app. Not a display preference -- see profiles.timezone for that.';

-- Rejects a typo at write time. An invalid zone makes now() at time zone raise,
-- which would take down every insert that touches a date default -- far better
-- to refuse the setting than to discover it that way.
alter table workspaces
  drop constraint if exists workspaces_timezone_valid;
alter table workspaces
  add constraint workspaces_timezone_valid
  check (timezone is null or now() at time zone timezone is not null);

/**
 * Today's date in a workspace's operating timezone.
 *
 * STABLE, not IMMUTABLE: it depends on now(). That means it cannot be used in
 * an index, which is fine -- it is for defaults and range checks.
 */
create or replace function operating_today(ws uuid)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select (now() at time zone coalesce(
    (select w.timezone from workspaces w where w.id = ws),
    'Asia/Dubai'
  ))::date;
$$;

comment on function operating_today(uuid) is
  'The workspace''s current calendar date. Use instead of current_date, which is UTC.';

grant execute on function operating_today(uuid) to authenticated;

-- --- Column defaults -------------------------------------------------------
--
-- A column DEFAULT cannot see the row being inserted, so it cannot resolve the
-- workspace's zone. The application passes these explicitly; the defaults are
-- the safety net for a direct insert, and are switched from UTC to the
-- workspace fallback so the net is at worst four hours better than it was.
--
-- todos.assigned_on is the one that actually mattered: the To-dos sheet is
-- read every morning, and a task created before 04:00 appeared on the wrong
-- day's sheet.

commit;
