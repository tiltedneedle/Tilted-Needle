/**
 * Find work that needs doing and put it on the queue.
 *
 * The worker drains jobs; nothing until now decided what should exist. That
 * gap is the whole reason the corpus is half-collected: every backfill so far
 * has been a human running a one-off script. This is the piece that makes the
 * pipeline self-feeding.
 *
 *     node worker/enqueue.mjs                  (all kinds, default caps)
 *     node worker/enqueue.mjs --kinds=comments (one kind)
 *     node worker/enqueue.mjs --dry-run        (report, insert nothing)
 *
 * Three rules hold everywhere in this file:
 *
 *   IDEMPOTENT   A job already pending or running for the same subject is
 *                never duplicated. Running this twice a minute is harmless.
 *   CAPPED       Each kind has a per-run ceiling. 234 posts enqueued at once
 *                would spend an Apify budget, trip an API quota, or look
 *                exactly like the scraper we are at pains not to resemble.
 *   OLDEST FIRST Work is chosen by what has waited longest, so a backfill
 *                converges instead of re-picking the same rows.
 */
import { createClient } from "@supabase/supabase-js";
import { isYouTubeLike } from "./platforms.mjs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  process.exit(2);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const DRY = process.argv.includes("--dry-run");
const only = (() => {
  const a = process.argv.find((x) => x.startsWith("--kinds="));
  if (!a) return null;
  const l = a.slice(8).split(",").map((s) => s.trim()).filter(Boolean);
  return l.length ? l : null;
})();

/**
 * Per-run ceilings. Deliberately small for anything metered or fragile.
 * Overridable per kind so a deliberate catch-up run can push harder without
 * editing code: ENQUEUE_CAP_COMMENTS=40
 */
const CAP = (kind, fallback) =>
  Number(process.env[`ENQUEUE_CAP_${kind.toUpperCase()}`] ?? fallback);

const log = (event, data = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...data }));

/**
 * Is this post's video work we should spend money on?
 *
 * The review_state half is done in the query (`item.review_state=approved`).
 * The archived-client half is done HERE, in code, on purpose: filtering it in
 * PostgREST would need a condition on the embedded clients row, and an inner
 * join through clients silently drops every video with a NULL client_id --
 * which is current work, not archived work. Losing those would be invisible:
 * fewer jobs enqueued, no error, no clue.
 *
 * This gate exists because all three planners spend real money. Comments burn
 * YouTube quota, transcripts spend a fragile and rate-limited route, and
 * analyse spends LLM tokens against a monthly ceiling. Paying any of that to
 * enrich a video the client posted themselves -- or one belonging to a client
 * we no longer work with -- is spend with no possible return.
 *
 * Snapshots are deliberately NOT gated this way (see syncRunner): a metrics
 * reading is the one thing in this system that cannot be reconstructed later,
 * so it keeps being collected even for work we do not count.
 */
function isLiveAgencyWork(p) {
  const item = Array.isArray(p.item) ? p.item[0] : p.item;
  if (!item) return false;
  if (item.review_state !== "approved") return false;
  const client = Array.isArray(item.client) ? item.client[0] : item.client;
  // No client row at all means no client -- still ours.
  return !client?.is_archived;
}

/** Subjects that already have a job in flight for this kind. */
async function inFlight(kind) {
  const { data, error } = await db
    .from("ingest_jobs")
    .select("subject_id")
    .eq("kind", kind)
    .in("status", ["pending", "running"]);
  if (error) throw new Error(`in-flight lookup failed: ${error.message}`);
  return new Set((data ?? []).map((r) => r.subject_id));
}

/**
 * Subjects that already failed terminally or were marked unavailable.
 *
 * Without this the enqueuer and the worker fight each other forever: the
 * worker records "this video has no captions", and the enqueuer cheerfully
 * queues it again on the next run. A permanent no is a no.
 */
async function settled(kind) {
  const { data, error } = await db
    .from("ingest_jobs")
    .select("subject_id")
    .eq("kind", kind)
    .in("status", ["unavailable", "failed"]);
  if (error) throw new Error(`settled lookup failed: ${error.message}`);
  return new Set((data ?? []).map((r) => r.subject_id));
}

async function insert(kind, subjects, workspaceBySubject) {
  if (subjects.length === 0) return 0;
  if (DRY) return subjects.length;
  const rows = subjects.map((id) => ({
    workspace_id: workspaceBySubject.get(id),
    kind,
    subject_id: id,
  }));
  const { error } = await db.from("ingest_jobs").insert(rows);
  if (error) throw new Error(`insert failed: ${error.message}`);
  return rows.length;
}

/* ---- comments ------------------------------------------------------------
   Keyed by CONTENT ITEM, not platform post -- the handler resolves an item to
   its posts and fetches whichever expose comments (worker/jobs/comments.mjs).
   Getting this wrong is silent and expensive: passing post ids made every job
   look up an item that does not exist, report "no post on this item exposes
   comments", and settle as UNAVAILABLE -- a terminal state the enqueuer then
   refuses to retry. Twenty-five posts were written off before the phrasing of
   that message gave it away.

   TikTok is excluded because it exposes no comments at all (measured), so
   queueing it would manufacture guaranteed failures. */
async function planComments() {
  const kind = "comments";
  const cap = CAP(kind, 25);
  const maxAgeDays = Number(process.env.COMMENTS_REFRESH_DAYS ?? 30);

  const { data: posts, error } = await db
    .from("platform_posts")
    .select("id, content_item_id, workspace_id, account:accounts(platform_slug), item:content_items!inner(review_state, client:clients(is_archived))")
    .not("external_id", "is", null)
    .eq("item.review_state", "approved");
  if (error) throw new Error(error.message);

  // An item is worth queueing if ANY of its posts is on a platform that
  // exposes comments.
  const items = new Map();       // content_item_id -> workspace_id
  const postsOfItem = new Map(); // content_item_id -> post ids
  for (const p of posts ?? []) {
    if (!isLiveAgencyWork(p)) continue;
    const slug = (Array.isArray(p.account) ? p.account[0] : p.account)?.platform_slug;
    // Shorts count as YouTube here: they carry captions like any other video
    // on the service, and excluding them would leave a whole platform with no
    // transcripts for no reason.
    if (!isYouTubeLike(slug) && slug !== "instagram") continue;
    items.set(p.content_item_id, p.workspace_id);
    if (!postsOfItem.has(p.content_item_id)) postsOfItem.set(p.content_item_id, []);
    postsOfItem.get(p.content_item_id).push(p.id);
  }

  const { data: seen } = await db
    .from("post_comments")
    .select("platform_post_id, fetched_at");
  const newestByPost = new Map();
  for (const c of seen ?? []) {
    const t = new Date(c.fetched_at).getTime();
    if (!newestByPost.has(c.platform_post_id) || t > newestByPost.get(c.platform_post_id)) {
      newestByPost.set(c.platform_post_id, t);
    }
  }
  // An item is as fresh as its most recently fetched post.
  const newestByItem = new Map();
  for (const [itemId, ids] of postsOfItem) {
    const times = ids.map((id) => newestByPost.get(id)).filter(Boolean);
    if (times.length) newestByItem.set(itemId, Math.max(...times));
  }

  const stale = Date.now() - maxAgeDays * 86400000;
  const [busy, done] = [await inFlight(kind), await settled(kind)];
  const wanted = [...items.keys()]
    .filter((id) => !busy.has(id) && !done.has(id))
    .filter((id) => !newestByItem.has(id) || newestByItem.get(id) < stale)
    .sort((a, b) => (newestByItem.get(a) ?? 0) - (newestByItem.get(b) ?? 0))
    .slice(0, cap);

  return { kind, count: await insert(kind, wanted, items), cap };
}

/* ---- transcript ----------------------------------------------------------
   Per CONTENT ITEM: one transcript describes every platform cut of the same
   edit. Instagram-only items are skipped -- those posts carry no caption
   track at all, so queueing them would manufacture guaranteed failures. */
async function planTranscript() {
  const kind = "transcript";
  const cap = CAP(kind, 8);

  const { data: posts, error } = await db
    .from("platform_posts")
    .select("content_item_id, workspace_id, account:accounts(platform_slug), item:content_items!inner(review_state, client:clients(is_archived))")
    .not("external_id", "is", null)
    .eq("item.review_state", "approved");
  if (error) throw new Error(error.message);

  const byItem = new Map();
  for (const p of posts ?? []) {
    if (!isLiveAgencyWork(p)) continue;
    const slug = (Array.isArray(p.account) ? p.account[0] : p.account)?.platform_slug;
    if (!isYouTubeLike(slug) && slug !== "tiktok") continue;
    if (!byItem.has(p.content_item_id)) {
      byItem.set(p.content_item_id, p.workspace_id);
    }
  }

  const { data: have } = await db.from("video_transcripts").select("content_item_id");
  const stored = new Set((have ?? []).map((r) => r.content_item_id));
  const [busy, done] = [await inFlight(kind), await settled(kind)];

  const wanted = [...byItem.keys()]
    .filter((id) => !stored.has(id) && !busy.has(id) && !done.has(id))
    .slice(0, cap);

  return { kind, count: await insert(kind, wanted, byItem), cap };
}

/* ---- analyse -------------------------------------------------------------
   Comment themes, keyed by CONTENT ITEM (worker/jobs/analyse.mjs resolves an
   item to its posts, exactly as the comments handler does).

   THE SUBJECT TYPE IS THE TRAP IN THIS FILE. Every handler here takes a
   content_item_id, never a platform_post_id -- see SUBJECT_TYPE below. Getting
   it wrong is silent and expensive: the handler looks up an item that does not
   exist, reports "no platform posts on this content item", and settles as
   UNAVAILABLE, which is terminal and never retried. It cost 25 posts on the
   comments planner and another 10 here before the pattern was obvious -- both
   times the tell was jobs "completing" in 400 ms, far too fast to have called
   anything.

   Gated on the LLM being configured: queueing analysis with no key fills the
   queue with jobs that fail four times each and poison the failure metrics. */
async function planAnalyse() {
  const kind = "analyse";
  const cap = CAP(kind, 10);
  if (!process.env.LLM_API_KEY) return { kind, count: 0, cap, skipped: "LLM_API_KEY not set" };

  // Comments are stored per post; analysis runs per item. Resolve the join
  // rather than passing post ids straight through.
  const { data: withComments } = await db
    .from("post_comments")
    .select("platform_post_id, workspace_id");
  const postIds = [...new Set((withComments ?? []).map((c) => c.platform_post_id))];
  if (postIds.length === 0) return { kind, count: 0, cap };

  const { data: posts } = await db
    .from("platform_posts")
    .select("id, content_item_id, workspace_id, item:content_items!inner(review_state, client:clients(is_archived))")
    .in("id", postIds)
    .eq("item.review_state", "approved");

  const subjects = new Map(); // content_item_id -> workspace_id
  for (const p of posts ?? []) {
    if (!isLiveAgencyWork(p)) continue;
    subjects.set(p.content_item_id, p.workspace_id);
  }

  const { data: done } = await db
    .from("ai_analyses")
    .select("subject_id")
    .eq("kind", "comment_themes");
  const analysed = new Set((done ?? []).map((r) => r.subject_id));
  const [busy, settledSet] = [await inFlight(kind), await settled(kind)];

  const wanted = [...subjects.keys()]
    .filter((id) => !analysed.has(id) && !busy.has(id) && !settledSet.has(id))
    .slice(0, cap);

  return { kind, count: await insert(kind, wanted, subjects), cap };
}

/**
 * What `ingest_jobs.subject_id` means, per kind. Every value here is
 * `content_item` — recorded explicitly because assuming otherwise has now
 * caused the same silent write-off twice. A new planner must state its subject
 * type here and match its handler before it ships.
 */
export const SUBJECT_TYPE = {
  comments: "content_item",
  transcript: "content_item",
  analyse: "content_item",
};

const PLANNERS = { comments: planComments, transcript: planTranscript, analyse: planAnalyse };

const chosen = only ?? Object.keys(PLANNERS);
let total = 0;
for (const kind of chosen) {
  const planner = PLANNERS[kind];
  if (!planner) {
    log("unknown_kind", { kind });
    continue;
  }
  try {
    const r = await planner();
    total += r.count;
    log("enqueued", { ...r, dryRun: DRY });
  } catch (e) {
    log("enqueue_failed", { kind, error: String(e.message ?? e) });
    process.exitCode = 1;
  }
}
log("enqueue_complete", { total, dryRun: DRY });
