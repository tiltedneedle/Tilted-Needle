import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = (n) =>
  (readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .find((l) => l.startsWith(n + "=")) || "")
    .slice(n.length + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
const admin = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), {
  auth: { persistSession: false },
});
const WS = "c53055f9-fa68-41a0-95ff-6a35a5bf503f";

// --- ingest_jobs truncation: what /data's queue panel actually reads.
const { count: ijTotal } = await admin.from("ingest_jobs").select("*", { count: "exact", head: true }).eq("workspace_id", WS);
const { data: ijUnbounded } = await admin.from("ingest_jobs").select("kind, status").eq("workspace_id", WS);
console.log(`ingest_jobs total=${ijTotal}; unbounded select returned ${ijUnbounded.length}`);

const tally = (rows) => {
  const m = new Map();
  for (const r of rows) {
    const k = `${r.kind}/${r.status}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort();
};
console.log("  what the panel SHOWS (first 1000):", JSON.stringify(tally(ijUnbounded)));

// paged truth
const all = [];
for (let f = 0; ; f += 1000) {
  const { data } = await admin.from("ingest_jobs").select("kind, status").eq("workspace_id", WS).order("id").range(f, f + 999);
  all.push(...(data ?? []));
  if ((data ?? []).length < 1000) break;
}
console.log(`  TRUTH (paged, ${all.length} rows):        `, JSON.stringify(tally(all)));

// --- OFFSET cost on post_snapshots (no index on workspace_id/captured_at)
for (const [from, to] of [[0, 999], [1000, 1999], [2000, 2999], [3000, 3999]]) {
  const t = Date.now();
  const { data } = await admin.from("post_snapshots").select("id, platform_post_id, captured_at, views")
    .eq("workspace_id", WS).order("captured_at").order("id").range(from, to);
  console.log(`post_snapshots page ${from}-${to}: ${data?.length} rows in ${Date.now() - t}ms`);
}

// --- indexed comparison: order by the indexed (platform_post_id, captured_at)
const t2 = Date.now();
const { data: idx } = await admin.from("post_snapshots").select("id, platform_post_id, captured_at, views")
  .order("platform_post_id").order("captured_at").range(0, 999);
console.log(`post_snapshots ordered by INDEXED cols page 0-999: ${idx?.length} rows in ${Date.now() - t2}ms`);

// --- ai_analyses read pattern
const ms = new Date(); ms.setUTCDate(1); ms.setUTCHours(0, 0, 0, 0);
console.log(`\nai_analyses all=${(await admin.from("ai_analyses").select("*", { count: "exact", head: true }).eq("workspace_id", WS)).count}`);

// --- content_items with a client (pipelineStatus/ import page)
console.log(`content_items unbounded -> ${(await admin.from("content_items").select("id, client_id").eq("workspace_id", WS)).data.length} of ${(await admin.from("content_items").select("*", { count: "exact", head: true }).eq("workspace_id", WS)).count}`);
console.log(`platform_posts unbounded -> ${(await admin.from("platform_posts").select("id, content_item_id").eq("workspace_id", WS)).data.length}`);
