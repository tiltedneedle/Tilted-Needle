// TEMP audit 3 (read-only).
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const j = (o) => JSON.stringify(o, null, 1);

// A. confirm the PostgREST unbounded cap on this project
const { data: capTest } = await db.from("post_snapshots").select("id");
console.log("A. unbounded select on post_snapshots returned:", capTest.length, "(total is 3323) -> cap =", capTest.length);

// B. which TikTok discovery route is live? postsSeen on recent tiktok runs
const { data: accounts } = await db.from("accounts").select("id, platform_slug, handle, last_discovered_at");
const acct = new Map(accounts.map((a) => [a.id, a]));
const { data: runs } = await db.from("sync_runs")
  .select("account_id, started_at, status, trigger, posts_seen, posts_created, error")
  .order("started_at", { ascending: false }).limit(1000);
const tk = runs.filter((r) => acct.get(r.account_id)?.platform_slug === "tiktok");
console.log("B. recent tiktok runs (postsSeen>0 means discovery actually ran):");
console.log(j(tk.slice(0, 14).map((r) => ({ h: acct.get(r.account_id).handle, at: r.started_at, seen: r.posts_seen, made: r.posts_created, trig: r.trigger, e: (r.error ?? "").slice(0, 50) }))));
const seenByDay = {};
for (const r of tk) {
  const d = r.started_at.slice(0, 10);
  seenByDay[d] ??= { runs: 0, seenTotal: 0, seenNonZero: 0 };
  seenByDay[d].runs++; seenByDay[d].seenTotal += r.posts_seen; if (r.posts_seen > 0) seenByDay[d].seenNonZero++;
}
console.log("tiktok posts_seen by day:", j(seenByDay));

// when did the self-hosted 502 happen?
const disc502 = runs.filter((r) => (r.error ?? "").includes("TikTok discovery service"));
console.log("self-hosted TikTok discovery errors (proves that route is wired):", j(disc502.map((r) => ({ h: acct.get(r.account_id)?.handle, at: r.started_at, e: r.error.slice(0, 120) }))));

// C. length_seconds on auto-discovered items, by platform of the discovering account
const { data: posts } = await db.from("platform_posts").select("id, account_id, content_item_id, external_id, posted_at").limit(5000);
const { data: items } = await db.from("content_items").select("id, title, length_seconds, notes, created_at").limit(5000);
const itemById = new Map(items.map((i) => [i.id, i]));
const auto = { };
for (const p of posts) {
  const a = acct.get(p.account_id); if (!a) continue;
  const it = itemById.get(p.content_item_id); if (!it) continue;
  if (!(it.notes ?? "").startsWith("Discovered automatically")) continue;
  auto[a.platform_slug] ??= { n: 0, nullLen: 0 };
  auto[a.platform_slug].n++;
  if (it.length_seconds == null) auto[a.platform_slug].nullLen++;
}
console.log("C. auto-discovered content_items -- null length_seconds by platform:", j(auto));

// D. snapshot growth rate per account -> when does the 1000 cap bite?
let snaps = [];
for (let from = 0; ; from += 1000) {
  const { data } = await db.from("post_snapshots").select("platform_post_id, captured_at")
    .order("captured_at", { ascending: false }).range(from, from + 999);
  snaps = snaps.concat(data);
  if (data.length < 1000) break;
  if (from > 20000) break;
}
const acctOfPost = new Map(posts.map((p) => [p.id, p.account_id]));
const per = {};
for (const s of snaps) {
  const a = acctOfPost.get(s.platform_post_id); if (!a) continue;
  per[a] ??= { n: 0, first: s.captured_at, last: s.captured_at };
  per[a].n++;
  if (s.captured_at < per[a].first) per[a].first = s.captured_at;
  if (s.captured_at > per[a].last) per[a].last = s.captured_at;
}
const growth = Object.entries(per).map(([id, v]) => {
  const days = Math.max(1, (new Date(v.last) - new Date(v.first)) / 86400000);
  const rate = v.n / days;
  return { h: acct.get(id)?.handle, p: acct.get(id)?.platform_slug, snaps: v.n, days: +days.toFixed(1), perDay: +rate.toFixed(1), daysTo1000: Math.round((1000 - v.n) / rate) };
}).sort((a, b) => b.snaps - a.snaps).slice(0, 8);
console.log("D. snapshots per account, growth, and days until the 1000-row dedupe cap bites:");
console.log(j(growth));
console.log("   (thinning keeps ALL rows younger than 90 days, so nothing is removed before ~2026-10-27)");

// E. accounts stale vs fresh right now
const { data: acc2 } = await db.from("accounts").select("platform_slug, handle, last_synced_at, sync_enabled, is_archived, client_id");
const now = Date.now();
console.log("E. hours since last_synced_at, per platform (enabled, unarchived):");
const staleness = acc2.filter((a) => a.sync_enabled && !a.is_archived).map((a) => ({
  p: a.platform_slug, h: a.handle,
  hrs: a.last_synced_at ? +(((now - new Date(a.last_synced_at)) / 3600000)).toFixed(1) : null,
})).sort((x, y) => (y.hrs ?? 1e9) - (x.hrs ?? 1e9));
console.log(j(staleness));
process.exit(0);
