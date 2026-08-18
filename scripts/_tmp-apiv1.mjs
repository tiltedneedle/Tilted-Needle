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

// Exactly the query /api/v1/content runs, at its own documented max limit.
const { data: items } = await admin
  .from("content_items").select("id").eq("workspace_id", WS)
  .order("produced_at", { ascending: false, nullsFirst: false }).order("id").range(0, 999);

for (const limit of [100, 300, 400, 500]) {
  const ids = items.slice(0, limit).map((i) => i.id);
  const t = Date.now();
  const { data, error } = await admin
    .from("platform_posts")
    .select("content_item_id, account:accounts(platform_slug), metrics:post_current_metrics(views, likes, comments)")
    .in("content_item_id", ids);
  console.log(
    `/api/v1/content?limit=${String(limit).padStart(3)}  in-list bytes=${String(ids.join(",").length).padStart(6)}  ` +
    (error ? `FAIL after ${Date.now() - t}ms: ${error.message}` : `OK ${data.length} rows in ${Date.now() - t}ms`),
  );
}

// reports/page.tsx InsightsReport: unbounded transcripts WITH the segments JSONB.
const t = Date.now();
const { data: tr } = await admin.from("video_transcripts").select("content_item_id, segments").eq("workspace_id", WS);
const bytes = JSON.stringify(tr).length;
console.log(`\nvideo_transcripts(content_item_id, segments): ${tr.length} rows, ${bytes} bytes (${(bytes / 1024 / 1024).toFixed(2)} MiB) in ${Date.now() - t}ms`);
const idOnly = JSON.stringify(tr.map((r) => r.content_item_id)).length;
console.log(`  ids alone would be ${idOnly} bytes; segments are ${(100 * (1 - idOnly / bytes)).toFixed(1)}% of the payload`);
const hookBytes = JSON.stringify(tr.map((r) => (r.segments ?? []).filter((s) => (s.start_ms ?? 0) < 15000).map((s) => s.text).join(" "))).length;
console.log(`  the 15s hook text actually used: ${hookBytes} bytes -> ${(bytes / hookBytes).toFixed(0)}x over-read`);
