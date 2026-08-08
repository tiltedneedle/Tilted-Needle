/**
 * Run an AI analysis over material already in the database.
 *
 * Nothing here reaches the network for DATA -- comments were fetched by their
 * own job and stored. This handler only turns stored facts into prose, which
 * is why it is cheap to re-run and safe to run while every fragile fetcher is
 * in cooldown.
 *
 * Three guards run before a single token is spent, in this order:
 *   1. Is there anything to analyse? (no comments, no call)
 *   2. Have we already paid for exactly these inputs? (digest hit, no call)
 *   3. Is there budget left this month? (ceiling reached, no call)
 * A job that stops at any of them is a success, not a failure.
 */
import {
  configFromEnv, callModel, digestOf, budgetState, assertWithinBudget, LlmError,
} from "../../src/lib/llm.ts";
import {
  buildEvidence, tallyThemes, summaryLine, SYSTEM_PROMPT, COMMENT_THEMES_SCHEMA,
} from "../../src/lib/analysis/commentThemes.ts";

const PROMPT_VERSION = 1;
const KIND = "comment_themes";

/** Tokens spent this calendar month, summed from what we actually stored. */
async function monthTokens(db, workspaceId) {
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);
  const { data } = await db
    .from("ai_analyses")
    .select("input_tokens, output_tokens")
    .eq("workspace_id", workspaceId)
    .gte("created_at", since.toISOString());
  return (data ?? []).reduce(
    (sum, r) => sum + (r.input_tokens ?? 0) + (r.output_tokens ?? 0),
    0,
  );
}

export async function analyse({ db, job, log }) {
  // The subject is a content item; comments hang off its platform posts.
  const { data: posts } = await db
    .from("platform_posts")
    .select("id")
    .eq("content_item_id", job.subject_id);
  const postIds = (posts ?? []).map((p) => p.id);
  if (postIds.length === 0) {
    return { unavailable: true, note: "no platform posts on this content item" };
  }

  const { data: rows } = await db
    .from("post_comments")
    .select("id, text, like_count")
    .in("platform_post_id", postIds);

  const comments = (rows ?? []).map((r) => ({
    id: r.id, text: r.text, likeCount: r.like_count,
  }));
  if (comments.length === 0) {
    // Nothing to say, and nothing to charge for. Terminal and normal.
    return { unavailable: true, note: "no comments stored for this content item" };
  }

  // Config is required only once there is genuinely something to analyse.
  // Checking it earlier would fail every no-op job for want of a key it was
  // never going to use, and the queue could not drain those cases at all
  // until credentials existed.
  const cfg = configFromEnv();

  const { prompt, idMap } = buildEvidence(comments);

  // Digest over what actually shapes the answer. Note it is the EVIDENCE that
  // is hashed, not the raw rows: a like count changing on one comment should
  // not re-buy the analysis, but a new comment arriving should.
  const digest = digestOf({ prompt, promptVersion: PROMPT_VERSION, model: cfg.model });

  const { data: cached } = await db
    .from("ai_analyses")
    .select("id")
    .eq("subject_type", "content_item")
    .eq("subject_id", job.subject_id)
    .eq("kind", KIND)
    .eq("prompt_version", PROMPT_VERSION)
    .eq("input_digest", digest)
    .maybeSingle();
  if (cached) {
    return { stats: { cached: true, comments: comments.length } };
  }

  const limit = Number(process.env.LLM_MONTHLY_TOKEN_LIMIT ?? 0);
  if (limit > 0) {
    const used = await monthTokens(db, job.workspace_id);
    const state = budgetState(used, limit);
    if (state.exhausted) {
      // Not a failure of this job: the ceiling is doing its job. Throwing
      // .blocked parks the whole kind so the queue stops trying rather than
      // burning every job's attempts against a wall.
      const e = new LlmError(
        `monthly token ceiling reached (${used}/${limit})`, "budget",
      );
      e.blocked = true;
      throw e;
    }
    if (state.warn) log("warn", "budget_warning", { used, limit });
  }

  const result = await callModel({
    cfg,
    system: SYSTEM_PROMPT,
    user: prompt,
    schema: COMMENT_THEMES_SCHEMA,
    maxTokens: 1200,
  });

  // The model grouped; the system counts.
  const analysis = tallyThemes(result.data, idMap);
  for (const p of analysis.problems) log("warn", "analysis_discrepancy", { problem: p });

  const { error: insErr } = await db.from("ai_analyses").insert({
    workspace_id: job.workspace_id,
    subject_type: "content_item",
    subject_id: job.subject_id,
    kind: KIND,
    prompt_version: PROMPT_VERSION,
    model: result.model,
    input_digest: digest,
    output: analysis,
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
  });
  if (insErr) throw new Error(`storing analysis failed: ${insErr.message}`);

  // Fill the column that has existed since the first content migration and
  // has never once been written to.
  const line = summaryLine(analysis);
  await db.from("platform_posts").update({ comment_sentiment: line }).in("id", postIds);

  return {
    stats: {
      comments: comments.length,
      themes: analysis.themes.length,
      unthemed: analysis.unthemedCount,
      sentiment: analysis.overallSentiment,
      retried: result.retried,
      tokens: result.inputTokens + result.outputTokens,
    },
  };
}
