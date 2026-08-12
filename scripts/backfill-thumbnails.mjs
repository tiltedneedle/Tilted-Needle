// Backfills poster frames for posts that already exist.
//
// YouTube ONLY, and it makes ZERO API calls. A YouTube thumbnail URL is a
// pure function of the video id -- i.ytimg.com/vi/<id>/mqdefault.jpg -- so
// every already-synced YouTube post can be filled in from data we hold, with
// no quota spent and no network request to Google at all.
//
// Instagram is deliberately NOT backfilled. Its thumbnails only arrive with a
// discovery response, and a discovery response is a metered Apify run costing
// the client real money. Spending it to populate a decorative image on old
// rows is not a trade worth making; those tiles show the neutral placeholder
// until their next scheduled run fills them in for free.
//
// TikTok IS backfilled, through its public oEmbed endpoint -- keyless, free,
// one request per video, and it returns thumbnail_url directly. Slower than
// YouTube's pure-function URL because it is a real request per post, so it is
// paced; but it costs nothing and needs no token.
//
// Idempotent: only touches rows where thumbnail_url is null. Safe to re-run.
//
//   node scripts/backfill-thumbnails.mjs           # report only
//   node scripts/backfill-thumbnails.mjs --apply   # write
import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")];
    }),
);
const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SECRET_KEY;
const H = { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" };

/** A YouTube id is 11 chars of [A-Za-z0-9_-]. Anything else is not one. */
const YT_ID = /^[A-Za-z0-9_-]{11}$/;

const rows = await (
  await fetch(
    `${URL_BASE}/rest/v1/platform_posts` +
      `?select=id,external_id,url,thumbnail_url,account:accounts!inner(platform_slug,handle)` +
      `&thumbnail_url=is.null&limit=2000`,
    { headers: H },
  )
).json();

if (!Array.isArray(rows)) {
  console.error("query failed:", JSON.stringify(rows).slice(0, 300));
  process.exit(1);
}

const one = (v) => (Array.isArray(v) ? v[0] : v);
const yt = rows.filter((r) => {
  const slug = one(r.account)?.platform_slug;
  return (slug === "youtube" || slug === "youtube_shorts") && YT_ID.test(r.external_id ?? "");
});
const tt = rows.filter((r) => one(r.account)?.platform_slug === "tiktok" && r.external_id);

const byPlatform = {};
for (const r of rows) {
  const s = one(r.account)?.platform_slug ?? "(none)";
  byPlatform[s] = (byPlatform[s] ?? 0) + 1;
}

console.log(`posts with no thumbnail : ${rows.length}`);
console.log(`  by platform           : ${JSON.stringify(byPlatform)}`);
console.log(`free from the id   (YT) : ${yt.length}`);
console.log(`free via oEmbed (TikTok): ${tt.length}`);
console.log(
  `left for the sync to fill: ${rows.length - yt.length - tt.length}` +
    ` (Instagram only — its thumbnail arrives with the next discovery run)`,
);

if (!APPLY) {
  console.log("\nreport only. re-run with --apply to write.");
  process.exit(0);
}

let ok = 0;
let failed = 0;
for (const r of yt) {
  // mqdefault (320x180) exists for every video ever uploaded. maxres does
  // not, and asking for one that is missing returns a 404 placeholder image
  // rather than an error -- which would look like a broken thumbnail while
  // reporting success.
  const url = `https://i.ytimg.com/vi/${r.external_id}/mqdefault.jpg`;
  const res = await fetch(`${URL_BASE}/rest/v1/platform_posts?id=eq.${r.id}`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ thumbnail_url: url }),
  });
  if (res.ok) ok++;
  else {
    failed++;
    if (failed <= 3) console.error(`  failed ${r.id}: ${res.status} ${await res.text()}`);
  }
}
/* TikTok, through the public oEmbed endpoint: keyless, free, and it returns
   thumbnail_url directly. One real request per video, so it is paced -- this
   is a courtesy to an endpoint nobody is obliged to give us, and going at it
   flat out is how a free route stops being free. */
let ttOk = 0;
let ttMiss = 0;
for (const r of tt) {
  const acct = one(r.account);
  const url =
    r.url ?? `https://www.tiktok.com/@${(acct?.handle ?? "").replace(/^@/, "")}/video/${r.external_id}`;
  try {
    const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
    if (!res.ok) { ttMiss++; continue; }
    const body = await res.json();
    if (!body?.thumbnail_url) { ttMiss++; continue; }
    const patch = await fetch(`${URL_BASE}/rest/v1/platform_posts?id=eq.${r.id}`, {
      method: "PATCH",
      headers: H,
      body: JSON.stringify({ thumbnail_url: body.thumbnail_url }),
    });
    patch.ok ? ttOk++ : ttMiss++;
  } catch {
    ttMiss++;
  }
  await new Promise((res) => setTimeout(res, 250));
}
if (tt.length) console.log(`tiktok via oEmbed: wrote ${ttOk}, missed ${ttMiss}`);

console.log(`\nwrote ${ok}, failed ${failed}`);

// Verify against the database rather than trusting the loop's own tally.
const check = await fetch(
  `${URL_BASE}/rest/v1/platform_posts?select=id&thumbnail_url=not.is.null`,
  { headers: { ...H, prefer: "count=exact", range: "0-0" } },
);
console.log("rows now carrying a thumbnail:", check.headers.get("content-range"));
