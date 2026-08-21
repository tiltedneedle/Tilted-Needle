// Recompute Tier 1 features across the corpus.
//   node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/compute-features.mjs [--dry-run]
//
// Safe to run at any time, and meant to be. Tier 1 is pure arithmetic over
// data already held, so this is a CACHE REBUILD, not a migration: change a
// threshold, bump EXTRACTOR_VERSION, run this again. Nothing is lost, because
// nothing here is a record of anything -- the transcripts and metadata it
// reads are the record.
//
// It writes to video_features only. video_descriptors costs tokens and is
// deliberately a separate table for exactly this reason: a Tier 1 recompute
// must never be able to discard paid work.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { extractFeatures, EXTRACTOR_VERSION } from "../src/lib/analysis/features.ts";
import { zoneOffsetMs, OPERATING_TZ } from "../src/lib/tz.ts";

const env = Object.fromEntries(
  readFileSync("./.env.local", "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(),
                 l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
for (const [k, v] of Object.entries(env)) process.env[k] ??= v;

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
const DRY = process.argv.includes("--dry-run");

/** Paged AND ordered. An unbounded select is silently capped at 1000 rows, and
 *  PostgREST guarantees no row order without an ORDER BY, so successive windows
 *  over the same table can skip rows and repeat others. Both mistakes have cost
 *  this project real bugs. */
async function all(table, select, orderBy = "id") {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(select).order(orderBy).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const items = await all(
  "content_items",
  "id, workspace_id, title, length_seconds, review_state, client:clients(is_archived)",
);
const transcripts = new Map(
  (await all("video_transcripts", "content_item_id, full_text, segments", "content_item_id"))
    .map((t) => [t.content_item_id, t]),
);

/* Publish time lives on the POSTS, not the item. An edit posted to three
   platforms has one set of words and three postings; the earliest is taken as
   "when this went out", because that is the instant the audience first had
   it. Length comes from content_items, which is a property of the edit. */
const posts = await all("platform_posts", "content_item_id, posted_at_ts");
const earliest = new Map();
for (const p of posts) {
  /* posted_at_ts, NOT posted_at. The date column is a date on every platform
     and a great deal of filtering depends on it staying one -- so the full
     instant was added beside it precisely because slicing to a date discards
     the hour forever and no backfill can restore what was never stored.
     Reading the date here would silently place every post at midnight and
     make the before-noon canary a statement about our own truncation. */
  if (p.posted_at_ts) {
    const t = Date.parse(p.posted_at_ts);
    if (Number.isFinite(t) && (!earliest.has(p.content_item_id) || t < earliest.get(p.content_item_id))) {
      earliest.set(p.content_item_id, t);
    }
  }
}

const one = (v) => (Array.isArray(v) ? v[0] : v);
const inScope = items.filter((i) => i.review_state === "approved" && !one(i.client)?.is_archived);

const rows = [];
let withTranscript = 0;
for (const item of inScope) {
  const t = transcripts.get(item.id);
  const publishedAtMs = earliest.get(item.id) ?? null;
  const f = extractFeatures({
    transcript: t ? { segments: t.segments ?? [], fullText: t.full_text ?? "" } : null,
    title: item.title ?? null,
    lengthSeconds: item.length_seconds ?? null,
    publishedAtMs,
    // Resolved AT the publish instant, per post. A fixed offset is wrong across
    // a DST boundary, and the earlier fixed-offset bug moved videos across the
    // very hour boundary the finding was about.
    zoneOffsetMs: publishedAtMs === null ? null : zoneOffsetMs(new Date(publishedAtMs), OPERATING_TZ),
  });
  if (f.transcriptPresent) withTranscript++;

  rows.push({
    content_item_id: item.id,
    workspace_id: item.workspace_id,
    extractor_version: f.extractorVersion,
    hook_text_15s: f.hookText15s,
    hook_word_count: f.hookWordCount,
    hook_has_question: f.hookHasQuestion,
    hook_is_greeting: f.hookIsGreeting,
    hook_second_person_rate: f.hookSecondPersonRate,
    hook_imperative_open: f.hookImperativeOpen,
    hook_numeral: f.hookNumeral,
    words_per_second: f.wordsPerSecond,
    words_per_second_3s: f.wordsPerSecond3s,
    time_to_first_noun_ms: f.timeToFirstNounMs,
    question_density: f.questionDensity,
    numeral_density: f.numeralDensity,
    type_token_ratio: f.typeTokenRatio,
    flesch_kincaid: f.fleschKincaid,
    cta_present: f.ctaPresent,
    cta_first_ms: f.ctaFirstMs,
    loop_marker: f.loopMarker,
    title_length: f.titleLength,
    title_has_question: f.titleHasQuestion,
    title_has_numeral: f.titleHasNumeral,
    length_seconds: f.lengthSeconds,
    posted_hour: f.postedHour,
    posted_weekday: f.postedWeekday,
    transcript_present: f.transcriptPresent,
    computed_at: new Date().toISOString(),
  });
}

console.log(`zone            ${OPERATING_TZ}`);
console.log(`extractor       v${EXTRACTOR_VERSION}`);
console.log(`in scope        ${inScope.length} approved items on live clients`);
console.log(`with transcript ${withTranscript} (${Math.round(withTranscript * 100 / inScope.length)}%)`);
console.log(`with a title    ${rows.filter((r) => r.title_length != null).length}`);
console.log(`with a time     ${rows.filter((r) => r.posted_hour != null).length}`);

if (DRY) {
  console.log("\n--dry-run: nothing written. Sample:");
  for (const r of rows.filter((x) => x.transcript_present).slice(0, 3)) {
    console.log(" ", JSON.stringify({
      hook: (r.hook_text_15s ?? "").slice(0, 48),
      words: r.hook_word_count, q: r.hook_has_question, wps: r.words_per_second,
      firstNoun: r.time_to_first_noun_ms, cta: r.cta_present, loop: r.loop_marker,
    }));
  }
  process.exit(0);
}

// Chunked: a single upsert of 437 wide rows is one request PostgREST has no
// reason to accept, and a partial failure would be hard to reason about.
let written = 0;
for (let i = 0; i < rows.length; i += 200) {
  const chunk = rows.slice(i, i + 200);
  const { error } = await db.from("video_features").upsert(chunk, { onConflict: "content_item_id" });
  if (error) throw new Error(`upsert failed at row ${i}: ${error.message}`);
  written += chunk.length;
}
console.log(`\nwrote ${written} feature rows`);
