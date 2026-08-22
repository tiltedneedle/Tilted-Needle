/**
 * Buy one video's Tier 2 descriptor: format, hook style, promise, emotional
 * arc. One call on the cheap model, cached by digest, ~$0.0001 per video.
 *
 * Same three guards as every model job here, in the same order, and a job
 * that stops at any of them is a success:
 *   1. Is there a transcript? (nothing to describe, no call)
 *   2. Have we already paid for exactly these inputs? (digest hit, no call)
 *   3. Is there budget left this month? (ceiling reached, the KIND cools down)
 *
 * The descriptor lands in video_descriptors, which is deliberately not part of
 * video_features: a Tier 1 recompute is free and frequent, and it must never
 * be able to discard paid work.
 */
import {
  configFromEnv, callModel, digestOf, LlmError, llmMonthlyTokenLimit,
} from "../../src/lib/llm.ts";
import {
  DESCRIPTOR_SCHEMA, DESCRIPTOR_SYSTEM_PROMPT, DESCRIPTOR_PROMPT_VERSION,
  descriptorInput, renderHookDescriptorText,
} from "../../src/lib/analysis/descriptors.ts";

const CHEAP_MODEL = process.env.DESCRIBE_MODEL || "gpt-4o-mini";

async function monthTokens(db, workspaceId) {
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);
  const { data } = await db
    .from("ai_analyses")
    .select("input_tokens, output_tokens")
    .eq("workspace_id", workspaceId)
    .gte("created_at", since.toISOString());
  return (data ?? []).reduce((s, r) => s + (r.input_tokens ?? 0) + (r.output_tokens ?? 0), 0);
}

export async function describe({ db, job, log }) {
  const { data: transcript } = await db
    .from("video_transcripts")
    .select("full_text, segments")
    .eq("content_item_id", job.subject_id)
    .maybeSingle();
  if (!transcript?.full_text?.trim()) {
    // Not an error and not retryable: the coverage lanes own getting
    // transcripts, and this job exists only downstream of them.
    return { unavailable: true, note: "no transcript to describe" };
  }

  const { data: item } = await db
    .from("content_items")
    .select("title")
    .eq("id", job.subject_id)
    .maybeSingle();

  const cfg = configFromEnv();
  const user = descriptorInput(item?.title ?? null, transcript.segments ?? []);
  const digest = digestOf({
    user, promptVersion: DESCRIPTOR_PROMPT_VERSION, model: CHEAP_MODEL,
  });

  // Paid for already? The unique constraint is (content_item_id,
  // prompt_version, input_digest), so a changed transcript re-buys and an
  // unchanged one never does.
  const { data: existing } = await db
    .from("video_descriptors")
    .select("content_item_id")
    .eq("content_item_id", job.subject_id)
    .eq("prompt_version", DESCRIPTOR_PROMPT_VERSION)
    .eq("input_digest", digest)
    .maybeSingle();
  if (existing) {
    return { stats: { cached: true } };
  }

  const limit = llmMonthlyTokenLimit();
  const spent = await monthTokens(db, job.workspace_id);
  if (spent >= limit) {
    /* The ceiling is a fact about the MONTH, not the video. Cooling the kind
       stops the queue burning attempts against a budget that will not move
       until the calendar does. */
    const e = new Error(`monthly token budget reached (${spent}/${limit})`);
    e.blocked = true;
    throw e;
  }

  let result;
  try {
    result = await callModel({
      cfg,
      model: CHEAP_MODEL,
      system: DESCRIPTOR_SYSTEM_PROMPT,
      user,
      schema: DESCRIPTOR_SCHEMA,
      maxTokens: 400,
      temperature: 0,
    });
  } catch (err) {
    if (err instanceof LlmError && err.kind === "transport") {
      // Transport is never a fact about the video.
      throw new Error(`model unreachable: ${err.message}`);
    }
    throw err;
  }

  const d = result.data;

  /* The features row supplies the computed half of the descriptor text. Fetch
     may legitimately miss (features are recomputed on their own cadence); the
     render function treats nulls as unknown rather than guessing. */
  const { data: features } = await db
    .from("video_features")
    .select("hook_has_question, hook_word_count, words_per_second")
    .eq("content_item_id", job.subject_id)
    .maybeSingle();

  const hookText = renderHookDescriptorText(d.hook, {
    hookHasQuestion: features?.hook_has_question ?? null,
    hookWordCount: features?.hook_word_count ?? null,
    wordsPerSecond: features?.words_per_second == null ? null : Number(features.words_per_second),
  });

  const { error: upErr } = await db.from("video_descriptors").upsert({
    content_item_id: job.subject_id,
    workspace_id: job.workspace_id,
    prompt_version: DESCRIPTOR_PROMPT_VERSION,
    model: CHEAP_MODEL,
    input_digest: digest,
    format: d.format,
    hook_descriptor: d.hook,
    hook_descriptor_text: hookText,
    promise_stated: d.promise.stated,
    promise_paid_off_ms: d.promise.paidOffMs,
    emotional_arc: d.arc,
    claim_type: d.claimType,
    topic: d.topic,
    entities: d.entities,
  }, { onConflict: "content_item_id" });
  if (upErr) throw new Error(`descriptor upsert failed: ${upErr.message}`);

  /* Usage is recorded in ai_analyses so ONE ledger covers every model call --
     the budget check above reads that ledger, and a kind that kept its own
     books would be invisible to it. */
  await db.from("ai_analyses").insert({
    workspace_id: job.workspace_id,
    subject_type: "content_item",
    subject_id: job.subject_id,
    kind: "descriptor",
    prompt_version: DESCRIPTOR_PROMPT_VERSION,
    model: CHEAP_MODEL,
    input_digest: digest,
    output: { format: d.format, hook: d.hook, claimType: d.claimType },
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
  });

  log("info", "descriptor_stored", {
    item: job.subject_id, format: d.format, move: d.hook.openingMove,
    tokens: result.inputTokens + result.outputTokens,
  });
  return {
    stats: {
      format: d.format, move: d.hook.openingMove,
      tokens: result.inputTokens + result.outputTokens,
    },
  };
}
