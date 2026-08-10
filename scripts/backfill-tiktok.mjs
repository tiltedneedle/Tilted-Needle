// Backfill TikTok enrichment: publish timestamp and caption text.
//
// FREE, unlike its Instagram counterpart. This goes through the self-hosted
// yt-dlp box (one extract_info call per post), so there is no metered provider
// and no API quota in play. That is why this script has no --limit ceiling in
// the way backfill-instagram.mjs does: the only cost is time and politeness to
// TikTok, both handled by pacing rather than by a spend cap.
//
// TikTok sat at 0/78 timestamps not because the data was hard to get, but
// because nothing had ever asked for it -- the sync stores only a DATE, and
// the discovery path keeps a caption's first line as a title and throws the
// rest away.
//
//   node scripts/backfill-tiktok.mjs [--limit N] [--dry]
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const DRY = process.argv.includes("--dry");
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  const n = i >= 0 ? Number(process.argv[i + 1]) : 80;
  return Number.isFinite(n) && n > 0 ? n : 80;
})();

const env = (n) =>
  (readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").find((l) => l.startsWith(n + "=")) || "")
    .slice(n.length + 1).trim().replace(/^["']|["']$/g, "");

const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), {
  auth: { persistSession: false },
});

const BASE = (env("TIKTOK_DISCOVER_URL") || "").replace(/\/discover\/?$/, "");
const SECRET = env("TIKTOK_DISCOVER_SECRET");
if (!BASE || !SECRET) {
  console.error("TIKTOK_DISCOVER_URL and TIKTOK_DISCOVER_SECRET are required.");
  process.exit(1);
}

const { data: posts, error } = await db
  .from("platform_posts")
  .select("id, url, content_item_id, posted_at_ts, account:accounts(platform_slug)")
  .not("url", "is", null);
if (error) throw new Error(error.message);

const { data: items } = await db.from("content_items").select("id, description");
const descOf = new Map((items ?? []).map((i) => [i.id, i.description]));

const candidates = (posts ?? [])
  .filter((p) => (Array.isArray(p.account) ? p.account[0] : p.account)?.platform_slug === "tiktok")
  .filter((p) => !p.posted_at_ts || !descOf.get(p.content_item_id));

console.log(`tiktok posts missing enrichment: ${candidates.length}`);
const batch = candidates.slice(0, LIMIT);
console.log(`this run: ${batch.length} (free — self-hosted yt-dlp)`);
if (!batch.length) process.exit(0);
if (DRY) { console.log("--dry: nothing fetched."); process.exit(0); }

let ts = 0, desc = 0, unavailable = 0, failed = 0;
for (const [i, p] of batch.entries()) {
  try {
    const res = await fetch(`${BASE}/meta?url=${encodeURIComponent(p.url)}`, {
      headers: { Authorization: `Bearer ${SECRET}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      failed++;
      if (failed <= 3) {
        const b = await res.text().catch(() => "");
        console.log(`  HTTP ${res.status}: ${b.slice(0, 170)}`);
      }
      continue;
    }
    const body = await res.json();
    if (body.available === false) { unavailable++; continue; }

    if (!p.posted_at_ts && body.timestamp) {
      const iso = new Date(body.timestamp * 1000).toISOString();
      const { error: e } = await db
        .from("platform_posts").update({ posted_at_ts: iso }).eq("id", p.id);
      if (!e) ts++;
    }
    if (body.description && !descOf.get(p.content_item_id)) {
      const { error: e } = await db
        .from("content_items").update({ description: body.description })
        .eq("id", p.content_item_id);
      if (!e) { desc++; descOf.set(p.content_item_id, body.description); }
    }
  } catch (e) {
    // Surface the reason. The first run of this script reported "40 failed"
    // and nothing else, which cost a diagnostic round-trip to discover that
    // yt-dlp's TikTok extractor was broken upstream. A count is not an error.
    failed++;
    if (failed <= 3) console.log(`  failed: ${String(e.message ?? e).slice(0, 120)}`);
  }
  // Paced. Nothing here is metered, but a burst of extractions against one
  // platform is the pattern that gets an IP refused -- the same reason the
  // transcript path is jittered.
  if (i < batch.length - 1) await new Promise((r) => setTimeout(r, 900 + Math.random() * 700));
  if ((i + 1) % 20 === 0) console.log(`  ...${i + 1}/${batch.length}`);
}

console.log(`posted_at_ts written : ${ts}`);
console.log(`descriptions written : ${desc}`);
if (unavailable) console.log(`unavailable (private/removed): ${unavailable}`);
if (failed) console.log(`failed (retryable): ${failed}`);
