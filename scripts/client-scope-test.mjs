// Client-role isolation INSIDE one workspace.
//
// rls-test.mjs proves two workspaces cannot see each other. That is a
// different boundary, and the gap between them is where a real hole lived:
// client_guideline_sections and client_assets were gated on
// is_workspace_member() alone, and a portal client IS a workspace member, so
// one agency client could read AND edit every other client's brand guidelines.
// Cross-tenant tests all passed the whole time, because the attacker and the
// victim were in the same tenant.
//
// So this asserts the other axis: within ONE workspace, a client user sees
// their own client's rows and nothing else, and cannot write at all.
//
// Cleans up after itself -- the audit found nine users and four workspaces
// left behind in production by the older suite.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

function env(name) {
  if (process.env[name]) return process.env[name];
  try {
    return readFileSync(new URL("../.env.local", import.meta.url), "utf8")
      .split("\n")
      .find((l) => l.startsWith(`${name}=`))
      ?.slice(name.length + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
}

const SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL");
const PUBLISHABLE = env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const SECRET = env("SUPABASE_SECRET_KEY");

if (!SUPABASE_URL || !PUBLISHABLE || !SECRET) {
  console.error("Missing Supabase env. Need URL, publishable key and secret key.");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SECRET, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

async function makeUser(email) {
  const { data: list } = await admin.auth.admin.listUsers();
  const existing = list?.users?.find((u) => u.email === email);
  if (existing) await admin.auth.admin.deleteUser(existing.id);
  const { data, error } = await admin.auth.admin.createUser({
    email, password: "TestPassword!234", email_confirm: true,
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  const c = createClient(SUPABASE_URL, PUBLISHABLE, { auth: { persistSession: false } });
  const { error: e } = await c.auth.signInWithPassword({ email, password: "TestPassword!234" });
  if (e) throw new Error(`signIn ${email}: ${e.message}`);
  return { id: data.user.id, client: c };
}

const stamp = Date.now();
const staffEmail = `scope-staff-${stamp}@tiltedneedle.test`;
const clientEmail = `scope-client-${stamp}@tiltedneedle.test`;
let wsId = null;
const userIds = [];

try {
  const staff = await makeUser(staffEmail);
  const portal = await makeUser(clientEmail);
  userIds.push(staff.id, portal.id);

  const { data: ws, error: wsErr } = await staff.client.rpc("create_workspace", {
    ws_name: `Scope test ${stamp}`,
    ws_slug: `scope-test-${stamp}`,
  });
  if (wsErr) throw new Error(`create_workspace: ${wsErr.message}`);
  wsId = ws.id ?? ws;

  const mk = async (name) => {
    const { data, error } = await staff.client
      .from("clients").insert({ workspace_id: wsId, name }).select("id").single();
    if (error) throw new Error(`create client ${name}: ${error.message}`);
    return data.id;
  };
  const clientA = await mk("Client A");
  const clientB = await mk("Client B");

  const section = async (cid, title) => {
    const { error } = await staff.client.from("client_guideline_sections").insert({
      workspace_id: wsId, client_id: cid, title, body: "secret brand rules",
    });
    if (error) throw new Error(`create section: ${error.message}`);
  };
  await section(clientA, "A brief");
  await section(clientB, "B brief");

  // Bind the portal user to client A only.
  const { error: memErr } = await staff.client.rpc("set_client_membership", {
    ws: wsId, target_user: portal.id, target_client: clientA,
  });
  if (memErr) throw new Error(`set_client_membership: ${memErr.message}`);

  /* -- The actual boundary ------------------------------------------------- */

  const { data: seen } = await portal.client
    .from("client_guideline_sections").select("client_id,title");
  const rows = seen ?? [];

  check("a client user sees their OWN guideline section",
    rows.some((r) => r.client_id === clientA), `saw ${rows.length} rows`);
  check("a client user CANNOT see another client's guideline section",
    !rows.some((r) => r.client_id === clientB),
    rows.some((r) => r.client_id === clientB) ? "LEAK: read Client B" : "");

  const { data: direct } = await portal.client
    .from("client_guideline_sections").select("title").eq("client_id", clientB);
  check("asking for the other client's rows by id returns nothing",
    (direct ?? []).length === 0, `got ${(direct ?? []).length}`);

  const { error: insErr } = await portal.client.from("client_guideline_sections").insert({
    workspace_id: wsId, client_id: clientA, title: "injected", body: "x",
  });
  check("a client user cannot INSERT a guideline section", !!insErr,
    insErr ? "" : "LEAK: insert succeeded");

  const { data: upd } = await portal.client
    .from("client_guideline_sections").update({ body: "tampered" })
    .eq("client_id", clientA).select("id");
  check("a client user cannot UPDATE their own guidelines either",
    (upd ?? []).length === 0, `${(upd ?? []).length} rows changed`);

  const { data: assets } = await portal.client.from("client_assets").select("client_id");
  check("client_assets is scoped the same way",
    !(assets ?? []).some((r) => r.client_id === clientB),
    (assets ?? []).some((r) => r.client_id === clientB) ? "LEAK: read Client B assets" : "");


  /* -- Vendor spend is not the client's business ---------------------------- */
  //
  // getScrapeBudget had the same shape of bug as the guidelines leak: a
  // caller-supplied workspaceId handed to a service client, which bypasses
  // RLS, gated only on being signed in. That guard now lives in the server
  // action and cannot be reached from here.
  //
  // What IS assertable at this layer is the policy underneath it, which is the
  // thing that has to hold if the app-level check is ever bypassed or
  // refactored away: scrape_budgets excludes client-role members outright.
  {
    const { data: budgets } = await portal.client
      .from("scrape_budgets").select("platform_slug,used_discovery");
    check("a client user cannot read the workspace's vendor spend",
      (budgets ?? []).length === 0,
      (budgets ?? []).length ? `LEAK: saw ${(budgets ?? []).length} budget rows` : "");
  }

  // Staff must still see everything -- a fix that locks out the agency is a
  // regression, not a fix.
  const { data: staffSees } = await staff.client
    .from("client_guideline_sections").select("client_id");
  check("staff still see every client's guidelines",
    new Set((staffSees ?? []).map((r) => r.client_id)).size === 2,
    `saw ${new Set((staffSees ?? []).map((r) => r.client_id)).size} clients`);
} catch (e) {
  check("test harness ran", false, String(e.message ?? e));
} finally {
  if (wsId) await admin.from("workspaces").delete().eq("id", wsId);
  for (const id of userIds) await admin.auth.admin.deleteUser(id).catch(() => {});
  console.log("\ncleaned up test workspace and users");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
