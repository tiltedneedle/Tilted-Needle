/**
 * Bring terminally failed jobs back, on a widening delay, a bounded number of
 * times.
 *
 *     node worker/requeue.mjs
 *
 * WHY THIS EXISTS
 *
 * attempts/MAX_ATTEMPTS covers a job failing repeatedly inside one run. It has
 * nothing to say about what happens afterwards: the job reaches
 * status='failed' and no code anywhere ever looks at it again. Six analyse
 * jobs sat written off for days, one for missing LLM config that had since
 * been set and four for a schema mismatch that had since been fixed. Their
 * causes were gone; the jobs stayed dead. A queue that cannot recover from a
 * bug you already fixed is a queue that needs a human every time you ship.
 *
 * WHAT IT WILL NOT TOUCH
 *
 * 'unavailable' jobs. That state is an answer, not a failure -- "no post on
 * this item exposes comments", "instagram post has no caption" -- and 172 jobs
 * hold it deliberately. Retrying them would spend quota rediscovering the same
 * nothing, forever.
 *
 * WHY THE ROUNDS ARE BOUNDED
 *
 * The delays widen (1h, 6h, 24h, 72h) because the failures worth retrying are
 * the ones a deploy fixes, and deploys take hours or days -- not seconds. Four
 * rounds spans about four days, which is long enough to cover a fix landing
 * and short enough that a genuinely broken job stops consuming attention. What
 * remains after that is a real signal: something that has failed on four
 * separate occasions across four days is not waiting on a deploy.
 */
import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } },
);

/** Hours to wait before round N is allowed to run. */
const BACKOFF_HOURS = [1, 6, 24, 72];
const MAX_ROUNDS = BACKOFF_HOURS.length;

const { data: failed, error } = await db
  .from("ingest_jobs")
  .select("id, kind, retry_round, updated_at, last_error")
  .eq("status", "failed")
  .lt("retry_round", MAX_ROUNDS);

if (error) {
  console.error("could not read failed jobs:", error.message);
  process.exit(1);
}

const now = Date.now();
const due = [];
const waiting = [];

for (const j of failed ?? []) {
  // Measured from when the job last changed, so a job that failed an hour ago
  // is not requeued instantly just because the requeue happens to run.
  const since = now - Date.parse(j.updated_at ?? 0);
  const waitMs = BACKOFF_HOURS[j.retry_round] * 3600_000;
  (since >= waitMs ? due : waiting).push(j);
}

let requeued = 0;
for (const j of due) {
  const { error: e } = await db
    .from("ingest_jobs")
    .update({
      status: "pending",
      // Cleared so the job is claimable again; retry_round is the memory of
      // how many times we have already come back to it.
      attempts: 0,
      retry_round: j.retry_round + 1,
      not_before: new Date().toISOString(),
      leased_at: null,
      leased_by: null,
    })
    .eq("id", j.id)
    // Only if it is still failed: a concurrent run must not resurrect a job
    // that has since been picked up.
    .eq("status", "failed");
  if (e) console.error(`  requeue ${j.id} failed: ${e.message}`);
  else requeued++;
}

const { count: exhausted } = await db
  .from("ingest_jobs")
  .select("id", { count: "exact", head: true })
  .eq("status", "failed")
  .gte("retry_round", MAX_ROUNDS);

const byKind = {};
for (const j of due) byKind[j.kind] = (byKind[j.kind] ?? 0) + 1;

const line = `requeued ${requeued} failed job(s)` +
  (Object.keys(byKind).length ? ` — ${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(", ")}` : "") +
  ` · ${waiting.length} still backing off · ${exhausted ?? 0} exhausted after ${MAX_ROUNDS} rounds`;

console.log(line);
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import("node:fs");
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + "\n");
}

// Jobs that have burned every round are the ones worth a human's attention --
// their causes are not transient and no further retry will help.
if (exhausted) console.log(`::warning::${exhausted} ingest job(s) have exhausted every retry round`);
