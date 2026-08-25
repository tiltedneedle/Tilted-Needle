// Copy borrowed poster frames into our own bucket, permanently.
//   node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/cache-thumbnails.mjs [--dry-run] [--limit N]
//
// TikTok and Instagram hand out SIGNED thumbnail URLs that answer 403 once the
// signature lapses. 158 of 570 stored URLs were already dead when this was
// written, and the damage was visible where it matters least forgivably: the
// monthly client PDF rendered rows of broken-image glyphs, because a report
// emailed in August is opened in September.
//
// Two passes, because a dead URL cannot simply be re-downloaded:
//
//   LIVE   the stored URL still resolves -- copy the bytes as they are.
//   DEAD   it 403s. TikTok's oEmbed will mint a FRESH signed url for the same
//          video, so the poster is recoverable; that fresh url is then cached
//          rather than stored, or we would be back here in a month.
//          Instagram HAS a free re-derivation route after all, contrary to
//          what an earlier version of this comment claimed: yt-dlp reads the
//          poster straight off the post page, but only from an address
//          Instagram will serve -- so it lives in
//          scripts/instagram-thumbnails.py, on the desktop, and is run BEFORE
//          this script. It writes a fresh signed url; this copies the bytes.
//
// YouTube is skipped by needsCaching: i.ytimg.com is derived from the video id
// and never expires, so copying it would spend storage to make it worse.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { cacheThumbnail, needsCaching } from "../src/lib/thumbnailCache.ts";
import { freeThumbnailFor } from "../src/lib/thumbnails.ts";

const env = Object.fromEntries(
  readFileSync("./.env.local", "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(),
                 l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
for (const [k, v] of Object.entries(env)) process.env[k] ??= v;
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

const DRY = process.argv.includes("--dry-run");
const li = process.argv.indexOf("--limit");
const LIMIT = li >= 0 ? Number(process.argv[li + 1]) : Infinity;

async function all(table, columns, apply) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await apply(db.from(table).select(columns)).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const accounts = await all("accounts", "id, platform_slug, handle", (q) => q.order("id"));
const acct = new Map(accounts.map((a) => [a.id, a]));

const posts = await all(
  "platform_posts",
  "id, account_id, external_id, url, thumbnail_url",
  (q) => q.not("thumbnail_url", "is", null).order("id"),
);

const todo = posts.filter((p) => needsCaching(p.thumbnail_url)).slice(0, LIMIT);
console.log(`posts with a thumbnail   ${posts.length}`);
console.log(`on an expiring host      ${todo.length}${LIMIT < Infinity ? ` (capped at ${LIMIT})` : ""}`);
if (DRY) {
  const byPlat = {};
  for (const p of todo) {
    const k = acct.get(p.account_id)?.platform_slug ?? "?";
    byPlat[k] = (byPlat[k] ?? 0) + 1;
  }
  console.log("\n--dry-run:", JSON.stringify(byPlat));
  process.exit(0);
}

let cachedLive = 0, cachedFresh = 0, lost = 0;
for (const p of todo) {
  const a = acct.get(p.account_id);
  // Pass 1: the stored URL may still be within its signature window.
  let url = await cacheThumbnail(db, p.id, p.thumbnail_url);
  if (url) {
    cachedLive++;
  } else if (a?.platform_slug === "tiktok" && p.external_id) {
    // Pass 2: mint a fresh signed URL, then cache THAT.
    const fresh = await freeThumbnailFor("tiktok", p.external_id, a.handle, p.url);
    if (fresh) url = await cacheThumbnail(db, p.id, fresh);
    if (url) cachedFresh++;
    // oEmbed is a free courtesy endpoint; the fastest way to lose a free
    // route is to hammer it.
    await new Promise((r) => setTimeout(r, 250));
  }

  if (!url) { lost++; continue; }
  const { error } = await db.from("platform_posts").update({ thumbnail_url: url }).eq("id", p.id);
  if (error) console.error(`  update ${p.id}: ${error.message}`);

  const done = cachedLive + cachedFresh + lost;
  if (done % 25 === 0) console.log(`  ${done}/${todo.length}…`);
}

console.log(`\ncached from the stored url   ${cachedLive}`);
console.log(`recovered via fresh oEmbed   ${cachedFresh}`);
console.log(`still unrecoverable          ${lost}`);
if (lost > 0) {
  console.log("  For Instagram, run scripts/instagram-thumbnails.py first --");
  console.log("  it re-derives a fresh poster url that this can then copy.");
}
