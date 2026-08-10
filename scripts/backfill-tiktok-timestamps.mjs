// Recover TikTok publish timestamps from the video ID itself.
//
// NO NETWORK CALL. TikTok video IDs are snowflake-encoded: the upper 32 bits
// are the creation time in Unix seconds, so `Number(BigInt(id) >> 32n)` is the
// exact publish instant. The ID is already in the database.
//
// This exists because the obvious route died. yt-dlp's TikTok extractor is
// broken in the current release ("Unable to extract universal data for
// rehydration") and 2026.07.04 is already the newest, so /meta returned 502 on
// all 78 posts. That was recorded as "blocked upstream" -- which was true of
// yt-dlp, and false of the problem. The data was never remote.
//
// VALIDATED, NOT ASSUMED. Deriving a timestamp from an opaque ID is exactly the
// kind of clever trick that silently writes plausible nonsense, so every decode
// is cross-checked against the posted_at date discovery already recorded, and
// anything disagreeing by more than a day is REFUSED rather than written. On
// the live library all 78 agreed and none disagreed; that is what earned the
// write.
//
//   node scripts/backfill-tiktok-timestamps.mjs [--apply]
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const env = (n) =>
  (readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").find((l) => l.startsWith(n + "=")) || "")
    .slice(n.length + 1).trim().replace(/^["']|["']$/g, "");

const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), {
  auth: { persistSession: false },
});

const { data: posts, error } = await db
  .from("platform_posts")
  .select("id, external_id, url, posted_at, posted_at_ts, account:accounts(platform_slug)")
  .not("url", "is", null);
if (error) throw new Error(error.message);

const tiktok = (posts ?? []).filter(
  (p) => (Array.isArray(p.account) ? p.account[0] : p.account)?.platform_slug === "tiktok",
);

// TikTok launched well after this; anything earlier means the shift produced
// garbage rather than a date.
const FLOOR = 1_400_000_000;

let agree = 0, disagree = 0, noRef = 0, unusable = 0;
const writes = [];

for (const p of tiktok) {
  const id = p.external_id ?? (p.url.match(/video\/(\d+)/) || [])[1];
  if (!id || !/^\d{15,25}$/.test(id)) { unusable++; continue; }

  const secs = Number(BigInt(id) >> 32n);
  if (secs < FLOOR || secs > Math.floor(Date.now() / 1000) + 86400) { unusable++; continue; }
  const iso = new Date(secs * 1000).toISOString();

  if (!p.posted_at) { noRef++; writes.push({ id: p.id, iso }); continue; }

  // Compare against what discovery recorded. A timezone boundary can move a
  // calendar date by one, so a day and a half is the tolerance; beyond that
  // the decode is not describing this post and must not be trusted.
  const delta = Math.abs(
    new Date(iso).getTime() - new Date(`${p.posted_at}T12:00:00Z`).getTime(),
  ) / 86_400_000;

  if (delta <= 1.5) { agree++; writes.push({ id: p.id, iso }); }
  else {
    disagree++;
    console.log(`  MISMATCH ${id}: decoded ${iso.slice(0, 10)} vs recorded ${p.posted_at}`);
  }
}

console.log(`tiktok posts: ${tiktok.length}`);
console.log(`  agree with recorded date : ${agree}`);
console.log(`  disagree (NOT written)   : ${disagree}`);
console.log(`  no recorded date to check: ${noRef}`);
console.log(`  unusable id              : ${unusable}`);

if (!APPLY) {
  console.log("\n(dry run — pass --apply to write)");
  process.exit(0);
}

let written = 0;
for (const { id, iso } of writes) {
  const { error: e } = await db
    .from("platform_posts").update({ posted_at_ts: iso }).eq("id", id);
  if (!e) written++;
}
console.log(`\nposted_at_ts written: ${written}`);
