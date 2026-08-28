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
  BACKFILL ? Infinity : Number(process.env[`ENQUEUE_CAP_${kind.toUpperCase()}`] ?? fallback);

/**
 * --backfill: enqueue the whole outstanding list, not one run's worth.
 *
 * The per-run cap was the throttle when nothing else was. It is the wrong
 * instrument now that the queue rate-limits itself: a 429 puts the entire
 * kind into cooldown and refunds the attempt, so the DRAIN is governed
 * properly and the enqueue does not need to be.
 *
 * Capping the enqueue instead had a cost that only became visible once
 * enrichment_state existed to measure it. At 8 transcripts a run, 264 of 564
 * videos had never been enqueued at all -- no transcript, no verdict, no job.
 * They were indistinguishable from videos that had been checked and found
 * wanting, which is the precise confusion this whole phase exists to remove.
 *
 * Backfilled jobs are inserted at a LOWER priority than the default 100, so
 * a 260-row backlog can never delay the handful of jobs a fresh sync
 * creates. The queue claims by `order by priority, not_before`.
 */
const BACKFILL = process.argv.includes("--backfill");
const BACKFILL_PRIORITY = 500;

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
/**
 * PAGED, and this one is load-bearing.
 *
 * Both of these read ingest_jobs, which holds 1,235 comments rows alone and
 * only grows. An unpaginated select is silently capped at 1000, so the
 * planner saw a PARTIAL picture of what was already queued or already
 * settled -- and then decided what to queue from it. The symptom was a
 * planner that converged instead of finishing: successive --backfill runs
 * enqueued 101, then 14, then a handful, each one seeing a different
 * thousand-row window of the same table.
 *
 * Not a performance nicety. A planner that cannot see every job it has
 * already created is a planner that duplicates work and drops work, which is
 * exactly the pair of symptoms this file was being fixed for.
 */
async function pagedSubjects(kind, statuses, label) {
      /* ORDERED, and this is not cosmetic. PostgREST gives no stable row
         order without one, so successive .range() windows over the same
         table can skip rows and repeat others. That is how the comments
         planner came to disagree with its own invariant test about the same
         seven videos, and why repeated backfills converged (101, 14, 8)
         instead of finishing. */

  const out = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("ingest_jobs")
      .select("subject_id")
      .eq("kind", kind)
      .in("status", statuses)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`${label} lookup failed: ${error.message}`);
    for (const r of data ?? []) out.add(r.subject_id);
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

async function inFlight(kind) {
  return pagedSubjects(kind, ["pending", "running"], "in-flight");
}

/**
 * Subjects that already failed terminally or were marked unavailable.
 *
 * Without this the enqueuer and the worker fight each other forever: the
 * worker records "this video has no captions", and the enqueuer cheerfully
 * queues it again on the next run. A permanent no is a no.
 */
async function settled(kind) {
  return pagedSubjects(kind, ["unavailable", "failed"], "settled");
}


async function insert(kind, subjects, workspaceBySubject) {
  if (subjects.length === 0) return 0;
  if (DRY) return subjects.length;
  const rows = subjects.map((id) => ({
    workspace_id: workspaceBySubject.get(id),
    kind,
    subject_id: id,
    // Backfill yields to live work; see BACKFILL above.
    ...(BACKFILL ? { priority: BACKFILL_PRIORITY } : {}),
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

  const posts = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("platform_posts")
      .select("id, content_item_id, workspace_id, account:accounts(platform_slug), item:content_items!inner(review_state, client:clients(is_archived))")
      .not("external_id", "is", null)
      .eq("item.review_state", "approved")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    posts.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }

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
    /* TikTok joined this list when the Apify lane shipped. It is the one
       platform whose comments cost money, and the handler is where that is
       controlled -- it answers from the sync's own comment count when that
       says zero (62 of 144 posts), caps what it fetches, and checks the
       remaining monthly allowance before spending any of it. Filtering TikTok
       out here instead would have been the cheaper-looking choice and the
       wrong one: it would leave 142 items permanently unaccounted for while
       looking deliberate. */
    if (!isYouTubeLike(slug) && slug !== "instagram" && slug !== "tiktok") continue;
    items.set(p.content_item_id, p.workspace_id);
    if (!postsOfItem.has(p.content_item_id)) postsOfItem.set(p.content_item_id, []);
    postsOfItem.get(p.content_item_id).push(p.id);
  }

  /* Paged: this is every comment row in the workspace, already past 2,000
     and growing with every fetch. Truncated at 1000 it would report posts as
     never-fetched and requeue them -- the same failure this function is
     being fixed for. */
  const seen = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db
      .from("post_comments")
      .select("platform_post_id, fetched_at")
      .order("id")
      .range(from, from + 999);
    if (!data?.length) break;
    seen.push(...data);
    if (data.length < 1000) break;
  }
  const newestByPost = new Map();
  for (const c of seen) {
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

  /* Items already answered "there are none", and not yet due a recheck.
   *
   * WITHOUT THIS THE PLANNER CANNOT TERMINATE. Freshness is read from the
   * newest post_comments row, so a post with zero comments leaves no row,
   * looks never-fetched on every run, and is queued again forever. Measured
   * before the fix: 1,196 comments jobs over 196 distinct subjects, one
   * queued 49 times, while 263 of 437 in-scope items had never been queued
   * once -- the cap was being spent re-asking about posts already known to
   * be empty. */
  const { data: verdicts } = await db
    .from("enrichment_state")
    .select("subject_id, state, recheck_after")
    .eq("kind", "comments");
  const nowIso = new Date().toISOString();
  const answered = new Set(
    (verdicts ?? [])
      .filter((v) => !v.recheck_after || v.recheck_after > nowIso)
      .map((v) => v.subject_id),
  );

  const stale = Date.now() - maxAgeDays * 86400000;
  const [busy, done] = [await inFlight(kind), await settled(kind)];
  const wanted = [...items.keys()]
    .filter((id) => !busy.has(id) && !done.has(id) && !answered.has(id))
    .filter((id) => !newestByItem.has(id) || newestByItem.get(id) < stale)
    /* Oldest first, with the id as a DETERMINISTIC tiebreaker. Every
       never-fetched item shares the sort key 0, so without a tiebreaker their
       order came from the query's row order and the same 25 were chosen every
       run -- which is the other half of how one subject reached 49 jobs. */
    .sort((a, b) =>
      ((newestByItem.get(a) ?? 0) - (newestByItem.get(b) ?? 0)) || a.localeCompare(b))
    .slice(0, cap);

  return { kind, count: await insert(kind, wanted, items), cap };
}

/**
 * Does the extraction host have a working audio route?
 *
 * Asked rather than assumed, because the answer is a key on THAT machine and
 * nothing here can see it. Instagram publishes no captions, so those items are
 * only worth queueing when their audio can be read -- and queueing 146 of them
 * against an unset key would manufacture precisely the guaranteed failures
 * this planner was written to avoid.
 *
 * A host that cannot be reached answers false: the conservative direction,
 * since the cost is a delayed backfill rather than a batch of dead jobs.
 */
let asrReadyCache;
async function asrReady() {
  if (asrReadyCache !== undefined) return asrReadyCache;
  const base = process.env.TIKTOK_DISCOVER_URL;
  if (!base) return (asrReadyCache = false);
  try {
    const res = await fetch(base.replace(/\/discover\/?$/, "") + "/health", {
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json();
    asrReadyCache = Boolean(body?.asr && body?.ffmpeg);
  } catch {
    asrReadyCache = false;
  }
  return asrReadyCache;
}

/* ---- transcript ----------------------------------------------------------
   Per CONTENT ITEM: one transcript describes every platform cut of the same
   edit. Instagram-only items are skipped HERE and planned by planTranscriptAsr
   instead -- see that function for why they are a separate kind rather than a
   branch of this one. */
async function planTranscript() {
  const kind = "transcript";
  const cap = CAP(kind, 8);

  /* Paged. Unbounded selects are capped at 1000 rows by PostgREST without
     saying so, and this one is workspace-wide: it fits today at 564 posts and
     would start silently skipping videos at 1000. That failure mode has
     already cost this project twice. */
  const posts = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("platform_posts")
      .select("content_item_id, workspace_id, account:accounts(platform_slug), item:content_items!inner(review_state, client:clients(is_archived))")
      .not("external_id", "is", null)
      .eq("item.review_state", "approved")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    posts.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }

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

/* ---- transcript_asr ------------------------------------------------------
   Items whose every platform publishes NO caption track, transcribed from
   their audio instead.

   In practice that means Instagram: 146 live items, zero transcripts between
   them, each carrying a `platform_unsupported` verdict that was true only for
   as long as captions were the sole route. The audio has always been there.

   A SEPARATE KIND, NOT A BRANCH OF planTranscript. Kinds here are split by IP
   reputation, and audio falls on the opposite side of that line from captions:
   measured from the Oracle box, Instagram serves it an audio stream while
   YouTube refuses the same address outright. One shared kind would force the
   worse of both worlds -- enable it there and the first YouTube job earns a bot
   challenge, which cools the whole kind for two hours and stalls 146 Instagram
   items that were never in any difficulty. */
async function planTranscriptAsr() {
  const kind = "transcript_asr";
  const cap = CAP(kind, 8);

  // Gated on the host actually having a route. Queueing against an unset key
  // would manufacture exactly the guaranteed failures planTranscript avoids by
  // skipping these items in the first place.
  if (!(await asrReady())) return { kind, count: 0, cap, skipped: "no ASR route on the host" };

  const posts = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("platform_posts")
      .select("content_item_id, workspace_id, url, account:accounts(platform_slug), item:content_items!inner(review_state, client:clients(is_archived))")
      .not("external_id", "is", null)
      .eq("item.review_state", "approved")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    posts.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }

  /* An item qualifies only if NO platform on it publishes captions. A
     cross-posted edit that also exists on YouTube is left to planTranscript,
     because a real caption track beats ASR every time -- machine transcription
     mangles names, brands and accents, which is exactly the vocabulary this
     corpus gets searched for. */
  const platformsOf = new Map();
  const wsOf = new Map();
  const hasUrl = new Set();
  for (const p of posts) {
    if (!isLiveAgencyWork(p)) continue;
    const slug = (Array.isArray(p.account) ? p.account[0] : p.account)?.platform_slug;
    if (!platformsOf.has(p.content_item_id)) platformsOf.set(p.content_item_id, new Set());
    if (slug) platformsOf.get(p.content_item_id).add(slug);
    wsOf.set(p.content_item_id, p.workspace_id);
    if (p.url) hasUrl.add(p.content_item_id);
  }

  const eligible = [...platformsOf.entries()]
    .filter(([id, slugs]) =>
      slugs.size > 0 &&
      hasUrl.has(id) &&                                   // the lane needs a URL
      ![...slugs].some((s) => isYouTubeLike(s) || s === "tiktok"))
    .map(([id]) => id);

  const { data: have } = await db.from("video_transcripts").select("content_item_id");
  const stored = new Set((have ?? []).map((r) => r.content_item_id));
  const [busy, done] = [await inFlight(kind), await settled(kind)];

  const wanted = eligible
    .filter((id) => !stored.has(id) && !busy.has(id) && !done.has(id))
    // Deterministic, so a capped run does not re-pick the same items forever.
    .sort((a, b) => a.localeCompare(b))
    .slice(0, cap);

  return { kind, count: await insert(kind, wanted, wsOf), cap };
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

  /* Comments are stored per post; analysis runs per item. Resolve the join
     rather than passing post ids straight through.

     PAGED, and that is not a detail. This was one unpaginated select, and
     PostgREST caps those at 1000 rows without saying so: against 2,093
     comment rows it returned the first 1000, which covered 12 of the 34
     posts that actually have comments. The other 22 were invisible, so the
     planner reported "nothing to analyse" and the queue quietly starved --
     no error, no warning, just a number that was always 0.

     The rest of this repo reaches for selectAll for exactly this reason. */
  const withComments = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("post_comments")
      .select("platform_post_id, workspace_id")
      .order("id")
      .range(from, from + 999);
    if (error) break;
    withComments.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  const postIds = [...new Set(withComments.map((c) => c.platform_post_id))];
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
  // Same subject as transcript, because it IS transcript work -- the kind
  // differs only in which host may run it.
  transcript_asr: "content_item",
  analyse: "content_item",
  describe: "content_item",
  // The exception, and the reason this table is worth keeping: weeklyRead
  // looks its subject up in `clients`, not `content_items`.
  weekly_read: "client",
  // A third subject table. competitorScan looks its subject up in
  // `competitors`, so anything validating a job's subject against
  // content_items would reject every one of these as orphaned.
  competitor_scan: "competitor",
};

/**
 * The weekly client read -- the one AI job with a handler and no way in.
 *
 * worker/jobs/weeklyRead.mjs has existed and been registered in `handlers`
 * this whole time, but nothing ever queued it: 0 jobs, 0 analyses, ever. A
 * handler with no planner is dead code that looks like a feature.
 *
 * SUBJECT IS A CLIENT, not a content item -- the one planner here where that
 * is true, and the file's own warning about subject types applies double.
 *
 * RECURRENCE IS THE DIFFERENCE. Every other planner asks "has this subject
 * been done?" and never returns. A weekly read is meant to come back, so it
 * asks "has this client been read RECENTLY?" -- and deliberately does not use
 * settled(), which would retire a client permanently the first time one came
 * back unavailable.
 */
const WEEKLY_READ_DAYS = 7;

async function planWeeklyRead() {
  const kind = "weekly_read";
  const cap = CAP(kind, 5);
  if (!process.env.LLM_API_KEY) return { kind, count: 0, cap, skipped: "LLM_API_KEY not set" };

  // Live clients only. The handler refuses archived ones anyway, but queuing
  // them just to be refused burns a job and muddies the failure metrics.
  const { data: clients } = await db
    .from("clients")
    .select("id, workspace_id")
    .is("deleted_at", null)
    .eq("is_archived", false);
  if (!clients?.length) return { kind, count: 0, cap };

  // A client with no content has nothing to narrate; the handler says so, but
  // again, better not to ask.
  const withWork = new Set();
  for (const c of clients) {
    const { count } = await db
      .from("content_items")
      .select("id", { count: "exact", head: true })
      .eq("client_id", c.id);
    if ((count ?? 0) > 0) withWork.add(c.id);
  }

  /* A DATA GATE, NOT A CLOCK.
   *
   * This was a pure seven-day cutoff with no check on whether anything had
   * changed, so a client gaining about one scored video a week was re-tested
   * 52 times a year on nearly the same 29 videos.
   *
   * That is a correctness problem, not a cost one. BH controls the
   * false-discovery rate WITHIN a run and says nothing about looking 52 times.
   * Measured under a pure null with BH applied per report exactly as designed,
   * P(a given client is shown at least one false finding) is 0.105 after one
   * run, 0.293 after 13, and 0.471 after 52 -- carrying one in a mean of 6.7
   * separate weeks. Across 13 clients over a year: 0.9998.
   *
   * A re-test on data that has not moved cannot learn anything; it can only
   * roll the dice again. So: 20% growth in scored posts, or 90 days. About 6
   * runs a year instead of 52.
   *
   * The time cutoff is KEPT as well, as a floor -- MAX_DAYS_BETWEEN_RUNS in
   * findings.ts -- so a client that goes quiet is not frozen forever.
   */
  const { isDue } = await import("../src/lib/analysis/findings.ts");

  const { data: runState } = await db
    .from("client_analysis_state")
    .select("client_id, scored_posts_at_run, last_run_at");
  const stateBy = new Map(
    (runState ?? []).map((r) => [r.client_id, {
      clientId: r.client_id,
      scoredPostsAtRun: r.scored_posts_at_run,
      lastRunAt: r.last_run_at,
    }]),
  );

  /* How much evidence each client has NOW. Approved items on a live client is
     the same population the engine scores, so growth here is growth in what
     could actually change an answer. */
  const scoredNow = new Map();
  for (const c of clients) {
    const { count } = await db
      .from("content_items")
      .select("id", { count: "exact", head: true })
      .eq("client_id", c.id)
      .eq("review_state", "approved");
    scoredNow.set(c.id, count ?? 0);
  }

  const busy = await inFlight(kind);
  const held = [];
  const subjects = new Map();
  for (const c of clients) {
    if (!withWork.has(c.id) || busy.has(c.id)) continue;
    const decision = isDue(stateBy.get(c.id) ?? null, scoredNow.get(c.id) ?? 0);
    if (decision.due) subjects.set(c.id, c.workspace_id);
    else held.push(`${c.id}: ${decision.reason}`);
  }
  if (held.length) log("weekly_read_held", { count: held.length, sample: held.slice(0, 2) });

  const wanted = [...subjects.keys()].slice(0, cap);
  return { kind, count: await insert(kind, wanted, subjects), cap };
}

/* ---- describe ------------------------------------------------------------
   One Tier 2 descriptor per TRANSCRIBED video. Downstream of the coverage
   lanes by construction: a video with no transcript has nothing to describe,
   and the handler settles those as unavailable -- so the planner only queues
   items that already have words, and coverage growth feeds this lane
   automatically on the next pass. */
async function planDescribe() {
  const kind = "describe";
  const cap = CAP(kind, 25);
  if (!process.env.LLM_API_KEY) return { kind, count: 0, cap, skipped: "LLM_API_KEY not set" };

  const withWords = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("video_transcripts")
      .select("content_item_id, workspace_id")
      .order("content_item_id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    withWords.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }

  // Scope: approved items on live clients, same rule as everywhere else.
  const items = new Map();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("content_items")
      .select("id, review_state, client:clients(is_archived)")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const i of data ?? []) items.set(i.id, i);
    if ((data ?? []).length < 1000) break;
  }
  const one = (v) => (Array.isArray(v) ? v[0] : v);

  const { data: have } = await db.from("video_descriptors").select("content_item_id");
  const described = new Set((have ?? []).map((r) => r.content_item_id));
  const [busy, done] = [await inFlight(kind), await settled(kind)];

  const subjects = new Map();
  for (const t of withWords) {
    const item = items.get(t.content_item_id);
    if (!item || item.review_state !== "approved" || one(item.client)?.is_archived) continue;
    if (described.has(t.content_item_id)) continue;
    if (busy.has(t.content_item_id) || done.has(t.content_item_id)) continue;
    subjects.set(t.content_item_id, t.workspace_id);
  }

  const wanted = [...subjects.keys()].sort().slice(0, cap);
  return { kind, count: await insert(kind, wanted, subjects), cap };
}

/**
 * One scan per live competitor, at most one in flight per rival.
 *
 * Re-sampling a rival more often than they post buys nothing -- the sample is
 * the same list with the same view counts -- so a competitor scanned inside
 * the cooldown is skipped rather than queued. COMPETITOR_COOLDOWN_HOURS makes
 * that a decision rather than a constant buried here.
 */
async function planCompetitorScan() {
  const cooldownHours = Number(process.env.COMPETITOR_COOLDOWN_HOURS ?? 24);
  const cutoff = new Date(Date.now() - cooldownHours * 3600_000).toISOString();

  // Paged for the same reason every read here is: an unbounded select stops
  // at 1000 rows in silence, and a planner that cannot see a job it already
  // created duplicates work.
  const competitors = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("competitors")
      .select("id, workspace_id, handle, platform_slug, last_scanned_at")
      .eq("is_archived", false).order("id").range(from, from + 999);
    if (error) throw new Error(`competitors: ${error.message}`);
    if (!data?.length) break;
    competitors.push(...data);
    if (data.length < 1000) break;
  }
  if (!competitors.length) return { kind: "competitor_scan", count: 0, considered: 0 };

  // Same two guards every other planner uses: never duplicate work already
  // queued, and never re-queue something that settled terminally.
  const queued = await inFlight("competitor_scan");
  const done = await settled("competitor_scan");

  /* Re-sampling a rival more often than they post buys nothing -- the same
     list with the same view counts -- so a competitor scanned inside the
     cooldown is skipped. Named via env rather than buried as a literal. */
  const due = competitors.filter((c) =>
    !queued.has(c.id) && !done.has(c.id)
    && (!c.last_scanned_at || c.last_scanned_at < cutoff));

  const workspaceBySubject = new Map(competitors.map((c) => [c.id, c.workspace_id]));
  const count = await insert("competitor_scan", due.map((c) => c.id), workspaceBySubject);
  return { kind: "competitor_scan", count, considered: competitors.length };
}

const PLANNERS = {
  comments: planComments,
  transcript: planTranscript,
  transcript_asr: planTranscriptAsr,
  analyse: planAnalyse,
  weekly_read: planWeeklyRead,
  describe: planDescribe,
  competitor_scan: planCompetitorScan,
};

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
