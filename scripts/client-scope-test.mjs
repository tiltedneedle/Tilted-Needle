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
// A second workspace, made only to own a client that is NOT ours.
let otherWsId = null;
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

  /* -- A manager cannot promote themselves to owner ------------------------ */
  //
  // The rules against this were written only in the Server Action. The repo is
  // public and the publishable key ships in the browser, so a manager can call
  // PostgREST directly and never reach that code. These assertions are against
  // the database, which is the only place the rule actually binds.
  {
    const manager = await makeUser(`scope-mgr-${stamp}@tiltedneedle.test`);
    userIds.push(manager.id);
    const { error: addErr } = await staff.client.from("memberships").insert({
      workspace_id: wsId, user_id: manager.id, role: "manager", seat: "full",
    });
    check("a manager can be added to the workspace", !addErr, addErr?.message ?? "");

    const { data: own } = await manager.client
      .from("memberships").select("id").eq("user_id", manager.id).maybeSingle();

    if (own) {
      const { data: promoted } = await manager.client
        .from("memberships").update({ role: "owner" }).eq("id", own.id).select("id");
      check("a manager cannot promote THEMSELVES to owner",
        (promoted ?? []).length === 0,
        (promoted ?? []).length ? "ESCALATION: became owner" : "");
    }

    const { data: ownerRow } = await staff.client
      .from("memberships").select("id").eq("user_id", staff.id).maybeSingle();
    if (ownerRow) {
      const { data: demoted } = await manager.client
        .from("memberships").update({ role: "member" }).eq("id", ownerRow.id).select("id");
      check("a manager cannot demote the owner",
        (demoted ?? []).length === 0,
        (demoted ?? []).length ? "ESCALATION: demoted the owner" : "");
    }

    // The guard must not break ordinary team admin, which edits other people's
    // rates and capacity through this same policy.
    const { data: portalRow } = await staff.client
      .from("memberships").select("id").eq("user_id", portal.id).maybeSingle();
    if (portalRow) {
      const { data: rated, error: rateErr } = await manager.client
        .from("memberships").update({ weekly_capacity_hours: 30 })
        .eq("id", portalRow.id).select("id");
      check("a manager can still edit a non-owner's capacity",
        !rateErr && (rated ?? []).length === 1,
        rateErr?.message ?? `${(rated ?? []).length} rows`);
    }

    /* -- Making a client user is not a way to unmake staff ----------------- */
    //
    // set_client_membership used to upsert over ANY membership: one call from
    // a manager turned the owner into a client user of whichever client they
    // named, and the client did not even have to belong to the workspace.
    const bind = (as, user, client) =>
      as.rpc("set_client_membership", { ws: wsId, target_user: user, target_client: client });
    const roleOf = async (userId) => {
      const { data } = await admin.from("memberships").select("role, client_id")
        .eq("workspace_id", wsId).eq("user_id", userId).maybeSingle();
      return data;
    };

    const { error: ownerErr } = await bind(manager.client, staff.id, clientA);
    check("a manager cannot turn the owner into a client user",
      !!ownerErr && (await roleOf(staff.id))?.role === "owner",
      ownerErr ? "" : "ESCALATION: the call succeeded");

    const { error: colleagueErr } = await bind(staff.client, manager.id, clientA);
    check("nor can anyone turn a colleague into one",
      !!colleagueErr && (await roleOf(manager.id))?.role === "manager",
      colleagueErr ? "" : "the call succeeded");

    const { error: selfErr } = await bind(manager.client, manager.id, clientA);
    check("nobody makes THEMSELVES a client user", !!selfErr,
      selfErr ? "" : "the call succeeded");

    const { error: byClientErr } = await bind(portal.client, manager.id, clientA);
    check("a client user cannot make client users", !!byClientErr,
      byClientErr ? "" : "LEAK: the call succeeded");

    // A client that is real, but somebody else's.
    const { data: other, error: otherErr } = await manager.client.rpc("create_workspace", {
      ws_name: `Scope other ${stamp}`,
      ws_slug: `scope-other-${stamp}`,
    });
    if (otherErr) throw new Error(`create second workspace: ${otherErr.message}`);
    otherWsId = other.id ?? other;
    const { data: foreign, error: foreignMkErr } = await manager.client
      .from("clients").insert({ workspace_id: otherWsId, name: "Somebody else's client" })
      .select("id").single();
    if (foreignMkErr) throw new Error(`create foreign client: ${foreignMkErr.message}`);

    const { error: foreignErr } = await bind(staff.client, portal.id, foreign.id);
    check("a client user cannot be bound to another workspace's client",
      !!foreignErr && (await roleOf(portal.id))?.client_id === clientA,
      foreignErr ? "" : "LEAK: bound across workspaces");

    // The one thing it may do to an existing membership: move a client user.
    const { error: moveErr } = await bind(staff.client, portal.id, clientB);
    const moved = await roleOf(portal.id);
    check("a client user can be moved to another client of the same workspace",
      !moveErr && moved?.role === "client" && moved?.client_id === clientB,
      moveErr?.message ?? "");
    {
      const { data: after } = await portal.client
        .from("client_guideline_sections").select("client_id");
      const ids = new Set((after ?? []).map((r) => r.client_id));
      check("and then sees the new client's rows and not the old one's",
        ids.has(clientB) && !ids.has(clientA), `saw ${[...ids].length} clients`);
    }
    const { error: backErr } = await bind(staff.client, portal.id, clientA);
    if (backErr) throw new Error(`move back to client A: ${backErr.message}`);
  }

  /* -- The agency's own books and journals --------------------------------- */
  //
  // Three places a client user was let into by being "a workspace member":
  // the merge journal (every merged video's contents, verbatim, for every
  // client), the expense ledger (which they could WRITE to), and the two
  // functions that spend and refund the transcription budget, which checked
  // nothing about the caller at all.
  {
    const { data: item, error: itemErr } = await admin.from("content_items")
      .insert({ workspace_id: wsId, title: "merge survivor" }).select("id").single();
    if (itemErr) throw new Error(`create content item: ${itemErr.message}`);
    const { error: journalErr } = await admin.from("content_merges").insert({
      workspace_id: wsId, survivor_id: item.id, loser_ids: [],
      journal: { losers: [{ title: "another client's unreleased video" }] },
    });
    if (journalErr) throw new Error(`create merge row: ${journalErr.message}`);

    const { data: clientMerges } = await portal.client.from("content_merges").select("id");
    check("a client user cannot read the merge journal",
      (clientMerges ?? []).length === 0,
      (clientMerges ?? []).length ? `LEAK: saw ${clientMerges.length} merges` : "");
    const { data: staffMerges } = await staff.client.from("content_merges").select("id");
    check("staff still read the merge journal",
      (staffMerges ?? []).length === 1, `saw ${(staffMerges ?? []).length}`);

    const { error: fileErr } = await portal.client.from("expenses").insert({
      workspace_id: wsId, user_id: portal.id, amount: 10, notes: "injected",
    });
    check("a client user cannot file an expense in the agency's books", !!fileErr,
      fileErr ? "" : "LEAK: insert succeeded");
    const { data: filed, error: staffFileErr } = await staff.client.from("expenses")
      .insert({ workspace_id: wsId, user_id: staff.id, amount: 12 }).select("id");
    check("staff can still file an expense",
      !staffFileErr && (filed ?? []).length === 1, staffFileErr?.message ?? "");
    const { data: clientExpenses } = await portal.client.from("expenses").select("id");
    check("a client user sees no expenses",
      (clientExpenses ?? []).length === 0, `saw ${(clientExpenses ?? []).length}`);
    const { data: staffExpenses } = await staff.client.from("expenses").select("id");
    check("staff still see their own",
      (staffExpenses ?? []).length === 1, `saw ${(staffExpenses ?? []).length}`);

    const anon = createClient(SUPABASE_URL, PUBLISHABLE, { auth: { persistSession: false } });
    const budget = (as, fn) => as.rpc(fn, { p_workspace_id: wsId, p_micros: 1 });
    for (const [who, as] of [["a client user", portal.client], ["the owner", staff.client], ["a signed-out caller", anon]]) {
      for (const fn of ["claim_transcription_budget", "refund_transcription_budget"]) {
        const { error } = await budget(as, fn);
        check(`${who} cannot call ${fn}`, !!error, error ? "" : "LEAK: the call succeeded");
      }
    }
    const { data: granted, error: claimErr } = await budget(admin, "claim_transcription_budget");
    check("the worker's service role still claims budget",
      !claimErr && Number(granted) === 1, claimErr?.message ?? `granted ${granted}`);
    const { error: refundErr } = await budget(admin, "refund_transcription_budget");
    check("and still refunds it", !refundErr, refundErr?.message ?? "");
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
  if (otherWsId) await admin.from("workspaces").delete().eq("id", otherWsId);
  for (const id of userIds) await admin.auth.admin.deleteUser(id).catch(() => {});
  console.log("\ncleaned up test workspace and users");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
