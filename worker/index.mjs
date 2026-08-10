/**
 * The Tilted Needle ingest worker.
 *
 * Runs on an Oracle Always Free instance and does everything the app cannot:
 * work that is slow, blockable, or needs a real scheduler.
 *
 * It exposes NO HTTP endpoint. It polls `ingest_jobs`, does the work, writes
 * results back, and publishes a heartbeat. That is the whole contract, and it
 * is what removes the inbound surface entirely: no port, no certificate, no
 * auth layer to get wrong. "Re-fetch this" is an INSERT performed by the app.
 *
 * Run:  node worker/index.mjs            (loop forever, the deployed mode)
 *       node worker/index.mjs --once     (drain what is ready, then exit)
 */
import { createClient } from "@supabase/supabase-js";
import { hostname } from "node:os";
import { handlers } from "./jobs/index.mjs";

const ONCE = process.argv.includes("--once");

/**
 * Restrict this worker to certain job kinds: --kinds=comments,analyse
 *
 * The split is by IP reputation, not tidiness. Comments, enrichment, analysis
 * and weekly reads run against official APIs and the LLM, and do not care what
 * address they come from. Transcripts route through yt-dlp and are refused
 * outright from datacenter ranges. A scheduled runner on shared cloud
 * infrastructure can therefore do the safe work unattended while the fragile
 * work waits for a host with an IP worth using.
 *
 * The filter is applied IN THE CLAIM (see claim_ingest_jobs). Filtering after
 * claiming would be worse than useless: the row is already leased and its
 * attempt already spent, so the queue would drain itself into permanent
 * failure while looking busy.
 */
const KINDS = (() => {
  const arg = process.argv.find((a) => a.startsWith("--kinds="));
  if (!arg) return null;
  const list = arg.slice("--kinds=".length).split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : null;
})();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required. " +
      "On the instance they come from the systemd EnvironmentFile.",
  );
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/**
 * Stable per HOST, not per process.
 *
 * This was `worker-${process.pid}` and it was wrong in a way only visible on
 * the health panel: every restart minted a new identity and left the old row
 * behind forever, struck through as "silent". With systemd's Restart=always
 * that is one dead ghost per crash, accumulating until the panel is unreadable
 * and a genuinely dead worker is impossible to spot among the corpses.
 *
 * One row per host means a restart reuses its own row and the timestamp simply
 * refreshes.
 */
const WORKER_ID = process.env.WORKER_ID ?? `worker-${hostname()}`;
const POLL_MS = Number(process.env.POLL_MS ?? 30_000);
const BATCH = Number(process.env.BATCH ?? 5);
const LEASE_TIMEOUT = process.env.LEASE_TIMEOUT ?? "15 minutes";

/** Structured, one JSON object per line: greppable in journald. */
function log(level, event, detail = {}) {
  process.stdout.write(
    JSON.stringify({ ts: new Date().toISOString(), level, event, worker: WORKER_ID, ...detail }) + "\n",
  );
}

/* ---- Backoff -------------------------------------------------------------
   Exponential with jitter. The jitter is not decoration: several jobs failing
   at the same instant (a provider outage, a block) would otherwise all retry
   at the same instant, which is the pattern that looks least like a human and
   most like a scraper. */
function backoffFor(attempts) {
  const base = Math.min(60 * 2 ** Math.max(0, attempts - 1), 6 * 60); // minutes, capped at 6h
  const jitter = base * (0.5 + Math.random());
  return new Date(Date.now() + jitter * 60_000).toISOString();
}

/* ---- Block detection -----------------------------------------------------
   The fragile fetchers can get the whole IP blocked. When that happens the
   correct response is to stop asking for a while -- not to burn through the
   queue turning every job into a failure, which both wastes the attempts and
   makes the block worse. Everything that does NOT touch the blockable
   endpoints keeps running throughout. */
const cooldowns = new Map(); // job kind -> epoch ms until which it is paused

function isCoolingDown(kind) {
  const until = cooldowns.get(kind);
  return until != null && until > Date.now();
}

function startCooldown(kind, minutes) {
  const until = Date.now() + minutes * 60_000;
  cooldowns.set(kind, until);
  log("warn", "cooldown_started", { kind, minutes, until: new Date(until).toISOString() });
}

async function runJob(job) {
  const handler = handlers[job.kind];
  if (!handler) {
    await finish(job, "failed", `no handler registered for kind '${job.kind}'`);
    return;
  }
  if (isCoolingDown(job.kind)) {
    // Put it straight back without spending an attempt on a request we already
    // know will fail.
    await db.from("ingest_jobs").update({
      status: "pending",
      attempts: Math.max(0, job.attempts - 1),
      not_before: new Date(cooldowns.get(job.kind)).toISOString(),
      leased_at: null, leased_by: null,
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    return;
  }

  const started = Date.now();
  try {
    const result = await handler({ db, job, log });
    // A handler may report that the subject genuinely has nothing to fetch --
    // captions disabled, no replay data published. That is a terminal, normal
    // outcome, NOT a failure to retry forever.
    await finish(job, result?.unavailable ? "unavailable" : "done", result?.note ?? null);
    log("info", "job_done", {
      kind: job.kind, id: job.id, ms: Date.now() - started,
      ...(result?.stats ?? {}),
      ...(result?.unavailable ? { unavailable: true } : {}),
    });
  } catch (err) {
    const msg = String(err?.message ?? err).slice(0, 500);
    if (err?.blocked) {
      startCooldown(job.kind, Number(process.env.COOLDOWN_MINUTES ?? 120));
      await db.from("ingest_jobs").update({
        status: "pending",
        attempts: Math.max(0, job.attempts - 1),
        not_before: new Date(cooldowns.get(job.kind)).toISOString(),
        last_error: `blocked: ${msg}`,
        leased_at: null, leased_by: null,
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
      return;
    }

    const giveUp = job.attempts >= Number(process.env.MAX_ATTEMPTS ?? 4);
    if (giveUp) {
      await finish(job, "failed", msg);
      log("error", "job_failed_permanently", { kind: job.kind, id: job.id, error: msg });
    } else {
      await db.from("ingest_jobs").update({
        status: "pending",
        not_before: backoffFor(job.attempts),
        last_error: msg,
        leased_at: null, leased_by: null,
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
      log("warn", "job_retrying", { kind: job.kind, id: job.id, attempt: job.attempts, error: msg });
    }
  }
}

async function finish(job, status, note) {
  await db.from("ingest_jobs").update({
    status, last_error: note, leased_at: null, leased_by: null,
    updated_at: new Date().toISOString(),
  }).eq("id", job.id);
}

/**
 * Drop heartbeats nobody will ever look at again. A worker silent for a week
 * is not a worker, and leaving the row makes real outages harder to see.
 */
async function pruneDeadWorkers() {
  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { error } = await db.from("worker_heartbeat").delete().lt("last_seen_at", cutoff);
  if (error) log("warn", "prune_failed", { error: error.message });
}

async function heartbeat() {
  const { count: pending } = await db
    .from("ingest_jobs").select("id", { count: "exact", head: true }).eq("status", "pending");
  const { count: running } = await db
    .from("ingest_jobs").select("id", { count: "exact", head: true }).eq("status", "running");
  const { count: failed } = await db
    .from("ingest_jobs").select("id", { count: "exact", head: true }).eq("status", "failed");

  await db.from("worker_heartbeat").upsert({
    worker_id: WORKER_ID,
    last_seen_at: new Date().toISOString(),
    detail: {
      pending: pending ?? 0,
      running: running ?? 0,
      failed: failed ?? 0,
      cooldowns: Object.fromEntries(
        [...cooldowns.entries()]
          .filter(([, until]) => until > Date.now())
          .map(([k, until]) => [k, new Date(until).toISOString()]),
      ),
      handlers: Object.keys(handlers),
    },
  });
  return { pending: pending ?? 0, running: running ?? 0, failed: failed ?? 0 };
}

async function pass() {
  // A worker that died mid-job leaves its lease behind; recovering it here
  // means a killed process costs one lease timeout, not a stuck queue.
  const { data: reclaimed } = await db.rpc("reclaim_expired_leases", {
    p_older_than: LEASE_TIMEOUT,
  });
  if (reclaimed > 0) log("warn", "leases_reclaimed", { count: reclaimed });

  // p_kinds is the whole point of --kinds and was missing for three commits:
  // the flag was parsed, logged, and then dropped on the floor. The RPC
  // defaults p_kinds to NULL = "any kind", so it FAILED OPEN -- the scheduled
  // GitHub runner claimed transcript jobs it cannot do, failed them from a
  // datacenter IP, and settled them as terminally unavailable with a note
  // claiming the video had no captions. Silent, automatic, and unrecoverable
  // without manual SQL.
  const { data: jobs, error } = await db.rpc("claim_ingest_jobs", {
    p_worker: WORKER_ID,
    p_limit: BATCH,
    p_kinds: KINDS,
  });
  if (error) {
    log("error", "claim_failed", { error: error.message });
    return 0;
  }

  for (const job of jobs ?? []) await runJob(job);
  return (jobs ?? []).length;
}

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    if (stopping) process.exit(1);
    stopping = true;
    log("info", "shutdown_requested", { signal: sig });
  });
}

log("info", "worker_started", { once: ONCE, pollMs: POLL_MS, batch: BATCH, kinds: KINDS ?? "all", handlers: Object.keys(handlers) });
await pruneDeadWorkers();

if (ONCE) {
  let total = 0, n;
  do { n = await pass(); total += n; } while (n > 0);
  const hb = await heartbeat();
  log("info", "drain_complete", { processed: total, ...hb });
  process.exit(0);
}

// The deployed mode: a continuous loop rather than a cron that fires and
// exits. Oracle stops Always Free instances judged idle over a 7-day window,
// and a process that sleeps 23 hours a day looks exactly like one. The
// heartbeat this loop publishes is also the liveness signal /data reads.
while (!stopping) {
  try {
    await pass();
    await heartbeat();
  } catch (err) {
    log("error", "pass_threw", { error: String(err?.message ?? err) });
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}

log("info", "worker_stopped");
process.exit(0);
