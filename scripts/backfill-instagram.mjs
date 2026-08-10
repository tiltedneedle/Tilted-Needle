// Backfill Instagram enrichment: publish timestamp and caption text.
//
// SEPARATE FROM backfill-enrichment.mjs ON PURPOSE. That script rides
// YouTube's videos.list, which is free (1 quota unit per 50 ids) and can
// therefore sweep the whole library without a second thought. This one calls
// Apify, which bills PER ROW RETURNED. The two have opposite cost shapes, and
// folding them together would hide a metered call inside something that reads
// as free.
//
// Cost model, stated plainly: one credit per post, charged whether or not the
// row turns out to carry anything new. --limit is the spend control and there
// is no "all" mode; a full sweep is several deliberate runs, not one flag.
//
//   node scripts/backfill-instagram.mjs --limit 25 [--dry]
//
// Idempotent: only asks about posts still missing an answer, so re-running
// after a partial failure costs only what is still missing.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const DRY = process.argv.includes("--dry");
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  const n = i >= 0 ? Number(process.argv[i + 1]) : 25;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 100) : 25;
})();

const env = (n) =>
  (readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").find((l) => l.startsWith(n + "=")) || "")
    .slice(n.length + 1).trim().replace(/^["']|["']$/g, "");

const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), {
  auth: { persistSession: false },
});
const TOKEN = env("APIFY_TOKEN");
if (!TOKEN) {
  console.error("APIFY_TOKEN is not set.");
  process.exit(1);
}
const ACTOR = env("APIFY_INSTAGRAM_ACTOR") || "apify~instagram-scraper";

/** `https://www.instagram.com/p/CtccXmIoFpc/` -> `CtccXmIoFpc` */
function shortCodeOf(url) {
  const m = String(url ?? "").match(/instagram\.com\/(?:p|reel|tv)\/([^/?#]+)/i);
  return m ? m[1] : null;
}

/* ---- Find what is actually missing --------------------------------------- */
const { data: posts, error } = await db
  .from("platform_posts")
  .select("id, url, posted_at, posted_at_ts, content_item_id, account:accounts(platform_slug)")
  .not("url", "is", null);
if (error) throw new Error(error.message);

const { data: items } = await db.from("content_items").select("id, description");
const descOf = new Map((items ?? []).map((i) => [i.id, i.description]));

const candidates = (posts ?? [])
  .filter((p) => {
    const slug = (Array.isArray(p.account) ? p.account[0] : p.account)?.platform_slug;
    return slug === "instagram";
  })
  .filter((p) => shortCodeOf(p.url))
  // Worth a credit only if something is genuinely absent.
  .filter((p) => !p.posted_at_ts || !descOf.get(p.content_item_id));

console.log(`instagram posts missing enrichment: ${candidates.length}`);
const batch = candidates.slice(0, LIMIT);
console.log(`this run will fetch: ${batch.length} (≈${batch.length} Apify credits)`);
if (batch.length === 0) process.exit(0);
if (DRY) {
  console.log("--dry: nothing fetched, nothing charged.");
  process.exit(0);
}

/* ---- One metered call ---------------------------------------------------- */
// directUrls with individual post URLs returns one row per post, so the spend
// is exactly the batch size rather than a whole profile's history.
const res = await fetch(
  `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(TOKEN)}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      directUrls: batch.map((p) => p.url),
      resultsType: "posts",
      resultsLimit: batch.length,
      addParentData: false,
    }),
  },
);

if (res.status === 402) {
  console.error("Apify monthly credit exhausted — nothing charged, nothing written.");
  process.exit(2);
}
if (!res.ok) {
  console.error(`Apify HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  process.exit(2);
}
const rows = await res.json();
if (!Array.isArray(rows)) {
  console.error("Apify returned an unexpected shape.");
  process.exit(2);
}
console.log(`rows returned (= credits charged): ${rows.length}`);

const byCode = new Map();
for (const r of rows) {
  const code = r.shortCode ?? shortCodeOf(r.url);
  if (code) byCode.set(code, r);
}

/* ---- Write back ---------------------------------------------------------- */
let ts = 0, desc = 0, unmatched = 0;
for (const p of batch) {
  const row = byCode.get(shortCodeOf(p.url));
  if (!row) { unmatched++; continue; }

  if (!p.posted_at_ts && row.timestamp) {
    const iso = new Date(row.timestamp).toISOString();
    const { error: e } = await db
      .from("platform_posts").update({ posted_at_ts: iso }).eq("id", p.id);
    if (!e) ts++;
  }

  // The caption is the only text an Instagram post has; the sync keeps just
  // its first line as a title and discards the rest (P2). This recovers it.
  const caption = (row.caption ?? "").trim();
  if (caption && !descOf.get(p.content_item_id)) {
    const { error: e } = await db
      .from("content_items").update({ description: caption }).eq("id", p.content_item_id);
    if (!e) { desc++; descOf.set(p.content_item_id, caption); }
  }
}

console.log(`posted_at_ts written : ${ts}`);
console.log(`descriptions written : ${desc}`);
if (unmatched) console.log(`unmatched (paid for, no usable row): ${unmatched}`);
console.log(`remaining after this run: ${Math.max(0, candidates.length - batch.length)}`);
