/**
 * Handler registry.
 *
 * A job kind with no handler here fails loudly rather than sitting in the
 * queue forever looking like it might still run. Kinds are constrained by the
 * database too (ingest_jobs_kind_valid), so the two cannot drift far.
 *
 * Handlers return:
 *   { stats }                  -> done
 *   { unavailable: true, note} -> terminal, and NORMAL: the subject genuinely
 *                                 has nothing to fetch (captions off, no
 *                                 replay data published). Never retried.
 * and throw:
 *   Error                      -> retried with jittered backoff
 *   Error with .blocked = true -> the whole kind goes into cooldown, so one
 *                                 block does not burn every job's attempts
 */
import { comments } from "./comments.mjs";

export const handlers = {
  comments,
};
