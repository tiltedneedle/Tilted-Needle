-- PostgREST only exposes functions in the `public` schema by default, and
-- `vault.create_secret` lives in `vault`. This wrapper is what makes the
-- refresh-token write reachable from the OAuth callback route at all.
--
-- Restricted to service_role: the callback route uses the admin client
-- (SUPABASE_SECRET_KEY) specifically because the `authenticated` role has no
-- grant on the vault schema whatsoever (verified against the live project).
-- If this were callable by `authenticated`, any signed-in user could write
-- arbitrary vault secrets.

create function vault_store_refresh_token(p_secret text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  new_id uuid;
begin
  select vault.create_secret(p_secret, p_name) into new_id;
  return new_id;
end;
$$;

revoke execute on function vault_store_refresh_token(text, text) from public, authenticated, anon;
grant execute on function vault_store_refresh_token(text, text) to service_role;
