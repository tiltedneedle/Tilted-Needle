-- Three security defects found by an adversarially-verified audit.
-- All three verified against the live schema before writing this.

-- ---------------------------------------------------------------------------
-- 1. scrape_schedule had NO ROW LEVEL SECURITY.
--
-- It was the only table in the public schema created without it. Under
-- Supabase's default grants that makes it fully readable AND WRITABLE by
-- anyone holding the publishable key -- which ships in every browser bundle,
-- from a public repo.
--
-- The damage is not data theft, it is the cost ledger. isMetered() decides
-- whether a platform is metered at all by counting rows here. Delete the
-- instagram rows and Instagram silently stops being metered: the sync skips
-- claim_scrape_budget() entirely and the Apify ceiling stops being enforced.
-- The free plan BLOCKS rather than bills, so the result is Instagram sync
-- dead for the rest of the month, for every tenant at once -- this table has
-- no workspace_id, it is global config.
--
-- It is reference data, so: readable by any signed-in member, writable by
-- nobody through the API. The sync runner uses the service key and bypasses
-- RLS, which is exactly the right split.
alter table scrape_schedule enable row level security;

create policy scrape_schedule_select on scrape_schedule
  for select to authenticated using (true);

-- No insert/update/delete policy at all. With RLS on and no permissive
-- policy, every write through PostgREST is refused regardless of role.

-- ---------------------------------------------------------------------------
-- 2. kiosk_pin_hash was readable by every non-client member.
--
-- RLS is ROW-level, not column-level. memberships_select grants any active
-- non-client member read access to every membership row in the workspace, so
-- the lowest-privilege member could select kiosk_pin_hash for all colleagues.
-- The hash is unsalted SHA-256 over a 4-8 digit PIN: the entire keyspace is
-- precomputable in seconds, so that column is effectively the PINs in cleartext.
--
-- Column-level REVOKE is the correct instrument -- RLS cannot express this.
-- The kiosk clock RPC is SECURITY DEFINER and runs as the owner, so it keeps
-- working; only direct PostgREST reads lose the column.
revoke select (kiosk_pin_hash) on memberships from authenticated, anon;

-- Managers set PINs through set_kiosk_pin() (SECURITY DEFINER), never by
-- writing the column directly, so removing write access breaks nothing.
revoke update (kiosk_pin_hash) on memberships from authenticated, anon;

comment on column memberships.kiosk_pin_hash is
  'Unsalted SHA-256 of a short numeric PIN -- effectively cleartext. Column-level SELECT is revoked from authenticated/anon (RLS is row-level and cannot scope a column). Read it only inside SECURITY DEFINER functions.';

-- ---------------------------------------------------------------------------
-- 3. The kiosk clock endpoint had no brute-force protection.
--
-- /api/kiosk/clock is unauthenticated by design (a shared tablet), and
-- kiosk_clock matches the submitted hash against EVERY active member of the
-- workspace rather than a named user. So each guess is tested against the
-- whole roster at once, and a 4-digit space of 10,000 falls in minutes with
-- no counter, no lockout and no record that it happened.
--
-- Attempts are recorded per device so the RPC can refuse a device that is
-- clearly guessing. Kept in its own table rather than a column on kiosks so a
-- successful clock-in does not have to write to the kiosk row on every tap.
create table if not exists kiosk_pin_attempts (
  id            uuid primary key default uuid_generate_v4(),
  kiosk_id      uuid not null references kiosks on delete cascade,
  succeeded     boolean not null,
  attempted_at  timestamptz not null default now()
);

create index if not exists kiosk_pin_attempts_recent
  on kiosk_pin_attempts (kiosk_id, attempted_at desc);

alter table kiosk_pin_attempts enable row level security;

-- Managers can review; nobody writes through the API. The RPC is SECURITY
-- DEFINER and does the recording itself.
create policy kiosk_pin_attempts_select on kiosk_pin_attempts
  for select to authenticated
  using (exists (
    select 1 from kiosks k
    where k.id = kiosk_pin_attempts.kiosk_id
      and can_manage_workspace(k.workspace_id)
  ));

comment on table kiosk_pin_attempts is
  'Brute-force ledger for the unauthenticated kiosk clock endpoint. kiosk_clock() refuses a device after too many recent failures.';

-- The RPC itself now refuses a device that is clearly guessing, and records
-- every attempt. Replaced wholesale rather than patched so the lockout cannot
-- be bypassed by an older overload lingering in the schema.
create or replace function kiosk_clock(
  p_device_token text,
  p_pin_hash text,
  p_latitude numeric default null,
  p_longitude numeric default null
)
returns table (action text, clocked_user_id uuid, entry_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  k kiosks;
  m memberships;
  open_entry time_entries;
  recent_failures integer;
begin
  select * into k from kiosks
    where device_token = p_device_token and is_active
    limit 1;
  if k.id is null then
    raise exception 'invalid or inactive kiosk device';
  end if;

  -- Lockout BEFORE the PIN is checked, so a locked device learns nothing from
  -- how long the call takes or which error it gets. Ten failures in fifteen
  -- minutes is far above any honest mistyping rate on a shared tablet, and far
  -- below what a 10,000-guess sweep needs.
  select count(*) into recent_failures
    from kiosk_pin_attempts a
    where a.kiosk_id = k.id
      and not a.succeeded
      and a.attempted_at > now() - interval '15 minutes';

  if recent_failures >= 10 then
    insert into kiosk_pin_attempts (kiosk_id, succeeded) values (k.id, false);
    raise exception 'too many incorrect PINs on this device; try again in a few minutes';
  end if;

  select * into m from memberships
    where workspace_id = k.workspace_id
      and kiosk_pin_hash = p_pin_hash
      and is_active
    limit 1;

  if m.id is null then
    insert into kiosk_pin_attempts (kiosk_id, succeeded) values (k.id, false);
    raise exception 'pin not recognised';
  end if;

  insert into kiosk_pin_attempts (kiosk_id, succeeded) values (k.id, true);

  select * into open_entry from time_entries te
    where te.workspace_id = k.workspace_id
      and te.user_id = m.user_id
      and te.ended_at is null
    limit 1;

  if open_entry.id is not null then
    update time_entries set ended_at = now()
      where id = open_entry.id;
    return query select 'clock_out'::text, m.user_id, open_entry.id;
  else
    insert into time_entries
      (workspace_id, user_id, project_id, kiosk_id, description, started_at, latitude, longitude)
    values
      (k.workspace_id, m.user_id, k.project_id, k.id, 'Kiosk clock-in', now(), p_latitude, p_longitude)
    returning id into open_entry;
    return query select 'clock_in'::text, m.user_id, open_entry.id;
  end if;
end;
$$;

revoke execute on function kiosk_clock(text, text, numeric, numeric)
  from public, authenticated, anon;
grant execute on function kiosk_clock(text, text, numeric, numeric) to service_role;
