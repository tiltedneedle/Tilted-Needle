// TEMP audit 4 (read-only): per-post cost + 300s headroom per platform.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const { data: accounts } = await db.from("accounts").select("id, platform_slug, handle, sync_window_days");
const acct = new Map(accounts.map((a) => [a.id, a]));
const { data: posts } = await db.from("platform_posts").select("id, account_id, external_id").limit(5000);
const tracked = {};
for (const p of posts) if (p.external_id) tracked[p.account_id] = (tracked[p.account_id] ?? 0) + 1;

let runs = [];
for (let f = 0; ; f += 1000) {
  const { data } = await db.from("sync_runs").select("account_id, started_at, finished_at, status, error")
    .order("started_at", { ascending: false }).range(f, f + 999);
  runs = runs.concat(data); if (data.length < 1000) break; if (f > 5000) break;
}
const good = runs.filter((r) => r.finished_at && !(r.error ?? "").startsWith("Run did not report") && r.started_at >= "2026-08-14");

console.log("per-account seconds vs tracked posts (runs since 2026-08-14)");
const agg = {};
for (const r of good) {
  const a = acct.get(r.account_id); if (!a) continue;
  const sec = (new Date(r.finished_at) - new Date(r.started_at)) / 1000;
  const n = tracked[r.account_id] ?? 0;
  agg[a.platform_slug] ??= { sec: [], posts: n, samples: 0 };
  agg[a.platform_slug].sec.push({ sec, n, h: a.handle });
  agg[a.platform_slug].samples++;
}
for (const [p, v] of Object.entries(agg)) {
  const withPosts = v.sec.filter((x) => x.n > 0);
  const perPost = withPosts.map((x) => x.sec / x.n).sort((a, b) => a - b);
  const p90 = perPost[Math.floor(perPost.length * 0.9)] ?? 0;
  const med = perPost[Math.floor(perPost.length * 0.5)] ?? 0;
  const totalTracked = accounts.filter((a) => a.platform_slug === p).reduce((s, a) => s + (tracked[a.id] ?? 0), 0);
  console.log(
    `${p.padEnd(15)} n=${String(v.samples).padStart(3)} median ${med.toFixed(2)}s/post  p90 ${p90.toFixed(2)}s/post  | tracked posts on this platform = ${totalTracked}  -> whole-platform pass ≈ ${(totalTracked * med).toFixed(0)}s (ceiling 300s per request; workflow batches 4 accounts)`,
  );
  // worst single batch of 4 accounts by post count
  const arr = accounts.filter((a) => a.platform_slug === p).map((a) => tracked[a.id] ?? 0).sort((x, y) => y - x).slice(0, 4);
  console.log(`${" ".repeat(16)}worst 4-account batch = ${arr.join("+")} = ${arr.reduce((s, x) => s + x, 0)} posts -> ≈ ${(arr.reduce((s, x) => s + x, 0) * med).toFixed(0)}s`);
}

// how many posts would fill 300s at the observed median rate, per platform
console.log("\nposts-per-batch that fills the 300s ceiling:");
for (const [p, v] of Object.entries(agg)) {
  const perPost = v.sec.filter((x) => x.n > 0).map((x) => x.sec / x.n).sort((a, b) => a - b);
  const med = perPost[Math.floor(perPost.length * 0.5)] ?? 0;
  if (med > 0) console.log(`  ${p.padEnd(15)} ${(300 / med).toFixed(0)} posts per request`);
}
process.exit(0);
