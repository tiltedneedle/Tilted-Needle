import { canManage, type WorkspaceRole } from "@/lib/types";

/**
 * Which pages each role may open, and where everyone else is sent.
 *
 * WHY THIS IS NOT IN THE LAYOUT ANY MORE
 *
 * It was: the (app) layout read the path and redirected. But a layout is
 * rendered once and kept. On a navigation inside the app the server renders
 * only the page that changed, so the layout's check never ran again. A
 * client user sitting on /portal could ask the router for /content (one line
 * in the browser's console, `next.router.push("/content")`) and was given
 * the page.
 *
 * Most pages then showed them nothing, because they read as the user and
 * row-level security answers. But /content, /home and /reports read the
 * whole workspace through a service-role cache (cachedContentData,
 * cachedRankings), which has no row-level security to fall back on: another
 * client's name and video arrived in the response and were on the client's
 * screen. The same route let a plain member into management's pages.
 * Found 2026-10-03 against the production build, before any client account
 * existed; scripts/client-nav-test.mjs reproduces it and holds the fix.
 *
 * So the rule is applied by requireSession(), which every page calls for
 * itself on every render. The layout still calls it too, which covers a
 * plain visit; the page's own call is the one that cannot be skipped.
 *
 * Row-level security remains the boundary for everything read as the user.
 * This list is the boundary for the pages that read through the service
 * role, and a courtesy for the rest (nobody is shown an empty Reports page).
 */

/** The only route a client-role user is meant to reach. */
export const CLIENT_ALLOWED = ["/portal"];

/**
 * Where a plain member can go: their own day-to-day surface. Everything
 * else -- the performance dashboards, billing, workspace admin -- is
 * management's. An allow-list rather than a block-list, so any page added
 * later is manager-only until deliberately opened up.
 */
export const MEMBER_ALLOWED = [
  "/home",
  "/todos",
  "/training",
  "/guidelines",
  "/track",
  "/timesheet",
  "/dashboard",
  "/time-off",
];

const within = (list: string[], pathname: string) =>
  list.some((p) => pathname === p || pathname.startsWith(`${p}/`));

/**
 * Where `role` must be sent instead of `pathname`, or null when it may stay.
 *
 * `pathname` is what the proxy saw (the x-pathname header it sets on every
 * request it handles), and is empty only for a request the proxy never
 * handled. A client user is turned away then as well: they are outside the
 * company, and "could not tell where you were going" is not a reason to let
 * them through. A member is let through, as before: every page they could
 * reach that way reads as them.
 */
export function redirectFor(role: WorkspaceRole, pathname: string): string | null {
  if (role === "client") return pathname && within(CLIENT_ALLOWED, pathname) ? null : "/portal";
  if (!pathname) return null;
  if (!canManage(role)) return within(MEMBER_ALLOWED, pathname) ? null : "/home";
  return null;
}
