import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client. Bypasses RLS entirely, so every call site must enforce
 * its own authorization before using it -- never expose this client, or
 * anything it returns unfiltered, to a Server Component's render output.
 *
 * Exists for the work no user session can do under RLS: the scheduled sync
 * writing snapshots on nobody's behalf, and the ingest worker reading and
 * writing across the whole workspace from outside any session at all.
 *
 * The `server-only` import makes accidentally bundling this into client code
 * a build error rather than a leaked secret key.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not set. Required for the scheduled sync and the ingest worker.",
    );
  }
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
