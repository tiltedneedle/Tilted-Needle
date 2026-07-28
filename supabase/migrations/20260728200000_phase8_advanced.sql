-- Phase 8: audit log, public API keys, webhooks, kiosk mode.
--
-- Scope note, stated plainly rather than quietly skipped: SSO/SAML and
-- desktop screenshot/activity tracking are NOT built here.
--   - SAML needs a real Identity Provider (Okta, Azure AD, Google Workspace)
--     registered by the customer, the same external-prerequisite shape as the
--     Phase 6 OAuth apps. Unlike OAuth, a SAML Service Provider also involves
--     XML signature verification and certificate metadata; shipping that
--     without a live IdP to test against risks a security-critical feature
--     that is subtly broken and untested. Documented, not attempted.
--   - Screenshots and OS-level activity tracking require an installed
--     desktop agent (Electron or native). A browser tab cannot capture the
--     screen or other applications regardless of permissions -- this is a
--     sandboxing limit, not an effort trade-off, so there is nothing a web
--     app migration can do here.
-- GPS is included in a lightweight form: the kiosk clock-in captures
-- browser Geolocation coordinates when the device grants permission, which
-- covers the common "which site did this clock-in happen at" need without
-- a native mobile app.

-- ---------------------------------------------------------------------------
-- Audit log
--
-- Append-only by policy (no update/delete grant to anyone but the row is
-- never meant to change), covering the actions where "who did this and
-- when" actually gets asked: rate changes, role/credit assignments,
-- approvals, invoice status, membership changes.
-- ---------------------------------------------------------------------------

create table audit_log (
  id           uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces on delete cascade,
  actor_id     uuid references profiles on delete set null,
  action       text not null,       -- e.g. 'timesheet.approved', 'rate.updated'
  entity_type  text not null,       -- e.g. 'timesheet_submissions'
  entity_id    uuid,
  detail       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index on audit_log (workspace_id, created_at desc);
create index on audit_log (workspace_id, entity_type, entity_id);

alter table audit_log enable row level security;

create policy audit_log_select on audit_log for select to authenticated
  using (can_manage_workspace(workspace_id));
-- No update/delete policy for anyone: an audit log that can be edited by the
-- same roles it is meant to hold accountable is not an audit log.
create policy audit_log_insert on audit_log for insert to authenticated
  with check (is_workspace_member(workspace_id) and not is_client_user(workspace_id));

-- ---------------------------------------------------------------------------
-- Public API keys
--
-- Only the hash is stored -- same principle as a password. The plaintext
-- key is shown exactly once, at creation, and cannot be recovered afterward,
-- only rotated.
-- ---------------------------------------------------------------------------

create table api_keys (
  id           uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces on delete cascade,
  name         text not null,
  key_prefix   text not null,       -- shown in the UI so a key can be told apart, e.g. "tn_live_ab12"
  key_hash     text not null,       -- sha-256 of the full key; never the key itself
  created_by   uuid references profiles on delete set null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create index on api_keys (key_hash);
create index on api_keys (workspace_id);

alter table api_keys enable row level security;

create policy api_keys_select on api_keys for select to authenticated
  using (can_manage_workspace(workspace_id));
create policy api_keys_insert on api_keys for insert to authenticated
  with check (can_manage_workspace(workspace_id));
-- Revoking is the only "delete": rows are kept so `last_used_at` history
-- survives, matching how memberships are deactivated rather than removed.
create policy api_keys_update on api_keys for update to authenticated
  using (can_manage_workspace(workspace_id));

-- Looks up the workspace and role for a key hash. Runs as security definer
-- because the caller of the public API has no Supabase session at all --
-- there is no `authenticated` role to grant a normal policy to.
create function api_key_workspace(p_key_hash text)
returns table (workspace_id uuid, key_id uuid)
language sql
security definer
stable
set search_path = public
as $$
  select workspace_id, id
  from api_keys
  where key_hash = p_key_hash
    and revoked_at is null;
$$;

-- ---------------------------------------------------------------------------
-- Webhooks
-- ---------------------------------------------------------------------------

create table webhooks (
  id           uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces on delete cascade,
  url          text not null,
  -- Which events this endpoint wants. Kept as an array of event-name strings
  -- rather than one row per event: a subscriber usually wants several
  -- related events and this avoids an N-row fan-out for every registration.
  events       text[] not null default '{}',
  secret       text not null,       -- HMAC signing secret, shown once at creation
  is_active    boolean not null default true,
  created_by   uuid references profiles on delete set null,
  created_at   timestamptz not null default now()
);

create index on webhooks (workspace_id);

create table webhook_deliveries (
  id           uuid primary key default uuid_generate_v4(),
  webhook_id   uuid not null references webhooks on delete cascade,
  event        text not null,
  payload      jsonb not null,
  status_code  integer,
  error        text,
  attempted_at timestamptz not null default now()
);

create index on webhook_deliveries (webhook_id, attempted_at desc);

alter table webhooks enable row level security;
alter table webhook_deliveries enable row level security;

create policy webhooks_all on webhooks for all to authenticated
  using (can_manage_workspace(workspace_id))
  with check (can_manage_workspace(workspace_id));

create policy webhook_deliveries_select on webhook_deliveries for select to authenticated
  using (exists (select 1 from webhooks w where w.id = webhook_id and can_manage_workspace(w.workspace_id)));

-- ---------------------------------------------------------------------------
-- Kiosk mode
--
-- A kiosk is a shared, unauthenticated device (a tablet at a front desk).
-- It identifies itself with a device token, not a user login; individual
-- staff identify themselves to it with a short PIN, not their account
-- password -- entering a real password on a shared device would be a
-- credential-handling mistake, not a convenience.
-- ---------------------------------------------------------------------------

create table kiosks (
  id            uuid primary key default uuid_generate_v4(),
  workspace_id  uuid not null references workspaces on delete cascade,
  name          text not null,
  device_token  text not null unique, -- opaque token the physical device holds
  project_id    uuid references projects on delete set null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

alter table memberships
  add column kiosk_pin_hash text;

alter table time_entries
  add column kiosk_id uuid references kiosks on delete set null,
  add column latitude  numeric,
  add column longitude numeric;

alter table kiosks enable row level security;

create policy kiosks_all on kiosks for all to authenticated
  using (can_manage_workspace(workspace_id))
  with check (can_manage_workspace(workspace_id));

-- Verifies a kiosk device token + PIN pair and clocks in or out, all in one
-- security-definer call: the kiosk device has no Supabase session, so this
-- is the entire trust boundary for the feature. It must not be reachable
-- with a bare workspace_id -- only a valid, active device_token gets in.
-- The RETURNS TABLE column is named clocked_user_id, not user_id: a bare
-- `user_id` here would collide with the identically-named column on both
-- memberships and time_entries referenced in the function body, which
-- PL/pgSQL rejects as ambiguous (variable_conflict defaults to error) --
-- caught by calling the function, not by review, and fixed in the same
-- migration rather than a later patch.
create function kiosk_clock(
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
begin
  select * into k from kiosks
    where device_token = p_device_token and is_active
    limit 1;
  if k.id is null then
    raise exception 'invalid or inactive kiosk device';
  end if;

  select * into m from memberships
    where workspace_id = k.workspace_id
      and kiosk_pin_hash = p_pin_hash
      and is_active
    limit 1;
  if m.id is null then
    raise exception 'pin not recognised';
  end if;

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

revoke execute on function kiosk_clock(text, text, numeric, numeric) from authenticated, anon;
grant execute on function kiosk_clock(text, text, numeric, numeric) to service_role;

create function set_kiosk_pin(p_membership_id uuid, p_pin_hash text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from memberships m
    where m.id = p_membership_id and can_manage_workspace(m.workspace_id)
  ) then
    raise exception 'insufficient privileges';
  end if;
  update memberships set kiosk_pin_hash = p_pin_hash where id = p_membership_id;
end;
$$;
