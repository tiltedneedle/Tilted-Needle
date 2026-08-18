// The recycle bin, exercised against the real database.
//
// This is the one feature in the product that destroys data on purpose, so it
// is tested by doing it: create a throwaway client with content, bin it,
// restore it, bin it again, backdate it past the grace window, purge, and
// check what survived at every step.
//
// Two properties matter more than the happy path:
//
//   1. BINNING KEEPS EVERYTHING. The content must still exist, still linked,
//      or restore is a lie. Every client_id foreign key is ON DELETE SET NULL,
//      so a hard delete would silently orphan the videos instead -- which is
//      the bug this design exists to avoid, and the one worth asserting.
//
//   2. PURGING TAKES EVERYTHING. After the window the client AND its content
//      go, and the posts and snapshots beneath them go too. A purge that left
//      orphaned rows behind would grow the database forever with data nobody
//      can reach.
//
// It cleans up after itself even when an assertion fails.

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")]; }),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

let pass = 0, fail = 0;
const failures = [];
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else { fail++; failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label.padEnd(52)} ${JSON.stringify(actual)}`);
}

const STAMP = "zz-bin-test-" + process.pid;
let clientId = null;
let itemId = null;

try {
  const { data: ws } = await db.from("workspaces").select("id").limit(1).single();

  // --- set up: a client with one video -------------------------------------
  const { data: c, error: cErr } = await db.from("clients")
    .insert({ workspace_id: ws.id, name: STAMP }).select("id").single();
  if (cErr) throw new Error("could not create test client: " + cErr.message);
  clientId = c.id;

  const { data: it, error: iErr } = await db.from("content_items")
    .insert({ workspace_id: ws.id, client_id: clientId, title: STAMP + " video" })
    .select("id").single();
  if (iErr) throw new Error("could not create test content: " + iErr.message);
  itemId = it.id;

  console.log("\n=== bin ===");
  await db.from("clients").update({ deleted_at: new Date().toISOString() }).eq("id", clientId);

  const binned = await db.from("clients").select("deleted_at").eq("id", clientId).single();
  check("client is marked deleted", binned.data.deleted_at !== null, true);

  const kept = await db.from("content_items").select("id, client_id").eq("id", itemId).single();
  check("its video still exists", Boolean(kept.data), true);
  check("and is STILL linked to the client", kept.data.client_id, clientId);

  console.log("\n=== restore ===");
  await db.from("clients").update({ deleted_at: null }).eq("id", clientId);
  const restored = await db.from("clients").select("deleted_at").eq("id", clientId).single();
  check("client is live again", restored.data.deleted_at, null);
  const stillThere = await db.from("content_items").select("client_id").eq("id", itemId).single();
  check("video came back with it", stillThere.data.client_id, clientId);

  console.log("\n=== inside the grace window, purge must NOT touch it ===");
  await db.from("clients").update({ deleted_at: new Date().toISOString() }).eq("id", clientId);
  await db.rpc("purge_deleted_clients", { p_grace_days: 7 });
  const survived = await db.from("clients").select("id").eq("id", clientId).maybeSingle();
  check("binned today survives a 7-day purge", Boolean(survived.data), true);

  console.log("\n=== past the window, purge takes everything ===");
  const old = new Date(Date.now() - 8 * 86400000).toISOString();
  await db.from("clients").update({ deleted_at: old }).eq("id", clientId);
  const { data: purged } = await db.rpc("purge_deleted_clients", { p_grace_days: 7 });
  const mine = (purged ?? []).find((p) => p.purged_client_name === STAMP);
  check("purge reported this client", Boolean(mine), true);
  check("and counted its video", mine?.purged_items, 1);

  const goneClient = await db.from("clients").select("id").eq("id", clientId).maybeSingle();
  check("client is gone", goneClient.data, null);
  const goneItem = await db.from("content_items").select("id").eq("id", itemId).maybeSingle();
  check("its video is gone too, not orphaned", goneItem.data, null);
  clientId = null; itemId = null;

  console.log("\n=== guard ===");
  const bad = await db.rpc("purge_deleted_clients", { p_grace_days: 0 });
  check("a zero-day grace window is refused", Boolean(bad.error), true);
} catch (e) {
  fail++;
  failures.push("threw: " + e.message);
  console.log("\n  THREW: " + e.message);
} finally {
  // Always clean up, even on failure -- a test that leaves rows behind in a
  // live workspace is worse than no test.
  if (itemId) await db.from("content_items").delete().eq("id", itemId);
  if (clientId) await db.from("clients").delete().eq("id", clientId);
  await db.from("clients").delete().eq("name", STAMP);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nfailures:"); for (const f of failures) console.log("  - " + f); }
process.exit(fail ? 1 : 0);
