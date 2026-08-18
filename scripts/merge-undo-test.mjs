// merge_content_items and undo_content_merge, against the real database.
//
// WHY THIS EXISTS
//
// Merging is the most destructive operation a person can trigger from the UI:
// it folds several videos into one, moves their posts, and deletes the losers.
// Undo is what makes that safe to offer. Everything here therefore tests the
// round trip -- merge, then undo, then check the world is as it started --
// rather than just "did merge return an id".
//
// The property that matters is REVERSIBILITY. A merge that loses a field the
// undo cannot restore is worse than no merge, because the damage is invisible
// until someone goes looking for a title that no longer exists.
//
// Cleans up after itself even when an assertion fails.

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")]; }),
);
// Service role builds and tears down the fixtures; it can write anything.
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

/**
 * The RPCs are called as a REAL USER, not the service role.
 *
 * merge_content_items opens with a manager check against auth.uid(), and the
 * service role has no user identity -- so calling it that way fails with
 * "Only a manager can merge videos." That is the function behaving correctly,
 * and it means a service-role test would either have to bypass the guard or
 * prove nothing about it.
 *
 * Signing in instead exercises the real path: the same authorisation the UI
 * goes through, on the same RLS-bound client.
 */
const auth = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + "/auth/v1/token?grant_type=password", {
  method: "POST",
  headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" },
  body: JSON.stringify({ email: "demo@tiltedneedle.test", password: process.env.DEMO_PASSWORD }),
}).then((r) => r.json());
if (!auth.access_token) {
  console.log("Could not sign in. Set DEMO_PASSWORD to run this test.");
  process.exit(1);
}
const asUser = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  global: { headers: { Authorization: "Bearer " + auth.access_token } },
});

let pass = 0, fail = 0;
const failures = [];
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else { fail++; failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label.padEnd(54)} ${JSON.stringify(actual)}`);
}

const STAMP = "zz-merge-test-" + process.pid;
const made = { items: [], accounts: [], clients: [] };

try {
  // The workspace the signed-in user actually MANAGES, not simply the first
  // row in the table. Picking limit(1) put the fixtures in a tenant this user
  // has no membership in, so merge_content_items refused them -- correctly,
  // and confusingly, since the error names the role rather than the tenant.
  const { data: mem } = await db
    .from("memberships")
    .select("workspace_id, role")
    .eq("user_id", auth.user.id)
    .eq("is_active", true)
    .in("role", ["owner", "admin", "manager"])
    .limit(1)
    .maybeSingle();
  if (!mem) throw new Error("the demo user manages no workspace");
  const W = mem.workspace_id;

  const { data: client } = await db.from("clients")
    .insert({ workspace_id: W, name: STAMP + "-client" }).select("id").single();
  made.clients.push(client.id);

  /**
   * THREE accounts on three platforms, not one.
   *
   * merge_content_items refuses a set whose posts share an account -- "these
   * are different videos: two of them are posted to the same account" -- and
   * it is right to. Merging those would pool metrics from genuinely separate
   * uploads. The operation exists for the CROSS-PLATFORM case: one video that
   * went out on TikTok, Instagram and YouTube as three rows.
   *
   * The first version of this fixture used a single account and was rejected,
   * which is the guard working rather than a bug.
   */
  const accounts = {};
  for (const platform of ["tiktok", "instagram", "youtube"]) {
    const { data: a } = await db.from("accounts").insert({
      workspace_id: W, client_id: client.id, platform_slug: platform,
      handle: STAMP + "-" + platform, connection_mode: "manual",
    }).select("id").single();
    made.accounts.push(a.id);
    accounts[platform] = a.id;
  }

  // Survivor and two losers, each on its own platform.
  const mk = async (title, producedAt, platform) => {
    const { data: it } = await db.from("content_items")
      .insert({ workspace_id: W, client_id: client.id, title, produced_at: producedAt })
      .select("id").single();
    made.items.push(it.id);
    await db.from("platform_posts").insert({
      workspace_id: W, content_item_id: it.id, account_id: accounts[platform],
      external_id: STAMP + "-" + title, url: "https://example.com/" + title,
      posted_at: producedAt, source: "manual",
    });
    return it.id;
  };

  const survivor = await mk("survivor", "2026-05-10", "tiktok");
  const loserA = await mk("loserA", "2026-05-01", "instagram");
  const loserB = await mk("loserB", "2026-05-20", "youtube");

  console.log("\n=== merge ===");
  const { data: mergeId, error: mErr } = await asUser.rpc("merge_content_items", {
    p_survivor: survivor, p_losers: [loserA, loserB],
  });
  if (mErr) throw new Error("merge failed: " + mErr.message);
  check("merge returned a journal id", typeof mergeId === "string" && mergeId.length > 0, true);

  const { count: postsOnSurvivor } = await db.from("platform_posts")
    .select("id", { count: "exact", head: true }).eq("content_item_id", survivor);
  check("all three posts moved to the survivor", postsOnSurvivor, 3);

  const stillThere = await db.from("content_items").select("id").in("id", [loserA, loserB]);
  check("losers are gone", (stillThere.data ?? []).length, 0);

  // produced_at takes the EARLIEST across the set: a merged video was first
  // published when its earliest cross-post was, not when the survivor was.
  const { data: surv } = await db.from("content_items")
    .select("produced_at").eq("id", survivor).single();
  check("produced_at moved to the earliest of the set", surv.produced_at, "2026-05-01");

  console.log("\n=== undo ===");
  const { error: uErr } = await asUser.rpc("undo_content_merge", { p_merge_id: mergeId });
  if (uErr) throw new Error("undo failed: " + uErr.message);

  const back = await db.from("content_items").select("id,title,produced_at").in("id", [loserA, loserB]);
  check("both losers came back", (back.data ?? []).length, 2);
  check(
    "with their original titles",
    (back.data ?? []).map((r) => r.title).sort(),
    ["loserA", "loserB"],
  );
  check(
    "and their original dates",
    (back.data ?? []).map((r) => r.produced_at).sort(),
    ["2026-05-01", "2026-05-20"],
  );

  const { data: survAfter } = await db.from("content_items")
    .select("produced_at").eq("id", survivor).single();
  check("survivor's date was restored too", survAfter.produced_at, "2026-05-10");

  const { count: postsBack } = await db.from("platform_posts")
    .select("id", { count: "exact", head: true }).eq("content_item_id", survivor);
  check("survivor keeps only its own post", postsBack, 1);

  console.log("\n=== undo is not repeatable ===");
  const second = await asUser.rpc("undo_content_merge", { p_merge_id: mergeId });
  check("a second undo is refused", Boolean(second.error), true);

  console.log("\n=== guards ===");
  const selfMerge = await asUser.rpc("merge_content_items", {
    p_survivor: survivor, p_losers: [survivor],
  });
  check("merging an item into itself is refused", Boolean(selfMerge.error), true);

  const empty = await asUser.rpc("merge_content_items", { p_survivor: survivor, p_losers: [] });
  check("merging with no losers is refused", Boolean(empty.error), true);
} catch (e) {
  fail++;
  failures.push("threw: " + e.message);
  console.log("\n  THREW: " + e.message);
} finally {
  // Order matters: posts hang off items, accounts off clients.
  for (const id of made.items) {
    await db.from("platform_posts").delete().eq("content_item_id", id);
    await db.from("content_items").delete().eq("id", id);
  }
  for (const id of made.accounts) await db.from("accounts").delete().eq("id", id);
  for (const id of made.clients) await db.from("clients").delete().eq("id", id);
  // Anything the merge recreated under a new id.
  await db.from("content_items").delete().like("title", "loser%").eq("client_id", made.clients[0] ?? "");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nfailures:"); for (const f of failures) console.log("  - " + f); }
process.exit(fail ? 1 : 0);
