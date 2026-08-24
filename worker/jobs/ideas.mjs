/**
 * Generate content ideas for one client.
 *
 * Subject is a CLIENT. Everything of substance lives in
 * src/lib/analysis/ideas.ts, shared with the CLI, so the button and the shell
 * cannot end up spending money by different rules.
 *
 * WHY THE OUTCOMES MAP THE WAY THEY DO. The worker's contract distinguishes
 * "this failed and should be retried" from "this is settled and normal", and
 * three of the four non-success outcomes here are the second kind:
 *
 *   cached            identical evidence was already generated. Nothing to do
 *                     and nothing wrong -- retrying would re-check the same
 *                     digest forever.
 *   nothing_to_ground the client has no findings and no scored videos. A real
 *                     answer about a real state, and it will not change
 *                     because a worker tried again in an hour.
 *   none_survived     the model answered and every idea failed the citation
 *                     validator. The spend is ledgered; the job is done. A
 *                     retry would buy the same refusal twice.
 *
 * budget_exhausted is the exception and is thrown as BLOCKED, not failed: the
 * monthly ceiling is a wall the calendar removes, so the whole kind should
 * cool down rather than each job burning its four attempts against it.
 */
import { generateIdeasForClient } from "../../src/lib/analysis/ideas.ts";

export async function ideas({ db, job, log }) {
  const payload = job.payload ?? {};
  const result = await generateIdeasForClient(db, {
    clientId: job.subject_id,
    count: payload.count,
    pool: payload.pool,
    force: payload.force === true,
  });

  if (result.status === "budget_exhausted") {
    const err = new Error(`monthly token ceiling reached: ${result.note}`);
    // The signal the worker already understands: pause the kind, leave the
    // job pending, spend no attempt.
    err.blocked = true;
    throw err;
  }

  if (result.status !== "stored") {
    log("info", "ideas_not_stored", {
      client: job.subject_id, status: result.status, note: result.note,
    });
    return { unavailable: true, note: `${result.status}: ${result.note ?? ""}`.trim() };
  }

  log("info", "ideas_stored", {
    client: job.subject_id, kept: result.kept, proposed: result.proposed,
    pool: result.poolSize, dropped: result.dropped,
  });
  return {
    stats: {
      kept: result.kept, proposed: result.proposed,
      pool: result.poolSize, candidates: result.candidates,
    },
  };
}
