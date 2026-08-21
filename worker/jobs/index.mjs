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
import { transcript } from "./transcript.mjs";
import { analyse } from "./analyse.mjs";
import { visionExtract } from "./visionExtract.mjs";
import { weeklyRead } from "./weeklyRead.mjs";

export const handlers = {
  comments,
  transcript,
  /* THE SAME FUNCTION, DELIBERATELY. transcript() already routes an item whose
     platforms publish no caption track to the audio lane, so this kind adds a
     routing rule and no second implementation.

     It exists because kinds here are split by IP REPUTATION: measured from the
     Oracle box, Instagram hands it an audio stream while YouTube refuses the
     same address outright. One shared kind would mean either enabling captions
     on a host that cannot fetch them -- where the first bot challenge cools the
     whole kind for two hours and stalls 146 Instagram items -- or leaving the
     audio lane switched off on the only machine that runs unattended. */
  transcript_asr: transcript,
  analyse,
  vision_extract: visionExtract,
  weekly_read: weeklyRead,
};
