// Generate content ideas for a client, grounded in verified evidence.
//   node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/generate-ideas.mjs [--client <id>] [--dry-run]
//
// THE SHAPE OF THE GUARANTEE
//
// The model is handed a table of candidates -- this client's acting/holds
// findings and its own top-quartile videos, each with an id and one figure --
// and asked for ideas that cite them. Then the citations are checked IN CODE:
// an invented id, a figure that belongs to a different row, or no citation at
// all drops the idea before storage. "Measured" is earned by citing a real
// finding; everything else is labelled craft in a schema field. The model
// proposes, the code disposes -- the same division of labour as tallyThemes.
//
// At current coverage most clients have zero acting/holds findings, so most
// ideas will be craft. That is the system being honest, not broken.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { configFromEnv, callModel, digestOf } from "../src/lib/llm.ts";
import { validateIdeas } from "../src/lib/analysis/provenance.ts";

const env = Object.fromEntries(
  readFileSync("./.env.local", "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(),
                 l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
for (const [k, v] of Object.entries(env)) process.env[k] ??= v;
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

const DRY = process.argv.includes("--dry-run");
// Guarded: indexOf returning -1 would otherwise make argv[0] -- the node
// binary's path -- the "client id", and the lookup would fail mysteriously.
const clientFlag = process.argv.indexOf("--client");
const clientArg = clientFlag >= 0 ? process.argv[clientFlag + 1] : null;
const PROMPT_VERSION = 1;
const MODEL = process.env.IDEAS_MODEL || "gpt-4o-mini";

const IDEAS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ideas"],
  properties: {
    ideas: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "premise", "openingLine", "citations"],
        properties: {
          title: { type: "string", maxLength: 90 },
          premise: { type: "string", maxLength: 300 },
          openingLine: { type: "string", maxLength: 200 },
          citations: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "figure"],
              properties: { id: { type: "string" }, figure: { type: "number" } },
            },
          },
        },
      },
    },
  },
};

/* ---- Pick the client ----------------------------------------------------- */
const { data: clients } = await db
  .from("clients").select("id, name, workspace_id")
  .is("deleted_at", null).eq("is_archived", false);
const client = clientArg
  ? clients.find((c) => c.id === clientArg)
  : clients[0];
if (!client) throw new Error("no live client found");
console.log(`client          ${client.name} (${client.id.slice(0, 8)})`);

/* ---- The candidate evidence table ---------------------------------------- */
const { data: findings } = await db
  .from("client_findings")
  .select("id, hypothesis_id, state, multiplier, n_with, n_without")
  .eq("client_id", client.id).eq("status", "active").in("state", ["acting", "holds"]);

const { data: items } = await db
  .from("content_items")
  .select("id, title, review_state")
  .eq("client_id", client.id).eq("review_state", "approved");

// Top videos by the same score the dashboards use, via the transcript table's
// coverage: an exemplar the model can imitate needs words.
const { data: transcripts } = await db
  .from("video_transcripts")
  .select("content_item_id, full_text")
  .in("content_item_id", (items ?? []).map((i) => i.id));
const transcribed = new Map((transcripts ?? []).map((t) => [t.content_item_id, t.full_text]));

const { computeRankings } = await import("../src/lib/performanceData.ts");
const rankings = await computeRankings(db, client.workspace_id);
const scored = (items ?? [])
  .map((i) => {
    const posts = rankings.scoredByContent.get(i.id) ?? [];
    const best = posts.reduce((m, p) => Math.max(m, p.index), 0);
    return { ...i, index: best };
  })
  .filter((i) => i.index > 0)
  .sort((a, b) => b.index - a.index);

const topQuartile = scored.slice(0, Math.max(3, Math.floor(scored.length / 4)));
const candidates = [
  ...(findings ?? []).map((f) => ({
    type: "finding", id: f.id, figure: Number(Number(f.multiplier).toFixed(3)), state: f.state,
    label: f.hypothesis_id,
  })),
  ...topQuartile.slice(0, 8).map((v) => ({
    type: "video", id: v.id, figure: Number(v.index.toFixed(3)),
    label: v.title, hook: (transcribed.get(v.id) ?? "").slice(0, 140),
  })),
];

console.log(`candidates      ${(findings ?? []).length} findings (acting/holds), ${Math.min(8, topQuartile.length)} top videos`);
if (!candidates.length) {
  console.log("nothing to ground ideas in; refusing to generate ungroundable ideas");
  process.exit(0);
}

/* ---- The prompt ----------------------------------------------------------- */
const table = candidates.map((c) =>
  c.type === "finding"
    ? `[${c.id}] FINDING ${c.label}: ${c.figure}x (${c.state})`
    : `[${c.id}] VIDEO "${c.label}" scored ${c.figure}x baseline` +
      (c.hook ? ` -- opens: "${c.hook}"` : ""),
).join("\n");

const system = [
  "You propose short-form video ideas for a marketing client, grounded in the",
  "evidence table provided. Rules:",
  "- Every idea MUST cite at least one row: {\"id\": \"<row id>\", \"figure\": <that row's exact number>}.",
  "- Copy figures exactly as printed. Never adjust, round further, or invent.",
  "- Cite a row only when the idea genuinely builds on it.",
  "- Ideas should be shootable by a small team within a week.",
  "Respond with JSON only: {\"ideas\": [{\"title\", \"premise\", \"openingLine\", \"citations\": [{\"id\", \"figure\"}]}]}",
].join("\n");

const user = `CLIENT: ${client.name}\n\nEVIDENCE TABLE:\n${table}\n\nPropose 3-5 ideas.`;

if (DRY) {
  console.log("\n--dry-run. The prompt's evidence table:\n" + table);
  process.exit(0);
}

const cfg = configFromEnv();
const result = await callModel({
  cfg, model: MODEL, system, user, schema: IDEAS_SCHEMA, maxTokens: 1200, temperature: 0.7,
});

/* ---- The validator is the point ------------------------------------------ */
const { kept, dropped } = validateIdeas(
  result.data.ideas.map((i) => ({ body: i, citations: i.citations })),
  candidates,
);

console.log(`\nmodel proposed  ${result.data.ideas.length}`);
console.log(`survived        ${kept.length}  (dropped: ${JSON.stringify(dropped)})`);
for (const k of kept) {
  console.log(`  [${k.evidenceBasis}] ${k.body.title}`);
  console.log(`      ${k.body.premise.slice(0, 100)}`);
}

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

  await db.from("ai_analyses").insert({
    workspace_id: client.workspace_id,
    subject_type: "client",
    subject_id: client.id,
    kind: "idea_generation",
    prompt_version: PROMPT_VERSION,
    model: MODEL,
    input_digest: digestOf({ user, PROMPT_VERSION, MODEL }),
    output: { proposed: result.data.ideas.length, kept: kept.length, dropped },
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
  });
}
