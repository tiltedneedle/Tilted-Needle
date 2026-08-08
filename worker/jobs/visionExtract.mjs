/**
 * Read a screenshot into a DRAFT (PRD-video-intelligence §2.1 Route B).
 *
 * Writes nothing to post_analytics. Its whole output is an ai_analyses row a
 * human then confirms beside the image, because OCR misreads 1.2k as 12k and
 * confuses reach with impressions -- and unlike a CSV there is no header row
 * to check the mapping against.
 *
 * The image lives in a private bucket; the worker fetches it with the service
 * key. It is deleted on confirmation, not here: deleting it before a human has
 * looked would leave them confirming numbers with nothing to check against.
 */
import { configFromEnv, callModel, digestOf } from "../../src/lib/llm.ts";
import {
  VISION_PROMPT, VISION_SCHEMA, toExtractedValues, ownerOnlyCount,
} from "../../src/lib/analysis/visionExtract.ts";

const PROMPT_VERSION = 1;
const BUCKET = "analytics-screenshots";

export async function visionExtract({ db, job, log }) {
  // The enqueuer parks the object path on the job row; without it there is
  // nothing to read and retrying will not conjure one.
  const path = job.last_error;
  if (!path) return { unavailable: true, note: "no screenshot path on this job" };

  const { data: file, error: dlErr } = await db.storage.from(BUCKET).download(path);
  if (dlErr || !file) {
    return { unavailable: true, note: `screenshot missing from storage (${dlErr?.message ?? "not found"})` };
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "image/png";
  const dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;

  const cfg = configFromEnv();
  const model = cfg.visionModel ?? cfg.model;

  const result = await callModel({
    cfg,
    model,
    system: VISION_PROMPT,
    // The image rides as an OpenAI-compatible content array; providers that
    // speak that shape need no special-casing here.
    user: JSON.stringify([
      { type: "text", text: "Read the analytics figures in this screenshot." },
      { type: "image_url", image_url: { url: dataUrl } },
    ]),
    schema: VISION_SCHEMA,
    maxTokens: 800,
  });

  const values = toExtractedValues(result.data.fields ?? []);
  const worthIt = ownerOnlyCount(values);

  const { error: insErr } = await db.from("ai_analyses").insert({
    workspace_id: job.workspace_id,
    subject_type: "post",
    subject_id: job.subject_id,
    kind: "vision_draft",
    prompt_version: PROMPT_VERSION,
    model: result.model,
    input_digest: digestOf({ path, promptVersion: PROMPT_VERSION }),
    output: {
      platform: result.data.platform ?? "unknown",
      values,
      storagePath: path,
      ownerOnlyCount: worthIt,
      // Stated on the row itself so the confirmation screen cannot forget it.
      requiresConfirmation: true,
    },
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
  });
  if (insErr) throw new Error(`storing draft failed: ${insErr.message}`);

  if (worthIt === 0) {
    log("warn", "vision_no_owner_data", {
      post: job.subject_id,
      note: "screenshot carried only figures the sync already has",
    });
  }

  return {
    stats: {
      fields: values.length,
      ownerOnly: worthIt,
      flagged: values.filter((v) => v.warning).length,
      retried: result.retried,
      tokens: result.inputTokens + result.outputTokens,
    },
  };
}
