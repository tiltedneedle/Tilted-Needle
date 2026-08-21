/**
 * The weekly client read (PRD-video-intelligence §5.5).
 *
 * Subject is a CLIENT. Everything the model sees is computed first by
 * buildClientEvidence -- medians, sample sizes, and the limits of the data --
 * so the model's whole job is turning a table into sentences. It cannot
 * influence a single figure, which is what makes the output checkable.
 *
 * Same guard order as the comment analysis, and for the same reason: the
 * cheap refusals run before anything is spent, and config is required only
 * once there is genuinely something to narrate. A client with too little work
 * resolves cleanly with no key present at all.
 */
import {
  configFromEnv, callModel, digestOf, budgetState, LlmError,
} from "../../src/lib/llm.ts";
import {
  buildClientEvidence, evidenceToPrompt, CLIENT_READ_PROMPT, CLIENT_READ_SCHEMA,
} from "../../src/lib/analysis/clientEvidence.ts";
import { computeRankings } from "../../src/lib/performanceData.ts";

const PROMPT_VERSION = 1;
const KIND = "weekly_read";

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
    (s, r) => s + (r.input_tokens ?? 0) + (r.output_tokens ?? 0), 0,
  );
}

export async function weeklyRead({ db, job, log }) {
  /* An archived client gets no weekly read.
   *
   * Refused at the job level rather than filtered row by row, because this
   * job IS one client: the subject_id is the client id. Letting it run would
   * spend LLM tokens to write present-tense prose about work the business has
   * stopped doing -- and that prose is then stored and shown as current.
   *
   * Not an error. The client existing and being inactive is a normal state,
   * so it completes as unavailable with a reason, which is what the queue's
   * terminal handling expects. */
  const { data: client } = await db
    .from("clients")
    .select("is_archived, name")
    .eq("id", job.subject_id)
    .maybeSingle();
  if (client?.is_archived) {
    return {
      unavailable: true,
      note: `${client.name ?? "this client"} is inactive — no weekly read is written for archived clients`,
    };
  }

  // Videos for this client, with the fields the evidence builder needs.
  const { data: items } = await db
    .from("content_items")
    .select("id, title, client_id, length_seconds")
    .eq("workspace_id", job.workspace_id)
    .eq("client_id", job.subject_id);

  if (!items?.length) {
    return { unavailable: true, note: "this client has no content items" };
  }

  const ids = items.map((i) => i.id);
  const [{ data: posts }, { data: metrics }] = await Promise.all([
    db.from("platform_posts")
      .select("id, content_item_id, posted_at_ts, account:accounts(platform_slug)")
      .in("content_item_id", ids),
    // Paged. Unbounded selects are silently capped at 1000 rows by PostgREST,
    // and this one is workspace-wide: it is under the cap today and would
    // start losing view counts without a word as the library grows.
    (async () => {
      const rows = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await db
          .from("post_current_metrics")
          .select("platform_post_id, views")
          .range(from, from + 999);
        if (!data?.length) break;
        rows.push(...data);
        if (data.length < 1000) break;
      }
      return { data: rows };
    })(),
  ]);

  const viewsByPost = new Map(
    (metrics ?? []).map((m) => [m.platform_post_id, m.views ?? 0]),
  );
  const byItem = new Map();
  for (const p of posts ?? []) {
    const acct = Array.isArray(p.account) ? p.account[0] : p.account;
    if (!byItem.has(p.content_item_id)) byItem.set(p.content_item_id, { platforms: [], ts: null });
    const bucket = byItem.get(p.content_item_id);
    if (acct) bucket.platforms.push({ platform: acct.platform_slug, views: viewsByPost.get(p.id) ?? 0 });
    if (p.posted_at_ts && !bucket.ts) bucket.ts = p.posted_at_ts;
  }

  /* Boost indices come from the same scoring model every surface reads --
     which is `computeRankings`, and now actually does.
   *
   * This used to select from a table called `post_scores`. That table does
   * not exist and never has: it appears nowhere in the migrations, nothing
   * writes to it, and its only other mention in the repo is a line in a PRD.
   * The query was wrapped in a `.then(ok, () => ({ data: null }))` that
   * swallowed the failure, so every video came back unscored, every client
   * resolved "not enough scored work to characterise (0 videos)", and the
   * job reported DONE while writing nothing. Five clients, five successful
   * jobs, zero output.
   *
   * computeRankings is what /reports Insights builds its evidence from, via
   * cachedRankings -> scoredByContent. Calling it directly here means the
   * weekly read and the Insights tab are derived from one model rather than
   * two, so they cannot drift into disagreeing about the same client. The
   * uncached builder is used deliberately: cachedRankings imports
   * next/cache, which a plain node worker cannot load. */
  const { scoredByContent } = await computeRankings(db, job.workspace_id);
  const wanted = new Set(ids);
  const bestByItem = new Map();
  for (const [contentId, scored] of scoredByContent) {
    if (!wanted.has(contentId)) continue;
    const best = scored.reduce((max, s) => Math.max(max, s.index), 0);
    if (best > 0) bestByItem.set(contentId, best);
  }

  const videos = items.map((i) => ({
    id: i.id,
    title: i.title,
    clientId: i.client_id,
    bestIndex: bestByItem.get(i.id) ?? null,
    lengthSeconds: i.length_seconds,
    postedAtTs: byItem.get(i.id)?.ts ?? null,
    platforms: byItem.get(i.id)?.platforms ?? [],
  }));

  const evidence = buildClientEvidence(job.subject_id, videos);

  // Too little work to characterise is a finding in itself, and it needs no
  // model to state. Storing it means the UI can say so rather than showing a
  // blank card, and it costs nothing.
  if (evidence.splits === null) {
    return {
      unavailable: true,
      note: `not enough scored work to characterise (${evidence.scoredCount} videos)`,
      stats: { scored: evidence.scoredCount },
    };
  }

  const prompt = evidenceToPrompt(evidence);
  const cfg = configFromEnv();
  const digest = digestOf({ prompt, promptVersion: PROMPT_VERSION, model: cfg.model });

  const { data: cached } = await db
    .from("ai_analyses")
    .select("id")
    .eq("subject_type", "client")
    .eq("subject_id", job.subject_id)
    .eq("kind", KIND)
    .eq("prompt_version", PROMPT_VERSION)
    .eq("input_digest", digest)
    .maybeSingle();
  if (cached) return { stats: { cached: true } };

  const limit = Number(process.env.LLM_MONTHLY_TOKEN_LIMIT ?? 0);
  if (limit > 0) {
    const state = budgetState(await monthTokens(db, job.workspace_id), limit);
    if (state.exhausted) {
      const e = new LlmError(`monthly token ceiling reached`, "budget");
      e.blocked = true;
      throw e;
    }
    if (state.warn) log("warn", "budget_warning", { used: state.usedTokens, limit });
  }

  const result = await callModel({
    cfg,
    system: CLIENT_READ_PROMPT,
    user: prompt,
    schema: CLIENT_READ_SCHEMA,
    maxTokens: 900,
  });

  const { error } = await db.from("ai_analyses").insert({
    workspace_id: job.workspace_id,
    subject_type: "client",
    subject_id: job.subject_id,
    kind: KIND,
    prompt_version: PROMPT_VERSION,
    model: result.model,
    input_digest: digest,
    // The evidence is stored ALONGSIDE the prose, so any claim can be checked
    // against the table it was written from without re-deriving anything.
    output: { findings: result.data.findings, evidence },
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
  });
  if (error) throw new Error(`storing read failed: ${error.message}`);

  return {
    stats: {
      findings: result.data.findings?.length ?? 0,
      scored: evidence.scoredCount,
      retried: result.retried,
      tokens: result.inputTokens + result.outputTokens,
    },
  };
}
