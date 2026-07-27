-- Counterpart to vault_store_refresh_token: lets a disconnect actually erase
-- the stored token rather than merely marking the connection row inactive
-- and leaving the secret behind in vault.secrets.

create function vault_delete_secret(p_secret_id uuid)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  delete from vault.secrets where id = p_secret_id;
end;
$$;

revoke execute on function vault_delete_secret(uuid) from public, authenticated, anon;
grant execute on function vault_delete_secret(uuid) to service_role;
