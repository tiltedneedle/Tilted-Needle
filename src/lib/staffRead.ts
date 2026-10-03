import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * Whether the person making this request is active staff of `ws`: a member
 * of it, and not a client user.
 *
 * Asked of the database as that person, through the same two functions the
 * row-level security policies use, so "staff" means here exactly what it
 * means there. Remembered for the length of one render, so a page that
 * reads three caches asks once.
 */
export const callerIsStaffOf = cache(async (ws: string): Promise<boolean> => {
  const supabase = await createClient();
  const [member, client] = await Promise.all([
    supabase.rpc("is_workspace_member", { ws }),
    supabase.rpc("is_client_user", { ws }),
  ]);
  // Anything short of two clear answers is a no.
  return !member.error && !client.error && member.data === true && client.data === false;
});

/**
 * The gate on a read that goes through the service role.
 *
 * Such a read has no row-level security under it: whatever it loads, it
 * loads for whoever asked. cachedContentData and cachedRankings load a
 * whole workspace, every client's work in it, and were safe only because
 * "a client user never reaches this code". That was a promise kept somewhere
 * else (the layout, then requireSession), and a promise kept somewhere else
 * is how another client's video reached a client's screen (see
 * lib/routeAccess.ts). So the read checks for itself, whoever calls it and
 * from wherever: no staff membership of that workspace, no data.
 *
 * It throws rather than redirects. A page sends people where they belong
 * before it gets here; arriving here without the right is a fault in the
 * caller, and should look like one.
 */
export async function assertStaffRead(ws: string, what: string): Promise<void> {
  if (!(await callerIsStaffOf(ws))) {
    throw new Error(`${what} is read through the service role and is for staff of the workspace only.`);
  }
}
