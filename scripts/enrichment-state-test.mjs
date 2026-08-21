// Every video is accounted for: it has the data, a verdict, or work in flight.
//   npm run test:enrichment
//
// THE INVARIANT
//
//     transcript exists  OR  enrichment_state row  OR  in-flight job
//
// A video matching none of those has fallen through the cracks: nobody is
// fetching it and nobody has decided it cannot be fetched. It will sit
// missing forever while looking exactly like a video that was checked.
//
// WHY THIS TEST IS THE POINT OF THE TABLE
//
// Before enrichment_state, "no transcript" and "not fetched yet" were the
// same observable state, and four different answers collapsed into
// ingest_jobs.status='unavailable' with a last_error that every retry
// overwrote. 146 videos were condemned by that conflation -- 72 YouTube
// Shorts filtered out by a platform map with no `youtube_shorts` key, and 74
// TikTok posts written off because the extraction box was unreachable.
//
// The rule that prevents a repeat is that ONLY a handler which reached the
// platform and got an answer may write a verdict. Every transport failure
// throws instead. So this test also checks the corollary: no verdict may
// exist whose note describes a transport failure rather than the video.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync("./.env.local", "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(),
                 l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

/**
 * Paged, because an unbounded select is silently capped at 1000 rows -- and
 * ORDERED, because PostgREST guarantees no row order without it, so
 * successive windows over the same table can skip rows and repeat others.
 * An unordered pager made this test disagree with the enqueuer about the same
 * seven videos, each of them reading a different slice of one table.
 */
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

const items = await all("content_items", "id, review_state, client:clients(is_archived)");
const transcripts = new Set((await all("video_transcripts", "content_item_id")).map((t) => t.content_item_id));
const states = await all("enrichment_state", "subject_id, kind, state, note, method, recheck_after", "subject_id");
const stateFor = new Map(states.filter((s) => s.kind === "transcript").map((s) => [s.subject_id, s]));
const jobs = await all("ingest_jobs", "subject_id, kind, status");
const inFlight = new Set(
  jobs.filter((j) => j.kind === "transcript" && ["pending", "running"].includes(j.status))
      .map((j) => j.subject_id),
);

/* ---- Scope -------------------------------------------------------------- */
/* Not every video is a candidate. Work is only spent on APPROVED videos
   belonging to LIVE clients -- the same rule isLiveAgencyWork applies in the
   enqueuer -- so an unapproved video having no verdict is correct, not a gap.
   Stated explicitly rather than left implicit, because the first version of
   this test flagged 264 videos and 118 of them were deliberate exclusions. */
const one = (v) => (Array.isArray(v) ? v[0] : v);
const inScope = items.filter(
  (i) => i.review_state === "approved" && !one(i.client)?.is_archived,
);
const outOfScope = items.length - inScope.length;

/* ---- The invariant ------------------------------------------------------ */
{
  const orphans = inScope.filter(
    (i) => !transcripts.has(i.id) && !stateFor.has(i.id) && !inFlight.has(i.id),
  );
  check(
    "every in-scope video has a transcript, a verdict, or work in flight",
    orphans.length === 0,
    orphans.length
      ? `${orphans.length} unaccounted for, e.g. ${orphans[0].id}`
      : `${inScope.length} in scope, ${outOfScope} out (unapproved or archived client)`,
  );
}

/* ---- A verdict must describe the VIDEO, never the route ----------------- */
{
  // These phrases describe something that went wrong on our side. A verdict
  // carrying one is the exact bug the table exists to prevent, and it would
  // be terminal.
  const TRANSPORT = [
    "extraction service", "service is unavailable", "rate-limit", "429",
    "did not answer", "unreachable", "timeout", "401",
  ];
  const bad = states.filter((s) =>
    TRANSPORT.some((p) => (s.note ?? "").toLowerCase().includes(p)),
  );
  check(
    "no verdict blames the route rather than the video",
    bad.length === 0,
    bad.length ? `${bad.length}, e.g. "${(bad[0].note ?? "").slice(0, 60)}"` : "",
  );
}

/* ---- A transcript and a "nothing here" verdict cannot both be true ------ */
{
  const contradictory = [...stateFor.entries()].filter(
    ([id, s]) => transcripts.has(id) && s.state !== "ok",
  );
  check(
    "no video is both transcribed and marked as having nothing",
    contradictory.length === 0,
    contradictory.length ? `${contradictory.length}, e.g. ${contradictory[0][0]} is ${contradictory[0][1].state}` : "",
  );
}

/* ---- ok means the data is actually there -------------------------------- */
{
  const lying = [...stateFor.entries()].filter(([id, s]) => s.state === "ok" && !transcripts.has(id));
  check(
    "every ok verdict has a transcript behind it",
    lying.length === 0,
    lying.length ? `${lying.length} claim ok with no transcript` : "",
  );
}

/* ---- Recheckable verdicts are the ones about platforms ------------------ */
{
  const platformRows = states.filter((s) => s.state === "platform_unsupported");
  const withoutDate = platformRows.filter((s) => !s.recheck_after);
  check(
    "platform_unsupported verdicts carry a recheck date",
    withoutDate.length === 0,
    `${platformRows.length} platform verdicts, ${withoutDate.length} without a date`,
  );
}

/* ---- The denominator is reportable -------------------------------------- */
{
  const answered = inScope.filter((i) => transcripts.has(i.id) || stateFor.has(i.id)).length;
  const unknown = inScope.length - answered;
  check(
    "the denominator is knowable",
    answered + unknown === inScope.length,
    `${transcripts.size} transcribed, ${stateFor.size - [...stateFor.values()].filter((s) => s.state === "ok").length} answered-no, ${unknown} still unknown`,
  );
}

/* ---- Nothing invented reached the corpus -------------------------------- */
/* The gate is unit-tested against phrases Whisper is KNOWN to invent. This is
   the other half: every transcript actually stored by the ASR lane is fed back
   through the same gate and must still pass.

   It is worth asserting on the live table rather than only in the unit test,
   because the two ways this fails leave no other trace. A row written before
   the gate existed would sit there indefinitely; and a row written by a future
   path that forgets to gate would look exactly like a good one. Both show up
   here and nowhere else -- a fabricated sentence is fluent, correctly
   punctuated, and indistinguishable from data by eye. */
{
  const { gateAsrResult } = await import("../src/lib/analysis/asrGate.ts");
  const asr = await all("video_transcripts", "content_item_id, full_text, source", "content_item_id");
  const fromAudio = asr.filter((t) => t.source === "asr");
  const suspect = fromAudio.filter((t) => !gateAsrResult(t.full_text).speech);
  check(
    "no stored ASR transcript is a phrase Whisper invents from silence",
    suspect.length === 0,
    suspect.length
      ? `${suspect.length} of ${fromAudio.length}, e.g. "${suspect[0].full_text.slice(0, 60)}"`
      : `${fromAudio.length} transcribed from audio, all pass the gate`,
  );

  // A transcript of a handful of characters is not usable evidence, whatever
  // the gate thinks of it, and would quietly weaken any hypothesis built on it.
  const tiny = fromAudio.filter((t) => (t.full_text ?? "").trim().length < 40);
  check(
    "no ASR transcript is too short to be evidence",
    tiny.length === 0,
    tiny.length ? `${tiny.length} under 40 chars` : "",
  );
}

/* ---- The same invariant, for comments ----------------------------------- */
/* Comments were the other half of the same fault. Freshness was read from the
   newest post_comments row, so a post with ZERO comments left no row, looked
   never-fetched on every run, and was queued again forever: 1,196 jobs over
   196 distinct subjects, one queued 49 times, while 263 of 437 in-scope items
   had never been queued once. "None" is now recorded, so the planner
   terminates and the cap reaches new work. */
{
  const commentState = new Map(
    states.filter((s) => s.kind === "comments").map((s) => [s.subject_id, s]),
  );
  const commentsInFlight = new Set(
    jobs.filter((j) => j.kind === "comments" && ["pending", "running"].includes(j.status))
        .map((j) => j.subject_id),
  );
  const postsOf = new Map();
  for (const p of await all("platform_posts", "id, content_item_id")) {
    if (!postsOf.has(p.content_item_id)) postsOf.set(p.content_item_id, []);
    postsOf.get(p.content_item_id).push(p.id);
  }
  const withComments = new Set(
    (await all("post_comments", "platform_post_id")).map((c) => c.platform_post_id),
  );
  const hasData = (id) => (postsOf.get(id) ?? []).some((pid) => withComments.has(pid));

  /* TikTok has no comment route yet. planComments takes YouTube-like and
     Instagram only; TikTok needs a paid Apify actor, which is a later phase.
     That is UNIMPLEMENTED SCOPE, not a gap in the bookkeeping -- but it is
     named and counted here rather than quietly tolerated, so the day the
     route ships and is not wired in, this fails. */
  const platformsOf = new Map();
  for (const p of await all("platform_posts", "content_item_id, account:accounts(platform_slug)")) {
    const slug = (Array.isArray(p.account) ? p.account[0] : p.account)?.platform_slug;
    if (!platformsOf.has(p.content_item_id)) platformsOf.set(p.content_item_id, new Set());
    if (slug) platformsOf.get(p.content_item_id).add(slug);
  }
  const ROUTED = new Set(["youtube", "youtube_shorts", "instagram"]);
  const hasRoute = (id) => [...(platformsOf.get(id) ?? [])].some((p) => ROUTED.has(p));

  const orphans = inScope.filter(
    (i) => hasRoute(i.id) && !hasData(i.id) && !commentState.has(i.id) && !commentsInFlight.has(i.id),
  );
  const noRoute = inScope.filter((i) => !hasRoute(i.id)).length;
  check(
    "every in-scope video with a comment route has comments, a verdict, or work in flight",
    orphans.length === 0,
    orphans.length
      ? `${orphans.length} unaccounted for`
      : `${inScope.length - noRoute} routable, ${noRoute} on TikTok only (no route until the Apify lane ships)`,
  );

  // The bug in one assertion: an item answered "none" must not still be queued.
  const nowIso = new Date().toISOString();
  const settledButQueued = [...commentState.entries()].filter(
    ([id, st]) => st.state === "none_exist"
      && (!st.recheck_after || st.recheck_after > nowIso)
      && commentsInFlight.has(id),
  );
  check(
    "no item answered none_exist is queued again before its recheck",
    settledButQueued.length === 0,
    settledButQueued.length ? `${settledButQueued.length} requeued despite a live verdict` : "",
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
