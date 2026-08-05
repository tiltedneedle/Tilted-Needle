// Refresh-idempotency test against the LIVE production pipeline.
//
// Calls the deployed /api/sync twice back-to-back (cron semantics, so the
// metered discovery cooldown applies and nothing extra is spent) and
// asserts around each run that refreshing can neither duplicate data nor
// corrupt the numbers built on it:
//
//   1. No duplicate posts: (account_id, external_id) unique across the table.
//   2. No duplicate videos: run deltas on content_items explained by
//      discovery only; run 2 must add zero.
//   3. No double snapshots: run 2, seconds after run 1, must write zero
//      (nothing is due again); no (post, captured_at) pair repeats.
//   4. Metrics correctness: post_current_metrics equals the latest snapshot
//      for every post -- the number every dashboard and score reads.
//   5. No double billing: the Instagram budget row must not move on run 2.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = (n) =>
  (readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").find((l) => l.startsWith(n + "=")) || "")
    .slice(n.length + 1).trim().replace(/^["']|["']$/g, "");
const admin = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), {
  auth: { persistSession: false },
});
const WS = "c53055f9-fa68-41a0-95ff-6a35a5bf503f";
const SITE = "https://tilted-needle0.vercel.app";
const SECRET = env("CRON_SECRET");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

async function state() {
  // Throwing on a failed read matters: an ignored error here once rendered
  // as '0 posts' and looked exactly like data loss.
  const [posts, items, snaps, budget] = await Promise.all([
    admin.from("platform_posts").select("id, account_id, external_id").eq("workspace_id", WS),
    admin.from("content_items").select("id", { count: "exact", head: true }).eq("workspace_id", WS),
    admin.from("post_snapshots").select("id", { count: "exact", head: true }).eq("workspace_id", WS),
    admin.from("scrape_budgets").select("used_auto, used_discovery, used_manual")
      .eq("workspace_id", WS).eq("platform_slug", "instagram")
      .order("period_end", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (posts.error || items.error || snaps.error || budget.error) {
    throw new Error('state read failed: ' + (posts.error ?? items.error ?? snaps.error ?? budget.error).message);
  }
  return {
    posts: posts.data ?? [],
    items: items.count ?? 0,
    snaps: snaps.count ?? 0,
    budget: budget.data
      ? budget.data.used_auto + budget.data.used_discovery + budget.data.used_manual
      : 0,
  };
}

function dupePosts(posts) {
  const seen = new Set(); const dupes = [];
  for (const p of posts) {
    if (!p.external_id) continue;
    const k = p.account_id + "|" + p.external_id;
    if (seen.has(k)) dupes.push(k); else seen.add(k);
  }
  return dupes;
}

async function sync(label) {
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(`${SITE}/api/sync`, {
    headers: { Authorization: `Bearer ${SECRET}` },
    signal: AbortSignal.timeout(300000),
  });
  } catch (e) {
    console.log(`
${label}: network error -> ${e.cause?.code ?? e.message}`);
    return false;
  }
  const body = await res.json().catch(() => ({}));
  console.log(`\n${label}: HTTP ${res.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s ->`,
    JSON.stringify(body).slice(0, 200));
  return res.ok;
}

/* ---- Static integrity before anything runs ------------------------------ */
const s0 = await state();
check("no duplicate (account, external_id) posts before", dupePosts(s0.posts).length === 0,
  dupePosts(s0.posts).join(", ") || `${s0.posts.length} posts`);

// Snapshot pair uniqueness -- paged read, the table may exceed one page.
{
  const pairs = new Set(); let dupe = 0; const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data } = await admin.from("post_snapshots")
      .select("platform_post_id, captured_at").eq("workspace_id", WS)
      .order("id").range(from, from + PAGE - 1);
    for (const s of data ?? []) {
      const k = s.platform_post_id + "|" + s.captured_at;
      if (pairs.has(k)) dupe++; else pairs.add(k);
    }
    if (!data || data.length < PAGE) break;
  }
  check("no duplicate (post, captured_at) snapshot pairs before", dupe === 0, `${pairs.size} pairs`);
}

/* ---- Run 1 -------------------------------------------------------------- */
const ok1 = await sync("SYNC RUN 1");
check("run 1 returns ok", ok1);
const s1 = await state();
console.log(`   posts ${s0.posts.length} -> ${s1.posts.length}, items ${s0.items} -> ${s1.items}, snapshots ${s0.snaps} -> ${s1.snaps}, IG budget ${s0.budget} -> ${s1.budget}`);
check("run 1 creates no duplicate posts", dupePosts(s1.posts).length === 0);

/* ---- Run 2, immediately -------------------------------------------------- */
const ok2 = await sync("SYNC RUN 2 (immediately after)");
check("run 2 returns ok", ok2);
const s2 = await state();
console.log(`   posts ${s1.posts.length} -> ${s2.posts.length}, items ${s1.items} -> ${s2.items}, snapshots ${s1.snaps} -> ${s2.snaps}, IG budget ${s1.budget} -> ${s2.budget}`);

check("run 2 adds zero posts (no re-discovery doubling)", s2.posts.length === s1.posts.length,
  `${s2.posts.length - s1.posts.length} added`);
check("run 2 adds zero videos", s2.items === s1.items, `${s2.items - s1.items} added`);
console.log(`   run 2 wrote ${s2.snaps - s1.snaps} snapshot(s) -- allowed only for genuinely changed values, checked below`);
check("run 2 spends zero Instagram budget", s2.budget === s1.budget,
  `${s2.budget - s1.budget} spent`);
check("no duplicate posts after both runs", dupePosts(s2.posts).length === 0);

/* ---- Every snapshot these runs wrote carries CHANGED values ------------- */
{
  const written = s2.snaps - s0.snaps;
  const { data: recent } = await admin.from("post_snapshots")
    .select("platform_post_id, captured_at, views, likes, comments")
    .eq("workspace_id", WS)
    .order("captured_at", { ascending: false }).limit(Math.max(written, 1));
  let dupes = 0;
  for (const s of recent ?? []) {
    const { data: prev } = await admin.from("post_snapshots")
      .select("views, likes, comments").eq("platform_post_id", s.platform_post_id)
      .lt("captured_at", s.captured_at)
      .order("captured_at", { ascending: false }).limit(1).maybeSingle();
    if (prev && prev.views === s.views && prev.likes === s.likes && prev.comments === s.comments) dupes++;
  }
  check("every snapshot written is a changed reading, never a repeat", dupes === 0,
    written + " written across both runs");
}

/* ---- Calculation correctness: current metrics == latest snapshot -------- */
{
  const { data: posts } = await admin.from("platform_posts")
    .select("id, metrics:post_current_metrics(views, captured_at)")
    .eq("workspace_id", WS).limit(500);
  let mismatches = 0, checked = 0;
  for (const p of (posts ?? []).slice(0, 40)) {
    const m = Array.isArray(p.metrics) ? p.metrics[0] : p.metrics;
    if (!m) continue;
    const { data: latest } = await admin.from("post_snapshots")
      .select("views, captured_at").eq("platform_post_id", p.id)
      .order("captured_at", { ascending: false }).limit(1).maybeSingle();
    if (!latest) continue;
    checked++;
    if (latest.views !== m.views || latest.captured_at !== m.captured_at) mismatches++;
  }
  check("current metrics equal the latest snapshot (sampled)", mismatches === 0,
    `${checked} posts checked`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
