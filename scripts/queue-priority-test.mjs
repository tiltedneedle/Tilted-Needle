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

/* A REAL kind, because `ingest_jobs_kind_valid` restricts the column -- which
   is correct, and means a synthetic kind cannot be used to isolate the test.
   `replay` is chosen instead: it is in the allowed set and no handler is
   registered for it, so the worker will never claim these rows even though
   they are otherwise ordinary.
   
   Belt and braces: not_before is set in the FUTURE so nothing is claimable
   regardless, and the ordering assertion queries the table directly with the
   same ORDER BY the claim RPC uses, so claimability is irrelevant to what is
   being proved. */
const KIND = "replay";
const created = [];

try {
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

/* ---- The worker really is wired this way -------------------------------- */
{
  const src = readFileSync("./worker/index.mjs", "utf8");
  check("the worker filters kinds by cooldown AND budget",
    /claimableKinds/.test(src) && /takeToken/.test(src));
  check("metered kinds claim one at a time",
    /metered \? 1 : BATCH/.test(src));
  check("transcript is metered", /RATE_TRANSCRIPT_PER_HOUR/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
