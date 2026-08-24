/**
 * Idea generation, in one place so the CLI and the worker cannot drift.
 *
 * This used to live entirely inside scripts/generate-ideas.mjs. The moment a
 * button needed to queue the same work, that script became the wrong home:
 * two copies of a routine carrying a budget check, a cache check and a
 * validator is two copies that will disagree, and the one that disagrees
 * quietly is the one that spends money.
 *
 * THE SHAPE OF THE GUARANTEE (unchanged). The model is handed a table of
 * candidates -- this client's acting/holds findings and its top videos, each
 * with an id and one figure -- and asked for ideas that cite them. Citations
 * are then checked IN CODE: an invented id, a figure belonging to a different
 * row, or no citation at all drops the idea before storage. "Measured" is
 * earned by citing a real finding; everything else is labelled craft. The
 * model proposes, the code disposes.
 */
import { configFromEnv, callModel, digestOf, budgetState, llmMonthlyTokenLimit } from "@/lib/llm";
import { validateIdeas } from "@/lib/analysis/provenance";

export const IDEAS_PROMPT_VERSION = 2;

export type IdeaRunOptions = {
  clientId: string;
  /** How many to ask for. Clamped: the model is asked, not trusted. */
  count?: number;
  /** How many top-scoring videos to ground in. */
  pool?: number;
  /** Skip the input-digest cache check. */
  force?: boolean;
  model?: string;
};

export type IdeaRunResult = {
  status: "stored" | "cached" | "nothing_to_ground" | "none_survived" | "budget_exhausted";
  clientName?: string;
  requested?: number;
  proposed?: number;
  kept?: number;
  poolSize?: number;
  candidates?: number;
  dropped?: Record<string, number>;
  note?: string;
};

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));

/** Paged AND ordered: .range() with no ORDER BY has no stable row order. */
/* eslint-disable @typescript-eslint/no-explicit-any */
async function selectAll(db: any, table: string, columns: string, apply: (q: any) => any) {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await apply(db.from(table).select(columns)).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

function schemaFor(count: number) {
  return {
    type: "object",
    required: ["ideas"],
    properties: {
      ideas: {
        type: "array",
        minItems: 1,
        // Slack above `count`: a model returning one extra should be trimmed,
        // not sent round the retry loop for it. Enforced for real now --
        // validate() ignored maxItems until this was fixed.
        maxItems: count + 2,
        items: {
          type: "object",
          required: ["title", "premise", "openingLine", "citations"],
          properties: {
            title: { type: "string", maxLength: 90 },
            premise: { type: "string", maxLength: 300 },
            openingLine: { type: "string", maxLength: 200 },
            citations: {
              type: "array",
              items: {
                type: "object",
                required: ["id", "figure"],
                properties: { id: { type: "string" }, figure: { type: "number" } },
              },
            },
          },
        },
      },
    },
  };
}

/**
 * Generate and store ideas for one client.
 *
 * `db` must be a service-role client: it reads across tables the caller's
 * session may not see, and writes the ledger row. The CALLER is responsible
 * for having established that the requester may act on this client — this
 * function trusts clientId.
 */
export async function generateIdeasForClient(
  db: any,
  opts: IdeaRunOptions,
): Promise<IdeaRunResult> {
  const count = clamp(opts.count ?? 10, 1, 20);
  const pool = clamp(opts.pool ?? 100, 1, 200);
  const MODEL = opts.model || process.env.IDEAS_MODEL || "gpt-4o-mini";

  const { data: client, error: clientErr } = await db
    .from("clients").select("id, name, workspace_id")
    .eq("id", opts.clientId).is("deleted_at", null).maybeSingle();
  if (clientErr) throw new Error(`clients: ${clientErr.message}`);
  if (!client) throw new Error("client not found or deleted");

  const findings = await selectAll(db, "client_findings",
    "id, hypothesis_id, state, multiplier, n_with, n_without",
    (q) => q.eq("client_id", client.id).eq("status", "active")
      .in("state", ["acting", "holds"]).order("id"));

  const items = await selectAll(db, "content_items", "id, title, hook, hook_type",
    (q) => q.eq("client_id", client.id).eq("review_state", "approved").order("id"));

  const { computeRankings } = await import("@/lib/performanceData");
  const rankings = await computeRankings(db, client.workspace_id);
  const scored = items
    .map((i: any) => ({
      ...i,
      index: (rankings.scoredByContent.get(i.id) ?? [])
        .reduce((m: number, p: any) => Math.max(m, p.index), 0),
    }))
    .filter((i: any) => i.index > 0)
    .sort((a: any, b: any) => b.index - a.index);

  /* The top `pool` scored videos, not a quartile capped at 8. A quartile
     shrinks as a library grows -- exactly backwards -- and the cap meant
     "our top 100" was in practice "our top 8". */
  const top = scored.slice(0, pool);

  const transcripts = top.length
    ? await selectAll(db, "video_transcripts", "content_item_id, full_text",
        (q) => q.in("content_item_id", top.map((v: any) => v.id)).order("content_item_id"))
    : [];
  const transcribed = new Map(transcripts.map((t: any) => [t.content_item_id, t.full_text]));

  const candidates = [
    ...findings.map((f: any) => ({
      type: "finding", id: f.id, figure: Number(Number(f.multiplier).toFixed(3)),
      state: f.state, label: f.hypothesis_id,
    })),
    ...top.map((v: any) => ({
      type: "video", id: v.id, figure: Number(v.index.toFixed(3)),
      label: v.title, hookType: v.hook_type,
      hook: (v.hook ?? transcribed.get(v.id) ?? "").slice(0, 140),
    })),
  ];

  if (!candidates.length) {
    return {
      status: "nothing_to_ground", clientName: client.name, candidates: 0, poolSize: 0,
      note: "no findings and no scored videos to ground ideas in",
    };
  }

  const table = candidates.map((c: any) =>
    c.type === "finding"
      ? `[${c.id}] FINDING ${c.label}: ${c.figure}x (${c.state})`
      : `[${c.id}] VIDEO "${c.label}" scored ${c.figure}x baseline`
        + (c.hookType ? ` [hook: ${c.hookType}]` : "")
        + (c.hook ? ` -- opens: "${c.hook}"` : ""),
  ).join("\n");

  const system = [
    "You propose short-form video ideas for a marketing client, grounded in the",
    "evidence table provided. Rules:",
    "- Every idea MUST cite at least one row: {\"id\": \"<row id>\", \"figure\": <that row's exact number>}.",
    "- Copy figures exactly as printed. Never adjust, round further, or invent.",
    "- Cite a row only when the idea genuinely builds on it.",
    "- Ideas should be shootable by a small team within a week.",
    "- Do not repeat an idea already in the table; propose the NEXT one.",
    "Respond with JSON only: {\"ideas\": [{\"title\", \"premise\", \"openingLine\", \"citations\": [{\"id\", \"figure\"}]}]}",
  ].join("\n");

  const user = `CLIENT: ${client.name}\n\nEVIDENCE TABLE:\n${table}\n\n`
    + `Propose exactly ${count} DISTINCT ideas, each citing at least one row above.`;

  const digest = digestOf({ user, PROMPT_VERSION: IDEAS_PROMPT_VERSION, MODEL, COUNT: count });

  // Cache PRE-check. Computing the digest only to store it afterwards
  // honoured the letter of "identical inputs are never paid for twice" and
  // none of its point.
  if (!opts.force) {
    const { data: seen } = await db.from("ai_analyses")
      .select("id, created_at").eq("workspace_id", client.workspace_id)
      .eq("kind", "idea_generation").eq("input_digest", digest).limit(1);
    if (seen?.length) {
      return {
        status: "cached", clientName: client.name, poolSize: top.length,
        candidates: candidates.length,
        note: `identical evidence already generated on ${String(seen[0].created_at).slice(0, 10)}`,
      };
    }
  }

  // The monthly ceiling llm.ts calls the hard stop against a surprise bill.
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);
  const spendRows = await selectAll(db, "ai_analyses", "input_tokens, output_tokens",
    (q) => q.eq("workspace_id", client.workspace_id)
      .gte("created_at", since.toISOString()).order("id"));
  const spent = spendRows.reduce(
    (n: number, r: any) => n + (r.input_tokens ?? 0) + (r.output_tokens ?? 0), 0);
  if (budgetState(spent, llmMonthlyTokenLimit()).exhausted) {
    return {
      status: "budget_exhausted", clientName: client.name,
      note: `${spent.toLocaleString()} of ${llmMonthlyTokenLimit().toLocaleString()} tokens used this month`,
    };
  }

  const result = await callModel<{ ideas: any[] }>({
    cfg: configFromEnv(),
    model: MODEL,
    system,
    user,
    schema: schemaFor(count),
    maxTokens: Math.min(4000, 260 * count),
    temperature: 0.7,
  });

  const proposed = result.data.ideas.slice(0, count);
  const { kept, dropped } = validateIdeas(
    proposed.map((i: any) => ({ body: i, citations: i.citations })),
    candidates as any,
  );

  /* THE LEDGER ROW IS UNCONDITIONAL. It used to sit inside `if (kept.length)`,
     so a run the validator rejected entirely spent real tokens nothing
     recorded -- and the budget check above sums exactly this table. Spend is
     spend whether or not anything survived it. */
  const { error: ledgerErr } = await db.from("ai_analyses").insert({
    workspace_id: client.workspace_id,
    subject_type: "client",
    subject_id: client.id,
    kind: "idea_generation",
    prompt_version: IDEAS_PROMPT_VERSION,
    model: MODEL,
    input_digest: digest,
    output: {
      requested: count, proposed: result.data.ideas.length,
      kept: kept.length, dropped, poolSize: top.length,
    },
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
  });

  if (!kept.length) {
    return {
      status: "none_survived", clientName: client.name,
      requested: count, proposed: result.data.ideas.length, kept: 0,
      poolSize: top.length, candidates: candidates.length, dropped,
      note: ledgerErr ? `spend NOT ledgered: ${ledgerErr.message}` : "spend ledgered, nothing stored",
    };
  }

  const { data: run } = await db.from("analysis_runs")
    .select("id").eq("workspace_id", client.workspace_id)
    .order("started_at", { ascending: false }).limit(1).maybeSingle();

  const { error } = await db.from("idea_suggestions").insert(kept.map((k: any) => ({
    workspace_id: client.workspace_id,
    client_id: client.id,
    run_id: run?.id ?? null,
    prompt_version: IDEAS_PROMPT_VERSION,
    model: MODEL,
    kind: "idea",
    body: k.body,
    evidence_refs: k.citations,
    evidence_basis: k.evidenceBasis,
    dropped_counts: dropped,
  })));
  if (error) throw new Error(`storing ideas: ${error.message}`);

  return {
    status: "stored", clientName: client.name,
    requested: count, proposed: result.data.ideas.length, kept: kept.length,
    poolSize: top.length, candidates: candidates.length, dropped,
    note: ledgerErr ? `WARNING: spend not ledgered: ${ledgerErr.message}` : undefined,
  };
}
