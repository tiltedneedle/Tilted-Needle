// Generate content ideas for a client, grounded in verified evidence.
//   node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/generate-ideas.mjs --client <id> [--count 10] [--pool 100] [--dry-run] [--force]
//
// THE SHAPE OF THE GUARANTEE
//
// The model is handed a table of candidates -- this client's acting/holds
// findings and its own top videos, each with an id and one figure -- and asked
// for ideas that cite them. Then the citations are checked IN CODE: an
// invented id, a figure that belongs to a different row, or no citation at all
// drops the idea before storage. "Measured" is earned by citing a real
// finding; everything else is labelled craft in a schema field. The model
// proposes, the code disposes -- the same division of labour as tallyThemes.
//
// At current coverage most clients have zero acting/holds findings, so most
// ideas will be craft. That is the system being honest, not broken.
//
// SIX THINGS WERE WRONG HERE AND ARE FIXED BELOW. Every one of them was
// invisible in normal use, which is why they lasted through a single
// production run:
//
//   1. Unpaged selects. content_items and video_transcripts were read with
//      plain .select(), which stops at 1000 rows without erroring. The
//      "top 100 videos" would silently have been "top 100 of an arbitrary
//      1000-row prefix" the moment a client crossed that line.
//   2. No workspace filter, on the service-role key. A bare invocation picked
//      clients[0] from EVERY workspace in the database.
//   3. No budget check. Every other model caller in this repo consults
//      llmMonthlyTokenLimit first; this one walked past the hard stop that
//      llm.ts calls "the only thing that can produce a surprise bill".
//   4. No cache pre-check. digestOf was computed AFTER the call, purely to be
//      written down, so re-running on unchanged evidence re-bought the
//      generation -- contradicting the adapter's own stated contract.
//   5. The ai_analyses ledger row sat inside `if (kept.length)`, so a run
//      where the validator rejected everything spent real tokens that no
//      ledger recorded -- and the budget guard sums exactly that table. The
//      unguarded spend was also the unmeasured one.
//   6. maxItems was inert (see validate() in llm.ts), so the "3-5" was a
//      request, not a constraint.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  configFromEnv, callModel, digestOf, budgetState, llmMonthlyTokenLimit, LlmError,
} from "../src/lib/llm.ts";
import { validateIdeas } from "../src/lib/analysis/provenance.ts";

const env = Object.fromEntries(
  readFileSync("./.env.local", "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(),
                 l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
for (const [k, v] of Object.entries(env)) process.env[k] ??= v;
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

const flag = (name, fallback = null) => {
  // Guarded: indexOf returning -1 would otherwise make argv[0] -- the node
  // binary's path -- the value, and the failure would be mysterious.
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const DRY = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");
const clientArg = flag("client");
const workspaceArg = flag("workspace");
const COUNT = Math.max(1, Math.min(20, Number(flag("count", 10))));
const POOL = Math.max(1, Math.min(200, Number(flag("pool", 100))));
const PROMPT_VERSION = 2;
const MODEL = process.env.IDEAS_MODEL || "gpt-4o-mini";

/** Paged AND ordered: .range() with no ORDER BY has no stable row order. */
async function selectAll(table, columns, apply) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from(table).select(columns);
    q = apply(q).range(from, from + 999);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const IDEAS_SCHEMA = {
  type: "object",
  required: ["ideas"],
  properties: {
    ideas: {
      type: "array",
      minItems: 1,
      // Enforced for real now. Slack above COUNT because a model that returns
      // one extra should be trimmed, not sent round the retry loop for it.
      maxItems: COUNT + 2,
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

/* ---- Pick the client ------------------------------------------------------
   Scoped to a workspace. Without this the service-role key sees every
   workspace and a bare run picks clients[0] from whichever happens to sort
   first -- another tenant's client, generating and storing ideas for them. */
let clientQuery = db.from("clients").select("id, name, workspace_id")
  .is("deleted_at", null).eq("is_archived", false).order("name");
if (clientArg) clientQuery = clientQuery.eq("id", clientArg);
if (workspaceArg) clientQuery = clientQuery.eq("workspace_id", workspaceArg);
const { data: clients, error: clientErr } = await clientQuery;
if (clientErr) throw new Error(`clients: ${clientErr.message}`);

if (!clients?.length) throw new Error("no live client matched");
if (!clientArg && new Set(clients.map((c) => c.workspace_id)).size > 1) {
  throw new Error(
    "clients span multiple workspaces; pass --client <id> or --workspace <id> "
    + "rather than letting an arbitrary one be picked",
  );
}
const client = clients[0];
console.log(`client          ${client.name} (${client.id.slice(0, 8)})`);

/* ---- The candidate evidence table ---------------------------------------- */
const findings = await selectAll(
  "client_findings",
  "id, hypothesis_id, state, multiplier, n_with, n_without",
  (q) => q.eq("client_id", client.id).eq("status", "active")
    .in("state", ["acting", "holds"]).order("id"),
);

const items = await selectAll(
  "content_items", "id, title, hook, hook_type",
  (q) => q.eq("client_id", client.id).eq("review_state", "approved").order("id"),
);

const { computeRankings } = await import("../src/lib/performanceData.ts");
const rankings = await computeRankings(db, client.workspace_id);
const scored = items
  .map((i) => {
    const posts = rankings.scoredByContent.get(i.id) ?? [];
    return { ...i, index: posts.reduce((m, p) => Math.max(m, p.index), 0) };
  })
  .filter((i) => i.index > 0)
  .sort((a, b) => b.index - a.index);

/* The pool is the top POOL scored videos, not a quartile capped at 8. A
   quartile shrinks as a client's library grows -- exactly backwards -- and
   the cap meant "our top 100" was in practice "our top 8". */
const pool = scored.slice(0, POOL);

// Transcripts only for the pool, and paged. Fetching every transcript to use
// a hundred of them is the kind of read that works until it silently doesn't.
const poolIds = new Set(pool.map((v) => v.id));
const transcripts = pool.length
  ? await selectAll("video_transcripts", "content_item_id, full_text",
      (q) => q.in("content_item_id", [...poolIds]).order("content_item_id"))
  : [];
const transcribed = new Map(transcripts.map((t) => [t.content_item_id, t.full_text]));

const candidates = [
  ...findings.map((f) => ({
    type: "finding", id: f.id, figure: Number(Number(f.multiplier).toFixed(3)),
    state: f.state, label: f.hypothesis_id,
  })),
  ...pool.map((v) => ({
    type: "video", id: v.id, figure: Number(v.index.toFixed(3)),
    label: v.title, hookType: v.hook_type,
    hook: (v.hook ?? transcribed.get(v.id) ?? "").slice(0, 140),
  })),
];

console.log(`candidates      ${findings.length} findings (acting/holds), `
  + `${pool.length} of ${scored.length} scored videos (pool ${POOL})`);
if (!candidates.length) {
  console.log("nothing to ground ideas in; refusing to generate ungroundable ideas");
  process.exit(0);
}

/* ---- The prompt ----------------------------------------------------------- */
const table = candidates.map((c) =>
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
  + `Propose exactly ${COUNT} DISTINCT ideas, each citing at least one row above.`;

if (DRY) {
  console.log(`\n--dry-run. Would ask for ${COUNT} ideas over ${candidates.length} rows.`);
  console.log(table.slice(0, 2000));
  process.exit(0);
}

/* ---- Guards that every other model caller already had --------------------- */
const digest = digestOf({ user, PROMPT_VERSION, MODEL, COUNT });

// 4. Cache PRE-check. The adapter's contract is "identical inputs are never
//    paid for twice"; computing the digest only to store it afterwards
//    honoured the letter and none of the point.
if (!FORCE) {
  const { data: seen } = await db.from("ai_analyses")
    .select("id, created_at").eq("workspace_id", client.workspace_id)
    .eq("kind", "idea_generation").eq("input_digest", digest).limit(1);
  if (seen?.length) {
    console.log(`cache hit       identical evidence already generated `
      + `(${new Date(seen[0].created_at).toISOString().slice(0, 10)}). --force to spend anyway.`);
    process.exit(0);
  }
}

// 3. Budget. llm.ts calls the monthly ceiling "a hard stop rather than a
//    warning" because the LLM is the only thing here that can surprise a bill.
const since = new Date();
since.setUTCDate(1);
since.setUTCHours(0, 0, 0, 0);
const spend = await selectAll("ai_analyses", "input_tokens, output_tokens",
  (q) => q.eq("workspace_id", client.workspace_id).gte("created_at", since.toISOString()).order("id"));
const spent = spend.reduce((n, r) => n + (r.input_tokens ?? 0) + (r.output_tokens ?? 0), 0);
const budget = budgetState(spent, llmMonthlyTokenLimit());
console.log(`budget          ${spent.toLocaleString()} / ${llmMonthlyTokenLimit().toLocaleString()} tokens this month`);
if (budget.exhausted) {
  console.error("monthly token ceiling reached; refusing to spend. Raise LLM_MONTHLY_TOKEN_LIMIT deliberately.");
  process.exit(1);
}

const cfg = configFromEnv();
let result;
try {
  result = await callModel({
    cfg, model: MODEL, system, user, schema: IDEAS_SCHEMA,
    maxTokens: Math.min(4000, 260 * COUNT), temperature: 0.7,
  });
} catch (e) {
  if (e instanceof LlmError) console.error(`model call failed (${e.kind}): ${e.message}`);
  throw e;
}

/* ---- The validator is the point ------------------------------------------ */
const proposed = result.data.ideas.slice(0, COUNT);
const { kept, dropped } = validateIdeas(
  proposed.map((i) => ({ body: i, citations: i.citations })),
  candidates,
);

console.log(`\nmodel proposed  ${result.data.ideas.length}` +
  (result.data.ideas.length > COUNT ? ` (trimmed to ${COUNT})` : ""));
console.log(`survived        ${kept.length}  (dropped: ${JSON.stringify(dropped)})`);
for (const k of kept) {
  console.log(`  [${k.evidenceBasis}] ${k.body.title}`);
  console.log(`      ${k.body.premise.slice(0, 100)}`);
}

/* 5. THE LEDGER ROW IS UNCONDITIONAL. It used to live inside `if (kept.length)`
      alongside the insert, so a run the validator rejected entirely spent real
      tokens that nothing recorded -- and the budget check above sums exactly
      this table. Spend is spend whether or not anything survived it. */
const { error: ledgerErr } = await db.from("ai_analyses").insert({
  workspace_id: client.workspace_id,
  subject_type: "client",
  subject_id: client.id,
  kind: "idea_generation",
  prompt_version: PROMPT_VERSION,
  model: MODEL,
  input_digest: digest,
  output: {
    requested: COUNT, proposed: result.data.ideas.length,
    kept: kept.length, dropped, poolSize: pool.length,
  },
  input_tokens: result.inputTokens,
  output_tokens: result.outputTokens,
});
if (ledgerErr) console.error(`WARNING: spend not ledgered: ${ledgerErr.message}`);

if (kept.length) {
  const { data: run } = await db.from("analysis_runs")
    .select("id").eq("workspace_id", client.workspace_id)
    .order("started_at", { ascending: false }).limit(1).maybeSingle();

  const { error } = await db.from("idea_suggestions").insert(kept.map((k) => ({
    workspace_id: client.workspace_id,
    client_id: client.id,
    run_id: run?.id ?? null,
    prompt_version: PROMPT_VERSION,
    model: MODEL,
    kind: "idea",
    body: k.body,
    evidence_refs: k.citations,
    evidence_basis: k.evidenceBasis,
    dropped_counts: dropped,
  })));
  if (error) throw new Error(`storing ideas: ${error.message}`);
  console.log(`\nstored ${kept.length} suggestions`);
} else {
  console.log("\nnothing survived validation; spend was ledgered, nothing stored");
}
