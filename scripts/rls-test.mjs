// Two-tenant isolation test. Creates two users in two workspaces and asserts
// neither can read or write the other's data through the publishable key.
//
// RLS is the only tenant boundary in this app -- the repo is public and the
// publishable key ships in the browser bundle. Run this after any policy or
// schema change:  npm run test:rls
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

function env(name) {
  if (process.env[name]) return process.env[name];
  try {
    const file = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    return file
      .split("\n")
      .find((l) => l.startsWith(`${name}=`))
      ?.slice(name.length + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
}

// Deliberately not named URL: a module-scope `const URL` shadows the global
// URL constructor that env() itself uses, and the TDZ makes that a runtime
// error during initialisation.
const SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL");
const PUBLISHABLE = env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const SECRET = env("SUPABASE_SECRET_KEY");

if (!SUPABASE_URL || !PUBLISHABLE || !SECRET) {
  console.error("Missing Supabase env vars (checked env and .env.local).");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SECRET, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  if (ok) pass++;
  else fail++;
};

async function mkUser(email) {
  await admin.auth.admin
    .listUsers()
    .then(({ data }) => {
      const found = data?.users?.find((u) => u.email === email);
      return found ? admin.auth.admin.deleteUser(found.id) : null;
    })
    .catch(() => {});
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: "TestPassword!234",
    email_confirm: true,
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  const client = createClient(SUPABASE_URL, PUBLISHABLE, { auth: { persistSession: false } });
  const { error: signInErr } = await client.auth.signInWithPassword({
    email,
    password: "TestPassword!234",
  });
  if (signInErr) throw new Error(`signIn ${email}: ${signInErr.message}`);
  return { id: data.user.id, client };
}

(async () => {
  const stamp = Date.now();
  const a = await mkUser(`rls-a-${stamp}@example.com`);
  const b = await mkUser(`rls-b-${stamp}@example.com`);

  // Each user creates their own workspace via the bootstrap RPC.
  const { data: wsA, error: eA } = await a.client.rpc("create_workspace", {
    ws_name: "Tenant A", ws_slug: `tenant-a-${stamp}`,
  });
  check("user A can create a workspace", !eA && !!wsA, eA?.message);

  const { data: wsB, error: eB } = await b.client.rpc("create_workspace", {
    ws_name: "Tenant B", ws_slug: `tenant-b-${stamp}`,
  });
  check("user B can create a workspace", !eB && !!wsB, eB?.message);

  // Owner membership must exist, or the workspace is unreachable.
  const { data: mA } = await a.client.from("memberships").select("role")
    .eq("workspace_id", wsA.id);
  check("owner membership created atomically", mA?.[0]?.role === "owner");

  // A creates a client + project + entry.
  const { data: clientA, error: ceA } = await a.client.from("clients")
    .insert({ workspace_id: wsA.id, name: "Client A" }).select().single();
  check("owner can create a client", !ceA && !!clientA, ceA?.message);

  const { data: projA, error: peA } = await a.client.from("projects")
    .insert({ workspace_id: wsA.id, client_id: clientA.id, name: "Project A" })
    .select().single();
  check("owner can create a project", !peA && !!projA, peA?.message);

  const { error: teA } = await a.client.from("time_entries").insert({
    workspace_id: wsA.id, user_id: a.id, project_id: projA.id,
    description: "Secret video title A",
    started_at: new Date(Date.now() - 3600e3).toISOString(),
    ended_at: new Date().toISOString(),
  });
  check("owner can create a time entry", !teA, teA?.message);

  // --- Isolation ---
  const { data: bSeesWs } = await b.client.from("workspaces").select("*").eq("id", wsA.id);
  check("B cannot read A's workspace", (bSeesWs?.length ?? 0) === 0);

  const { data: bSeesClients } = await b.client.from("clients").select("*");
  check("B cannot read A's clients", !bSeesClients?.some((c) => c.id === clientA.id));

  const { data: bSeesProjects } = await b.client.from("projects").select("*");
  check("B cannot read A's projects", !bSeesProjects?.some((p) => p.id === projA.id));

  const { data: bSeesEntries } = await b.client.from("time_entries").select("*");
  check("B cannot read A's time entries", (bSeesEntries?.length ?? 0) === 0);

  // Cross-tenant write attempts must be rejected.
  const { error: bWrite } = await b.client.from("projects")
    .insert({ workspace_id: wsA.id, name: "Injected by B" });
  check("B cannot insert into A's workspace", !!bWrite, bWrite ? "" : "INSERT SUCCEEDED");

  const { error: bSpoof } = await b.client.from("time_entries").insert({
    workspace_id: wsA.id, user_id: a.id, description: "spoofed",
    started_at: new Date().toISOString(), ended_at: new Date(Date.now() + 60e3).toISOString(),
  });
  check("B cannot forge an entry as A", !!bSpoof, bSpoof ? "" : "INSERT SUCCEEDED");

  const { data: bUpd } = await b.client.from("clients")
    .update({ name: "hacked" }).eq("id", clientA.id).select();
  check("B cannot update A's client", (bUpd?.length ?? 0) === 0);

  const { data: bDel } = await b.client.from("time_entries")
    .delete().eq("workspace_id", wsA.id).select();
  check("B cannot delete A's entries", (bDel?.length ?? 0) === 0);

  // --- Phase 2 content layer ---
  const { data: acct, error: acctErr } = await a.client
    .from("accounts")
    .insert({
      workspace_id: wsA.id,
      client_id: clientA.id,
      platform_slug: "instagram",
      handle: "@tenant_a",
    })
    .select()
    .single();
  check("owner can create an account", !acctErr && !!acct, acctErr?.message);

  const { data: item, error: itemErr } = await a.client
    .from("content_items")
    .insert({ workspace_id: wsA.id, client_id: clientA.id, title: "Secret content A" })
    .select()
    .single();
  check("owner can create content", !itemErr && !!item, itemErr?.message);

  const { data: post, error: postErr } = await a.client
    .from("platform_posts")
    .insert({
      workspace_id: wsA.id,
      content_item_id: item.id,
      account_id: acct.id,
      source: "manual",
    })
    .select()
    .single();
  check("owner can create a post", !postErr && !!post, postErr?.message);

  const { error: snapErr } = await a.client.from("post_snapshots").insert({
    workspace_id: wsA.id,
    platform_post_id: post.id,
    views: 12345,
    likes: 678,
  });
  check("owner can record a snapshot", !snapErr, snapErr?.message);

  // The platform registry is shared reference data, readable by everyone.
  const { data: plats } = await b.client.from("platforms").select("slug");
  check("registry readable by any member", (plats?.length ?? 0) >= 4);
  const { error: platWrite } = await b.client
    .from("platforms")
    .insert({ slug: "rogue", display_name: "Rogue" });
  check("registry not writable by members", !!platWrite, platWrite ? "" : "INSERT SUCCEEDED");

  // Isolation across the new tables.
  const { data: bAcc } = await b.client.from("accounts").select("*");
  check("B cannot read A's accounts", (bAcc?.length ?? 0) === 0);
  const { data: bItems } = await b.client.from("content_items").select("*");
  check("B cannot read A's content", (bItems?.length ?? 0) === 0);
  const { data: bPosts } = await b.client.from("platform_posts").select("*");
  check("B cannot read A's posts", (bPosts?.length ?? 0) === 0);
  const { data: bSnaps } = await b.client.from("post_snapshots").select("*");
  check("B cannot read A's snapshots", (bSnaps?.length ?? 0) === 0);

  // The metrics view must be filtered by the caller's RLS, not the view
  // owner's -- this is what security_invoker buys.
  const { data: bMetrics } = await b.client.from("post_current_metrics").select("*");
  check("metrics view does not leak across tenants", (bMetrics?.length ?? 0) === 0);
  const { data: aMetrics } = await a.client.from("post_current_metrics").select("*");
  check("metrics view returns own rows", (aMetrics?.length ?? 0) === 1);

  const { error: bInject } = await b.client.from("content_items").insert({
    workspace_id: wsA.id,
    title: "Injected by B",
  });
  check("B cannot inject content into A", !!bInject, bInject ? "" : "INSERT SUCCEEDED");

  // Anonymous access must see nothing at all.
  const anon = createClient(SUPABASE_URL, PUBLISHABLE, { auth: { persistSession: false } });
  const { data: anonWs } = await anon.from("workspaces").select("*");
  check("anonymous reads no workspaces", (anonWs?.length ?? 0) === 0);
  const { data: anonTe } = await anon.from("time_entries").select("*");
  check("anonymous reads no time entries", (anonTe?.length ?? 0) === 0);
  const { data: anonContent } = await anon.from("content_items").select("*");
  check("anonymous reads no content", (anonContent?.length ?? 0) === 0);
  const { data: anonMetrics } = await anon.from("post_current_metrics").select("*");
  check("anonymous reads no metrics", (anonMetrics?.length ?? 0) === 0);

  // One running timer per user.
  await a.client.from("time_entries").insert({
    workspace_id: wsA.id, user_id: a.id, description: "running 1",
    started_at: new Date().toISOString(),
  });
  const { error: dupTimer } = await a.client.from("time_entries").insert({
    workspace_id: wsA.id, user_id: a.id, description: "running 2",
    started_at: new Date().toISOString(),
  });
  check("second concurrent timer rejected", !!dupTimer, dupTimer ? "" : "ALLOWED TWO TIMERS");

  // Cleanup. workspaces.owner_id is ON DELETE RESTRICT, so the workspace must
  // go first -- deleting the user alone fails silently and leaves orphans.
  for (const [user, ws] of [
    [a, wsA],
    [b, wsB],
  ]) {
    if (ws) {
      const { error } = await admin.from("workspaces").delete().eq("id", ws.id);
      if (error) console.log(`  cleanup: workspace ${ws.id} -> ${error.message}`);
    }
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) console.log(`  cleanup: user ${user.id} -> ${error.message}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
