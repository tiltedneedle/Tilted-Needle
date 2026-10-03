// Who may open which page, and the two rules that keep that true.
//   npm run test:routes
//
// WHY THIS IS A TEST
//
// The rule used to live in the (app) layout, and looked right there for
// months: a client user who typed /content was sent to /portal. But a layout
// is not rendered again on a navigation inside the app, so a client user
// already on /portal could ask the router for /content and get it, and
// /content reads the whole workspace through the service role. Another
// client's name and video were on their screen (reproduced 2026-10-03
// against the production build; scripts/client-nav-test.mjs is that
// reproduction, and needs a running server).
//
// The fix is three things, and each is the kind that erodes quietly:
//   1. requireSession() applies the rule, so a page must CALL it;
//   2. the service-role caches check the caller themselves;
//   3. a new use of the service role is a new place with no row-level
//      security under it, and someone has to look at it.
// So: the rule itself, then each of those three, read off the source.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { redirectFor, CLIENT_ALLOWED, MEMBER_ALLOWED } from "../src/lib/routeAccess.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};
const rel = (p) => relative(".", p).split("\\").join("/");
/** Source with its comments taken out, so a rule cannot be met by a remark. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ---- The rule ----------------------------------------------------------- */
{
  check("a client user may open /portal", redirectFor("client", "/portal") === null);
  check("and what is under it", redirectFor("client", "/portal/anything") === null);
  for (const p of ["/content", "/home", "/reports", "/reports/client", "/team-admin", "/clients", "/clients/abc", "/todos", "/portalx", "/"]) {
    check(`a client user is sent from ${p} to /portal`, redirectFor("client", p) === "/portal", String(redirectFor("client", p)));
  }
  check("a client user with no known path is sent to /portal, not let through",
    redirectFor("client", "") === "/portal");

  for (const p of MEMBER_ALLOWED) {
    check(`a member may open ${p}`, redirectFor("member", p) === null && redirectFor("member", p + "/x") === null);
  }
  for (const p of ["/content", "/reports", "/team-admin", "/clients", "/rates", "/invoices", "/expenses", "/portal", "/homepage", "/todos-old"]) {
    check(`a member is sent from ${p} to /home`, redirectFor("member", p) === "/home", String(redirectFor("member", p)));
  }
  for (const role of ["owner", "admin", "manager"]) {
    check(`${role} may open anything`,
      ["/content", "/team-admin", "/portal", "/home", "/anything-new", ""].every((p) => redirectFor(role, p) === null));
  }
  check("the client list is /portal and nothing else", CLIENT_ALLOWED.join() === "/portal", CLIENT_ALLOWED.join());
  check("no management page has slipped into the member list",
    !MEMBER_ALLOWED.some((p) => ["/content", "/reports", "/team-admin", "/clients", "/rates", "/invoices", "/expenses", "/data", "/developers", "/audit-log"].includes(p)),
    MEMBER_ALLOWED.join());
}

/* ---- 1. Every page asks for itself --------------------------------------- */
{
  const session = code(readFileSync("src/lib/workspace.ts", "utf8"));
  check("requireSession() applies the rule",
    /redirectFor\(\s*active\.role/.test(session) && /x-pathname/.test(session));

  const pages = walk("src/app/(app)").filter((f) => /[\\/]page\.tsx$/.test(f));
  check("there are pages to check", pages.length > 20, `${pages.length} pages`);
  const bare = [];
  for (const file of pages) {
    const text = code(readFileSync(file, "utf8"));
    if (/await requireSession\(\)/.test(text)) continue;
    // A page that never asks who is there may only be a signpost: it imports
    // the router's redirect and nothing that could load anything.
    const imports = [...text.matchAll(/^\s*import[\s\S]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
    const signpost = imports.every((from) => from === "next/navigation") && /redirect\(/.test(text);
    if (!signpost) bare.push(rel(file));
  }
  check("every page under (app) calls requireSession(), or only redirects",
    bare.length === 0, bare.join(", "));

  const layout = code(readFileSync("src/app/(app)/layout.tsx", "utf8"));
  check("the layout calls it too (a plain visit), and keeps no list of its own",
    /await requireSession\(\)/.test(layout) && !/_ALLOWED/.test(layout));
}

/* ---- 2. The service-role caches check the caller themselves -------------- */
{
  for (const [file, fn] of [["src/lib/cachedContentData.ts", "cachedContentData"], ["src/lib/cachedRankings.ts", "cachedRankings"]]) {
    const text = code(readFileSync(file, "utf8"));
    const body = text.slice(text.indexOf(`export async function ${fn}(`));
    const gate = body.indexOf("await assertStaffRead(ws");
    const read = body.indexOf("cached(ws)");
    check(`${fn} checks the caller before it reads`, gate > -1 && read > -1 && gate < read);
  }
  const guard = code(readFileSync("src/lib/staffRead.ts", "utf8"));
  check("the check asks the database as the caller, with the policies' own functions",
    /rpc\("is_workspace_member"/.test(guard) && /rpc\("is_client_user"/.test(guard) && /@\/lib\/supabase\/server/.test(guard));
  check("and anything short of a clear yes is a no",
    /member\.data === true/.test(guard) && /client\.data === false/.test(guard) && /!member\.error/.test(guard) && /!client\.error/.test(guard));
}

/* ---- 3. Where the service role is used ----------------------------------- */
//
// Each of these runs with no row-level security under it, so each has to
// decide for itself who is asking. The list is pinned: a file that starts
// using the service role fails here until someone has read it with that
// question in mind and added it, with the answer.
{
  const KNOWN = {
    "src/lib/supabase/admin.ts": "defines createAdminClient",
    "src/lib/syncRunner.ts": "defines serviceClient; the sync itself, called by the cron route and by manager-checked actions",
    "src/lib/cachedContentData.ts": "assertStaffRead on every call",
    "src/lib/cachedRankings.ts": "assertStaffRead on every call",
    "src/lib/publicApi.ts": "resolves an API key; the key is the credential",
    "src/app/api/v1/content/route.ts": "public API, behind resolveApiKey",
    "src/app/api/v1/time-entries/route.ts": "public API, behind resolveApiKey",
    "src/app/api/kiosk/clock/route.ts": "kiosk device token plus a PIN",
    "src/app/kiosk/[deviceToken]/page.tsx": "kiosk device token",
    "src/app/api/sync/route.ts": "Bearer CRON_SECRET, checked in the route",
    "src/app/(app)/team-admin/page.tsx": "emails and last sign-in, only inside canManage(session.active.role)",
    "src/app/actions.ts": "each action checks the caller manages the workspace (MANAGER_ROLES, guardedMembershipTarget, or an RLS write first)",
  };
  const users = walk("src")
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => /\b(serviceClient|createAdminClient)\s*\(/.test(code(readFileSync(f, "utf8"))))
    .map(rel)
    .sort();
  const unknown = users.filter((f) => !(f in KNOWN));
  const gone = Object.keys(KNOWN).filter((f) => !users.includes(f));
  check("no new file uses the service role unexamined", unknown.length === 0,
    unknown.length ? "read these for who can reach them, then add them to KNOWN: " + unknown.join(", ") : "");
  check("the pinned list has no entry that no longer applies", gone.length === 0, gone.join(", "));

  // The team actions that act through the service role sit behind the guard
  // that checks the caller manages the team.
  const actions = code(readFileSync("src/app/actions.ts", "utf8"));
  const guard = actions.slice(actions.indexOf("async function guardedMembershipTarget("), actions.indexOf("export async function setMemberRole("));
  check("guardedMembershipTarget requires a manager of the target's workspace",
    /workspace_id/.test(guard) && /MANAGER_ROLES\.includes\(caller\.role/.test(guard) && /caller\?\.is_active/.test(guard));
  for (const fn of ["sendPasswordReset", "resendInvite"]) {
    const at = actions.indexOf(`export async function ${fn}(`);
    const body = actions.slice(at, actions.indexOf("\nexport async function ", at + 10));
    const gate = body.indexOf("guardedMembershipTarget(");
    const admin = body.indexOf("createAdminClient()");
    check(`${fn} passes the guard before it touches the service role`, gate > -1 && admin > -1 && gate < admin);
    // A link for somebody else must be one THEY can open. The caller's own
    // client starts a PKCE flow whose other half stays in the caller's
    // browser, so its links work for nobody but the sender.
    check(`${fn} never sends through the caller's own client`,
      !/supabase\.auth\.(resetPasswordForEmail|signInWithOtp)\(/.test(body) && /admin\.auth\./.test(body));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
