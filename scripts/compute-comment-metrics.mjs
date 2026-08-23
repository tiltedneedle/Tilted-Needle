// Recompute Tier 3 comment diagnostics across the corpus.
//   npm run compute:commentmetrics [-- --dry-run]
//
// Pure arithmetic over comments already stored: no model, no network, no
// quota. Like Tier 1 features this is a CACHE, not a record -- change a marker
// list, bump COMMENT_METRICS_VERSION, run it again. Safe to re-run at any
// time and cheap enough that there is never a reason not to.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  computeCommentMetrics, COMMENT_METRICS_VERSION,
} from "../src/lib/analysis/commentMetrics.ts";

let fileEnv = {};
try {
  fileEnv = Object.fromEntries(
    readFileSync("./.env.local", "utf8").split("\n").filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(),
                   l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
  );
} catch { /* CI supplies the environment directly */ }
const env = { ...fileEnv, ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  process.exit(1);
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
const DRY = process.argv.includes("--dry-run");

/** Paged AND ordered -- an unbounded select stops at 1000 rows without saying
 *  so, and windows over an unordered table skip and repeat. post_comments is
 *  already past 3,400 rows, so this one would silently truncate today. */
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

const comments = await all("post_comments", "id, platform_post_id, workspace_id, text, like_count");
const byPost = new Map();
for (const c of comments) {
  if (!byPost.has(c.platform_post_id)) byPost.set(c.platform_post_id, { ws: c.workspace_id, rows: [] });
  byPost.get(c.platform_post_id).rows.push({ id: c.id, text: c.text, likeCount: c.like_count });
}

console.log(`comments        ${comments.length} across ${byPost.size} posts`);

const rows = [];
let analysed = 0, filtered = 0, mentions = 0, questions = 0, confusion = 0, intent = 0;
for (const [postId, { ws, rows: cs }] of byPost) {
  const m = computeCommentMetrics(cs);
  analysed += m.analysedCount; filtered += m.filteredCount;
  mentions += m.mentionCount; questions += m.questionCount;
  confusion += m.confusionCount; intent += m.intentCount;
  rows.push({
    platform_post_id: postId,
    workspace_id: ws,
    extractor_version: COMMENT_METRICS_VERSION,
    analysed_count: m.analysedCount,
    filtered_count: m.filteredCount,
    mention_count: m.mentionCount,
    question_count: m.questionCount,
    confusion_count: m.confusionCount,
    intent_count: m.intentCount,
    median_length: m.medianLength,
    reply_ratio: m.replyRatio,      // null, and it stays null -- see the module
    computed_at: new Date().toISOString(),
  });
}

const pct = (n) => (analysed ? `${Math.round((n * 100) / analysed)}%` : "-");
console.log(`analysed        ${analysed} substantive, ${filtered} filtered as reactions `
  + `(${Math.round((filtered * 100) / (analysed + filtered))}% of all comments)`);
console.log(`questions       ${questions} (${pct(questions)} of analysed)`);
console.log(`purchase intent ${intent} (${pct(intent)})`);
console.log(`mentions        ${mentions} (${pct(mentions)})`);
console.log(`confusion       ${confusion} (${pct(confusion)})`);

if (DRY) {
  console.log("\n--dry-run: nothing written.");
  process.exit(0);
}

let written = 0;
for (let i = 0; i < rows.length; i += 200) {
  const chunk = rows.slice(i, i + 200);
  const { error } = await db.from("post_comment_metrics")
    .upsert(chunk, { onConflict: "platform_post_id" });
  if (error) throw new Error(`upsert failed at row ${i}: ${error.message}`);
  written += chunk.length;
}
console.log(`\nwrote ${written} post metric rows`);
