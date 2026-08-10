// Backfill TikTok enrichment: exact publish timestamp and caption text.
//
// Goes PER PROFILE, not per video, and that is the whole design.
//
// yt-dlp's full extract_info is broken for TikTok in the current release
// ("Unable to extract universal data for rehydration"), so the per-video
// /meta endpoint fails on every post. But FLAT extraction -- the profile
// listing behind /discover -- still works, and it carries the same timestamp
// and description for every video it lists. One working code path, reached a
// different way.
//
// Free: self-hosted yt-dlp, no metered provider, no API quota. One request per
// ACCOUNT rather than per post, so 78 posts cost a handful of calls.
//
//   node scripts/backfill-tiktok.mjs [--dry]
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const DRY = process.argv.includes("--dry");
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
  .select("id, external_id, content_item_id, posted_at_ts, account:accounts(platform_slug, handle)")
  .not("external_id", "is", null);
if (error) throw new Error(error.message);

const { data: items } = await db.from("content_items").select("id, description");
const descOf = new Map((items ?? []).map((i) => [i.id, i.description]));

// Group the work by account: one listing call answers for all of its posts.
const byHandle = new Map();
for (const p of posts ?? []) {
  const a = Array.isArray(p.account) ? p.account[0] : p.account;
  if (a?.platform_slug !== "tiktok") continue;
  if (p.posted_at_ts && descOf.get(p.content_item_id)) continue;
  const h = (a.handle || "").replace(/^@/, "");
  if (!h) continue;
  if (!byHandle.has(h)) byHandle.set(h, []);
  byHandle.get(h).push(p);
}

const totalPosts = [...byHandle.values()].reduce((s, v) => s + v.length, 0);
console.log(`tiktok posts missing enrichment: ${totalPosts}`);
console.log(`accounts to list: ${byHandle.size} (one request each — free)`);
if (!totalPosts) process.exit(0);
if (DRY) { console.log("--dry: nothing fetched."); process.exit(0); }

let ts = 0, desc = 0, unmatched = 0, failedAccounts = 0;

for (const [handle, theirs] of byHandle) {
  try {
    const res = await fetch(
      `${BASE}/discover?handle=${encodeURIComponent(handle)}&limit=200`,
      { headers: { Authorization: `Bearer ${SECRET}` }, signal: AbortSignal.timeout(180_000) },
    );
    if (!res.ok) {
      failedAccounts++;
      console.log(`  @${handle}: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 120)}`);
      continue;
    }
    const body = await res.json();
    const listed = new Map(
      (body.videos ?? []).map((v) => [String(v.externalId), v]),
    );
    console.log(`  @${handle}: listed ${listed.size}, need ${theirs.length}`);

    for (const p of theirs) {
      const v = listed.get(String(p.external_id));
      if (!v) { unmatched++; continue; }

      if (!p.posted_at_ts && v.timestampEpoch) {
        const iso = new Date(v.timestampEpoch * 1000).toISOString();
        const { error: e } = await db
          .from("platform_posts").update({ posted_at_ts: iso }).eq("id", p.id);
        if (!e) ts++;
      }
      if (v.description && !descOf.get(p.content_item_id)) {
        const { error: e } = await db
          .from("content_items").update({ description: v.description })
          .eq("id", p.content_item_id);
        if (!e) { desc++; descOf.set(p.content_item_id, v.description); }
      }
    }
  } catch (e) {
    failedAccounts++;
    console.log(`  @${handle}: ${String(e.message ?? e).slice(0, 120)}`);
  }
  // Paced between accounts. Nothing is metered, but a burst of profile
  // extractions is the pattern that gets an IP refused.
  await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
}

console.log(`posted_at_ts written : ${ts}`);
console.log(`descriptions written : ${desc}`);
if (unmatched) console.log(`not in the listing (older than the page): ${unmatched}`);
if (failedAccounts) console.log(`accounts that failed: ${failedAccounts}`);
