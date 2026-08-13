-- Let the Kiosks page ask WHETHER a PIN is set without reading the hash.
--
-- The hardening migration revoked column-level SELECT on kiosk_pin_hash, which
-- was correct: the hash is unsalted SHA-256 over a 4-8 digit PIN, so the whole
-- keyspace is precomputable and the column is effectively cleartext.
--
-- But the Kiosks page still selected it, and PostgREST refuses the WHOLE query
-- when any requested column is revoked -- 403, code 42501. So the page was not
-- degrading to "no PINs shown", it was failing outright: the member list never
-- loaded for anyone. The revoke was right and the caller was never updated.
--
-- A boolean is the only thing the UI ever needed. SECURITY DEFINER so it can
-- read the column the caller cannot, with the manager check INSIDE the query
-- so a non-manager gets an empty result rather than a roster.

create or replace function kiosk_pin_status(ws uuid)
returns table (membership_id uuid, has_pin boolean)
language sql
security definer
stable
set search_path = public
as $$
  select m.id, m.kiosk_pin_hash is not null
  from memberships m
  where m.workspace_id = ws
    and m.is_active
    and can_manage_workspace(ws);
$$;

comment on function kiosk_pin_status(uuid) is
  'Whether each active member has a kiosk PIN, without exposing the hash. Managers only; returns nothing otherwise.';

revoke all on function kiosk_pin_status(uuid) from public, anon;
grant execute on function kiosk_pin_status(uuid) to authenticated;
