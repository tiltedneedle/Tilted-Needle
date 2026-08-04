// Temporary, reversible: randomly assigns all 5 content roles across every
// real video in the DXB workspace, tagged source='seed-test' so it can be
// cleanly removed later without touching any real manual assignment.
// Run:   node scripts/_seed-test-assignments.mjs
// Undo:  node scripts/_seed-test-assignments.mjs --revert
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

function env(name) {
  if (process.env[name]) return process.env[name];
  try {
    const file = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    return file.split("\n").find((l) => l.startsWith(`${name}=`))?.slice(name.length + 1).trim().replace(/^["']|["']$/g, "");
  } catch { return undefined; }
}
const SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL");
const SECRET = env("SUPABASE_SECRET_KEY");
const admin = createClient(SUPABASE_URL, SECRET, { auth: { persistSession: false } });

const WORKSPACE_ID = "c53055f9-fa68-41a0-95ff-6a35a5bf503f"; // Tilted Needle DXB
const SEED_SOURCE = "seed-test";

if (process.argv.includes("--revert")) {
  const { error, count } = await admin
    .from("content_assignments")
    .delete({ count: "exact" })
    .eq("workspace_id", WORKSPACE_ID)
    .eq("source", SEED_SOURCE);
  if (error) throw error;
  console.log(`Reverted: removed ${count} seed-test assignment(s).`);
  process.exit(0);
}

const { data: items, error: itemsErr } = await admin
  .from("content_items")
  .select("id")
  .eq("workspace_id", WORKSPACE_ID);
if (itemsErr) throw itemsErr;

const { data: roles, error: rolesErr } = await admin
  .from("roles")
  .select("id, slug")
  .eq("workspace_id", WORKSPACE_ID);
if (rolesErr) throw rolesErr;

const { data: members, error: membersErr } = await admin
  .from("memberships")
  .select("user_id")
  .eq("workspace_id", WORKSPACE_ID)
  .eq("is_active", true);
if (membersErr) throw membersErr;

const userIds = members.map((m) => m.user_id);
if (userIds.length === 0) throw new Error("No active members to assign.");

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const rows = [];
for (const item of items) {
  for (const role of roles) {
    rows.push({
      workspace_id: WORKSPACE_ID,
      content_item_id: item.id,
      user_id: pick(userIds),
      role_id: role.id,
      source: SEED_SOURCE,
    });
  }
}

// Duplicate (content_item_id, user_id, role_id) picks collide on the unique
// constraint -- harmless (that video/role just ends up with one fewer random
// holder), so upsert-ignore rather than fail the whole batch over one row.
const { data, error } = await admin
  .from("content_assignments")
  .upsert(rows, { onConflict: "content_item_id,user_id,role_id", ignoreDuplicates: true })
  .select("id");
if (error) throw error;

console.log(`Inserted ${data.length} of ${rows.length} attempted assignments`);
console.log(`(${rows.length - data.length} were random-picked duplicates on the same video/role, harmlessly skipped)`);
console.log(`Videos: ${items.length}, roles: ${roles.length}, people: ${userIds.length}`);
console.log(`\nTo revert: node scripts/_seed-test-assignments.mjs --revert`);
