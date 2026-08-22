// A backfill must never delay live work, and a metered kind must not burst.
//   npm run test:queue
//
// WHY BOTH GUARANTEES MATTER TOGETHER
//
// Backfilling 564 videos and serving the handful of jobs a fresh sync creates
// are the same queue. Without priority the backlog goes first simply by being
// older, so a video published this morning waits behind two hundred from last
// year. Without pacing the drain runs flat out until a third party refuses it
// -- measured against YouTube: a burst of ~90 claims earned a 429 and two
// hours of nothing, recovering 3 transcripts for 87 spent attempts.
//
// The claim RPC orders by (priority, not_before), so priority is the lever.
// The bands are 10 urgent, 100 default, 500 backfill.
//
// This test writes REAL rows, because the ordering it checks lives in the
// database rather than in JavaScript, and a mock would only prove the mock.
// Everything it inserts is removed in a finally block.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

/* .env.local on the desktop, process.env on CI. This test asserts invariants
   over the LIVE tables, so it needs database credentials from somewhere; with
   neither source present it SKIPS -- loudly, exit 0 -- rather than failing.
   A fork or a credential-less environment should not read "the invariant
   broke" when the truth is "nobody could look".

   CI is DELIBERATELY credential-less for this step, so there it skips. These
   assertions read the live production tables, which the Oracle worker and any
   parallel session write to continuously -- a fixture row inserted by another
   session mid-run already produced one false "invariant broken" here. Live
   invariants belong where an operator can act on them, not gating unrelated
   pushes. */
let fileEnv = {};
try {
  fileEnv = Object.fromEntries(
    readFileSync("./.env.local", "utf8").split("\n").filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(),
                   l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
  );
} catch { /* no .env.local */ }
const env = { ...fileEnv, ...process.env };
/* ONLY THE DATABASE BLOCK IS GATED, not the whole file.
   A first version exited here when credentials were missing -- and 17 of this
   suite's 20 checks need no database at all: the token-bucket arithmetic is
   closures over integers, and the wiring assertions are regexes over
   worker/index.mjs and server.py, both of which a CI checkout has. Those 17
   exist nowhere else in the repo, so on CI they silently stopped running while
   npm test still reported green. A regression reintroducing spend-on-offer, or
   a `subtitleslangs` glob that quadruples the request rate, would have sailed
   through. */
const HAS_DB = Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SECRET_KEY);
const db = HAS_DB
  ? createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY)
  : null;

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

/* A REAL kind, because `ingest_jobs_kind_valid` restricts the column -- which
   is correct, and means a synthetic kind cannot be used to isolate the test.
   `replay` is chosen instead: it is in the allowed set and no handler is
   registered for it, so the worker will never claim these rows even though
   they are otherwise ordinary.
   
   Belt and braces: not_before is set in the FUTURE so nothing is claimable
   regardless, and the ordering assertion queries the table directly with the
   same ORDER BY the claim RPC uses, so claimability is irrelevant to what is
   being proved. */
/** Distinguishes "no credentials, skip this part" from a genuine failure, so
 *  the catch below can stay silent for one and loud for the other. */
class SkipDb extends Error {}

const KIND = "replay";
const created = [];

if (!HAS_DB) {
  console.log("SKIPPED (ordering): no database credentials. The ordering this "
    + "checks lives in the RPC, so a mock would only prove the mock. "
    + "Everything below is offline and still runs.");
}

try {
  if (!HAS_DB) throw new SkipDb();
  const { data: ws } = await db.from("workspaces").select("id").limit(1).maybeSingle();
  const { data: subjects } = await db.from("content_items").select("id").limit(3);
  if (!ws || (subjects ?? []).length < 3) throw new Error("need a workspace and 3 content items");

  const rows = [
    { priority: 500, label: "backfill",    subject_id: subjects[0].id },
    { priority: 100, label: "default",     subject_id: subjects[1].id },
    { priority: 10,  label: "incremental", subject_id: subjects[2].id },
  ];

  /* Inserted WORST-FIRST and with the backfill made OLDEST, so insertion
     order and age both favour the wrong answer. If priority were ignored,
     the backfill would win on not_before -- which is precisely the failure
     being guarded against. */
  const now = Date.now();
  const { data: inserted, error } = await db.from("ingest_jobs").insert(
    rows.map((r, i) => ({
      workspace_id: ws.id,
      kind: KIND,
      subject_id: r.subject_id,
      priority: r.priority,
      status: "pending",
      // Far enough out that no worker can take them, while preserving the
      // RELATIVE ages that would win if priority were ignored.
      not_before: new Date(now + 86_400_000 - (rows.length - i) * 60_000).toISOString(),
    })),
  ).select("id, priority");
  if (error) throw new Error(`insert failed: ${error.message}`);
  created.push(...(inserted ?? []).map((r) => r.id));

  /* ---- The queue's own ordering, not a re-implementation of it ---------- */
  const { data: ordered } = await db
    .from("ingest_jobs")
    .select("priority")
    .eq("kind", KIND)
    .eq("status", "pending")
    .in("id", created)
    .order("priority")
    .order("not_before");

  const seen = (ordered ?? []).map((r) => r.priority);
  check(
    "an incremental job is served before a backfill that is older",
    seen[0] === 10,
    `order was ${seen.join(" then ")}`,
  );
  check(
    "the full order is urgent, default, backfill",
    JSON.stringify(seen) === JSON.stringify([10, 100, 500]),
    seen.join(","),
  );
} catch (err) {
  /* A CAUGHT throw, not an uncaught one. The block previously had a finally
     and no catch, so any failure -- including "need a workspace and 3 content
     items" -- propagated after cleanup and killed the process before the
     offline assertions below ever ran. A database hiccup would silently take
     17 checks with it. */
  if (!(err instanceof SkipDb)) {
    check("the ordering check completed", false, String(err?.message ?? err));
  }
} finally {
  if (created.length) {
    await db.from("ingest_jobs").delete().in("id", created);
    const { count } = await db.from("ingest_jobs")
      .select("id", { count: "exact", head: true }).eq("kind", KIND);
    check("the test cleans up after itself", (count ?? 0) === 0, `${count ?? 0} left behind`);
  }
}

/* ---- The token bucket, tested as arithmetic ----------------------------- */
/* Reimplemented here rather than imported: worker/index.mjs starts polling on
   import, so pulling it in would launch a worker inside the test run. The
   duplication is three lines and the shape is asserted against the real
   file below, so a divergence is caught rather than merely risked. */
{
  const bucket = (perHour, cap) => {
    let tokens = cap, last = 0;
    return (atMs) => {
      tokens = Math.min(cap, tokens + ((atMs - last) / 3_600_000) * perHour);
      last = atMs;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    };
  };

  const take = bucket(30, 5);
  let burst = 0;
  for (let i = 0; i < 20; i++) if (take(0)) burst++;
  check("a burst is capped, not unlimited", burst === 5, `${burst} claims allowed at t=0`);

  const take2 = bucket(30, 5);
  for (let i = 0; i < 5; i++) take2(0);            // spend the burst
  check("an empty bucket refuses", take2(0) === false);
  check("two minutes at 30/hour refills exactly one", take2(120_000) === true);

  const take3 = bucket(30, 5);
  let inAnHour = 0;
  for (let t = 0; t <= 3_600_000; t += 30_000) if (take3(t)) inAnHour++;
  // Burst plus a full hour of refill: 5 + 30, and never unbounded.
  check(
    "an hour of polling yields about the configured rate",
    inAnHour >= 30 && inAnHour <= 36,
    `${inAnHour} claims in one hour at 30/hour with a burst of 5`,
  );
}

/* ---- A token is spent on WORK, not on asking ---------------------------- */
/* The bug this models, which the earlier version of this test could not see
   because it only ever simulated one kind:

   claimableKinds() offers every in-budget kind to the claim RPC, but a metered
   pass claims exactly ONE job. Charging a token per kind OFFERED means two
   metered kinds on a 30-second poll spend 120 tokens an hour each -- and since
   the claim orders by priority, the loser's entire budget is consumed by jobs
   that were never its own. Measured live: the ASR lane stopped at 8 of 146
   while the comments backfill ran, with nothing erroring and nothing cooling
   down. */
{
  const makeBucket = (perHour, cap) => {
    let tokens = cap, last = 0;
    const refill = (atMs) => {
      tokens = Math.min(cap, tokens + ((atMs - last) / 3_600_000) * perHour);
      last = atMs;
    };
    return {
      has: (atMs) => { refill(atMs); return tokens >= 1; },
      spend: (atMs) => { refill(atMs); tokens -= 1; },
    };
  };

  // Two metered kinds, polled every 30s for an hour. The high-priority kind
  // wins every claim; the low-priority one is offered every time and never
  // gets a job.
  const fast = makeBucket(120, 20);      // comments
  const slow = makeBucket(20, 3);        // transcript_asr
  let slowOffers = 0;
  for (let t = 0; t <= 3_600_000; t += 30_000) {
    const offered = [];
    if (fast.has(t)) offered.push("fast");
    if (slow.has(t)) { offered.push("slow"); slowOffers++; }
    if (!offered.length) continue;
    // Exactly one job comes back, and priority means it is always the fast kind.
    fast.spend(t);
  }
  check(
    "a kind offered but never claimed keeps its budget",
    slowOffers > 100,
    `${slowOffers} of 121 polls still had budget after an hour of losing every claim`,
  );

  // The counter-test: the OLD behaviour, charging on offer, starves it.
  const slowOld = makeBucket(20, 3);
  let oldOffers = 0;
  for (let t = 0; t <= 3_600_000; t += 30_000) {
    if (slowOld.has(t)) { slowOld.spend(t); oldOffers++; }   // spend-on-offer
  }
  check(
    "charging on offer would have starved it -- which is what happened",
    oldOffers <= 24,
    `${oldOffers} offers in an hour against 121 polls`,
  );

  // And the pacing guarantee still holds when work IS claimed.
  const paced = makeBucket(20, 3);
  let done = 0;
  for (let t = 0; t <= 3_600_000; t += 30_000) {
    if (paced.has(t)) { paced.spend(t); done++; }
  }
  check("a kind that wins every claim is still paced to its rate",
    done >= 20 && done <= 24, `${done} jobs in an hour at 20/hour with a burst of 3`);
}

/* ---- The worker really is wired this way -------------------------------- */
{
  const src = readFileSync("./worker/index.mjs", "utf8");
  const live = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  check("the worker filters kinds by cooldown AND budget",
    /claimableKinds/.test(live) && /hasToken/.test(live));
  check("offering a kind does not spend its token",
    /hasToken\(k\)/.test(live) && !/takeToken/.test(live),
    "claimableKinds must peek, never charge");
  check("the token is charged against the job actually claimed",
    /spendToken\(job\.kind\)/.test(live));
  check("metered kinds claim one at a time",
    /metered \? 1 : BATCH/.test(live));
  check("transcript is metered", /RATE_TRANSCRIPT_PER_HOUR/.test(live));
  check("the ASR lane is metered too -- it costs money per call",
    /RATE_ASR_PER_HOUR/.test(live));
}

/* ---- The transcript service's request-rate hazards ---------------------- */
/* A config regression here is invisible: every extra request looks identical
   in the log, and the only symptom is being throttled sooner. Asserted rather
   than trusted, on the live lines only so the explanatory comment in the
   service does not satisfy its own check. */
{
  const svc = readFileSync("./deploy/tiktok-discover/server.py", "utf8");
  const live = svc.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  check(
    "subtitleslangs is unset -- a language glob multiplies the request rate",
    !/["']subtitleslangs["']\s*:/.test(live),
  );
  check("the service can route through a proxy", /YTDLP_PROXY/.test(live));
  check("the proxy is applied wherever cookies are", /opts\["proxy"\] = YTDLP_PROXY/.test(live));
  check(
    "a bot challenge is reported as transport, never as a fact about the video",
    /botChallenge/.test(live) && /rateLimited/.test(live),
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
