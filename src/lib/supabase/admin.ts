import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client. Bypasses RLS entirely, so every call site must enforce
 * its own authorization before using it -- never expose this client, or
 * anything it returns unfiltered, to a Server Component's render output.
 *
 * Exists for exactly two things Phase 6 needs that RLS cannot grant to a
 * normal session: writing to Supabase Vault (the `authenticated` role has no
 * grant on the vault schema at all -- confirmed against the live project,
 * not assumed) and exchanging an OAuth code, which must happen with a secret
 * only the server holds.
 *
 * The `server-only` import makes accidentally bundling this into client code
 * a build error rather than a leaked secret key.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not set. Required for OAuth token exchange and vault writes.",
    );
  }
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
