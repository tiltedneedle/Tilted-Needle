/**
 * Recompute every stored publish DATE from its instant, in operating time.
 *
 * Providers wrote `posted_at` as `timestamp.slice(0, 10)` -- the UTC calendar
 * day -- and `content_items.produced_at` copied it. That answers "what day was
 * it in Greenwich", which nobody asked: 103 of 443 posts fall on a different
 * operating-timezone day than their own slice, and five cross a MONTH
 * boundary, which is enough to put a video in the wrong client report.
 *
 * The ingest paths now derive the date from the instant. This brings the rows
 * written before that change into line, so a report over history and a report
 * over next month mean the same thing by "published on".
 *
 * Posts with no instant are LEFT ALONE. Fourteen Instagram rows have only a
 * date, and inventing a time for them would be worse than the ambiguity.
 *
 *   node scripts/backfill-publish-dates.mjs           # preview only
 *   node scripts/backfill-publish-dates.mjs --apply   # write
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { operatingDate, OPERATING_TZ } from "../src/lib/tz.ts";

const env = Object.fromEntries(
  readFileSync("./.env.local", "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const APPLY = process.argv.includes("--apply");

const posts = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from("platform_posts")
    .select("id, content_item_id, posted_at, posted_at_ts")
    .order("id")
    .range(from, from + 999);
  if (error) throw error;
  posts.push(...data);
  if (data.length < 1000) break;
}

console.log(`operating timezone: ${OPERATING_TZ}`);
console.log(`platform_posts: ${posts.length}\n`);

const postFixes = [];
const monthMoves = [];
let noInstant = 0;

for (const p of posts) {
  if (!p.posted_at_ts) { noInstant++; continue; }
  const d = new Date(p.posted_at_ts);
  if (Number.isNaN(d.getTime())) { noInstant++; continue; }
  const want = operatingDate(d);
  const have = (p.posted_at ?? "").slice(0, 10);
  if (want === have) continue;
  postFixes.push({ id: p.id, itemId: p.content_item_id, have, want });
  if (have.slice(0, 7) !== want.slice(0, 7)) monthMoves.push({ id: p.id, have, want });
}

console.log(`posts with no instant, left untouched : ${noInstant}`);
console.log(`posts whose stored day is wrong        : ${postFixes.length}`);
console.log(`   of those, moving to another MONTH   : ${monthMoves.length}`);
for (const m of monthMoves) console.log(`      ${m.id.slice(0, 8)}  ${m.have} -> ${m.want}`);

if (postFixes.length === 0) {
  console.log("\nnothing to do.");
  process.exit(0);
}

console.log(`\nsample of the rest:`);
for (const f of postFixes.slice(0, 6)) console.log(`   ${f.id.slice(0, 8)}  ${f.have} -> ${f.want}`);

if (!APPLY) {
  console.log(`\nPREVIEW ONLY. Re-run with --apply to write ${postFixes.length} post dates`);
  console.log(`and their content_items.produced_at to match.`);
  process.exit(0);
}

let posted = 0, produced = 0;
for (const f of postFixes) {
  const { error: e1 } = await db.from("platform_posts").update({ posted_at: f.want }).eq("id", f.id);
  if (e1) { console.log(`   ERROR post ${f.id}: ${e1.message}`); continue; }
  posted++;
  // produced_at is our copy of the same fact and must not drift from it.
  const { error: e2 } = await db
    .from("content_items")
    .update({ produced_at: f.want })
    .eq("id", f.itemId)
    .eq("produced_at", f.have);
  if (!e2) produced++;
}
console.log(`\nupdated ${posted} platform_posts and ${produced} content_items.`);
