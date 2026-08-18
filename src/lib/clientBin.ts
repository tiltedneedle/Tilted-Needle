/**
 * Recycle-bin constants and shapes.
 *
 * Separate from actions.ts because a "use server" file may only export async
 * functions -- `export const CLIENT_BIN_DAYS = 7` there fails the build with
 * "Only async functions are allowed to be exported in a 'use server' file",
 * which is easy to miss since typecheck passes and only the bundler objects.
 *
 * Import-free, so both the server actions and the client-side bin panel can
 * read it without dragging anything into the browser bundle.
 */

/**
 * How long a binned client can be restored for. After this, the purge takes
 * the client AND all of its content -- see purge_deleted_clients() in
 * supabase/migrations/20260817220000_client_recycle_bin.sql.
 */
export const CLIENT_BIN_DAYS = 7;

export type BinnedClient = {
  id: string;
  name: string;
  deletedAt: string;
  /** Rounded UP, so six hours left reads as "1 day" rather than "0". */
  daysLeft: number;
  itemCount: number;
};
