// Merge per-post comment themes into client-level ones.
//   node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/merge-themes.mjs [--dry-run]
//
// Safe to re-run at any time: merged_themes is a derived table, rebuilt from
// ai_analyses (which is never touched) plus embeddings (cached by label text,
// so a re-run embeds only labels it has not seen).
//
// Cost, measured not guessed: text-embedding-3-small is $0.02 per million
// tokens and a theme label is ~5 tokens, so a few hundred labels round to a
// hundredth of a cent. The digest cache makes re-runs free.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { mergeThemes, MERGE_DISTANCE } from "../src/lib/analysis/themeMerge.ts";

/* .env.local on the desktop, process.env on CI -- the pipeline runs this after
   each drain so freshly analysed posts fold into the client-level themes
   without anyone remembering to. */
let fileEnv = {};
try {
  fileEnv = Object.fromEntries(
    readFileSync("./.env.local", "utf8").split("\n").filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(),
                   l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
  );
} catch { /* no .env.local: CI supplies the environment directly */ }
const env = { ...fileEnv, ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  process.exit(1);
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
const DRY = process.argv.includes("--dry-run");

const EMBED_MODEL = "text-embedding-3-small";
const DIMENSIONS = 512;

async function all(table, select, orderBy = "id") {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(select).order(orderBy).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

/* ---- Gather every per-post theme, grouped by client --------------------- */
const analyses = await all("ai_analyses", "id, workspace_id, subject_id, output", "id")
  .then((rows) => rows.filter((r) => r.output?.themes?.length));
// ai_analyses carries every kind; keep only comment themes.
const { data: kindRows } = await db.from("ai_analyses").select("id").eq("kind", "comment_themes");
const themeIds = new Set((kindRows ?? []).map((r) => r.id));

const items = new Map(
  (await all("content_items", "id, client_id")).map((i) => [i.id, i.client_id]),
);

const byClient = new Map();
let sourceThemes = 0;
for (const a of analyses) {
  if (!themeIds.has(a.id)) continue;
  const clientId = items.get(a.subject_id);
  if (!clientId) continue;
  for (const t of a.output.themes) {
    if (!t.label || !(t.exampleIds?.length)) continue;
    if (!byClient.has(clientId)) byClient.set(clientId, { ws: a.workspace_id, themes: [] });
    byClient.get(clientId).themes.push({
      analysisId: a.id,
      postOrItemId: a.subject_id,
      label: String(t.label),
      sentiment: t.sentiment ?? null,
      // exampleIds are already VERIFIED by tallyThemes -- hallucinated ids
      // were dropped before storage. The union downstream unions checked sets.
      commentIds: t.exampleIds,
    });
    sourceThemes++;
  }
}
console.log(`source themes   ${sourceThemes} across ${byClient.size} clients`);

/* ---- Embed the labels, through the cache -------------------------------- */
const wanted = new Map(); // label -> null (to embed) | vector
for (const { themes } of byClient.values()) {
  for (const t of themes) wanted.set(t.label, null);
}

const cached = await all("embeddings", "subject_id, content, embedding", "id")
  .then((rows) => rows.filter(() => true));
const { data: cachedTheme } = await db.from("embeddings")
  .select("content, embedding").eq("kind", "theme_label");
for (const row of cachedTheme ?? []) {
  if (wanted.has(row.content)) {
    // pgvector returns halfvec as a string "[0.1,0.2,...]".
    wanted.set(row.content, JSON.parse(row.embedding));
  }
}
const toEmbed = [...wanted.entries()].filter(([, v]) => v === null).map(([k]) => k);
console.log(`labels          ${wanted.size} distinct, ${toEmbed.length} not yet embedded`);

if (toEmbed.length && !DRY) {
  const key = env.LLM_API_KEY;
  const base = (env.LLM_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  if (!key) throw new Error("LLM_API_KEY is required to embed new labels");

  for (let i = 0; i < toEmbed.length; i += 100) {
    const batch = toEmbed.slice(i, i + 100);
    const res = await fetch(`${base}/embeddings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: EMBED_MODEL,
        input: batch,
        // THE API PARAMETER, not client-side truncation: the API re-normalises
        // at the requested dimension. A client-side slice leaves unnormalised
        // vectors and silently wrong cosine distances.
        dimensions: DIMENSIONS,
      }),
    });
    if (!res.ok) throw new Error(`embeddings HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const body = await res.json();
    for (let j = 0; j < batch.length; j++) {
      wanted.set(batch[j], body.data[j].embedding);
    }
  }

  // Cache them. subject_id for a label is derived from the label text so the
  // unique (kind, subject_id) holds; a label seen twice embeds once, ever.
  const { createHash } = await import("node:crypto");
  const anyWs = [...byClient.values()][0].ws;
  const rows = toEmbed.map((label) => ({
    workspace_id: anyWs,
    kind: "theme_label",
    subject_id: uuidFromText(createHash, label),
    client_id: null,
    content: label,
    embedding: JSON.stringify(wanted.get(label)),
    model: EMBED_MODEL,
    dimensions: DIMENSIONS,
  }));
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await db.from("embeddings")
      .upsert(rows.slice(i, i + 100), { onConflict: "kind,subject_id" });
    if (error) throw new Error(`embedding cache write: ${error.message}`);
  }
  console.log(`embedded        ${toEmbed.length} new labels`);
}

function uuidFromText(createHash, text) {
  const h = createHash("sha1").update(text).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/* ---- Merge, per client --------------------------------------------------- */
let totalMerged = 0;
const preview = [];
for (const [clientId, { ws, themes }] of byClient) {
  const vectors = themes.map((t) => wanted.get(t.label));
  if (vectors.some((v) => !v)) {
    if (DRY) { console.log(`(dry) client ${clientId}: ${themes.length} themes, embeddings pending`); continue; }
    throw new Error(`missing embedding for a label of client ${clientId}`);
  }

  const merged = mergeThemes(themes, vectors);
  totalMerged += merged.length;
  preview.push({ clientId, from: themes.length, to: merged.length, top: merged[0] });

  if (!DRY) {
    // Rebuild: derived table, so replace-by-client is the idempotent write.
    await db.from("merged_themes").delete().eq("client_id", clientId);
    const { error } = await db.from("merged_themes").insert(merged.map((m) => ({
      workspace_id: ws,
      client_id: clientId,
      label: m.label,
      sentiment: m.sentiment,
      comment_ids: m.commentIds,
      comment_count: m.commentCount,
      source_count: m.sourceCount,
      post_count: m.postCount,
    })));
    if (error) throw new Error(`merged_themes write: ${error.message}`);
  }
}

console.log(`\nmerged          ${sourceThemes} source themes -> ${totalMerged} client-level (cut ${MERGE_DISTANCE})`);
for (const p of preview.slice(0, 6)) {
  console.log(`  client ${p.clientId.slice(0, 8)}: ${p.from} -> ${p.to}`
    + (p.top ? ` | top: "${p.top.label}" (${p.top.commentCount} comments over ${p.top.postCount} posts, merged ${p.top.memberLabels.length} labels)` : ""));
}
if (DRY) console.log("\n--dry-run: nothing written.");
