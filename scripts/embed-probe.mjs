// What can the CONFIGURED provider actually do for embeddings?
//
// TEMPORARY DIAGNOSTIC. Deleted once the answer is recorded in code.
//
// It exists because the answer is unknowable from this desktop: the only
// Gemini credentials live in GitHub Actions, and the embedding contract we
// need -- a 512-dimension vector, to match halfvec(512) -- is a per-provider
// detail no documentation reliably settles.
//
// EXITS 0 WHATEVER IT FINDS, on purpose. A failing Actions run emails the
// owner, and a diagnostic that reports "this model is unsupported" has
// SUCCEEDED at its job. Only real breakage should ever go red.
//
// Prints no secret. The key is never echoed, and the base URL is a masked
// secret in this environment, so only derived facts are reported.
const key = process.env.LLM_API_KEY;
const base = (process.env.LLM_BASE_URL ?? "").replace(/\/$/, "");
if (!key || !base) { console.log("no LLM credentials in this environment"); process.exit(0); }

// Ordered by preference: 512-capable first, then fixed-size fallbacks, then
// the OpenAI name as a control that proves the probe itself works.
const CANDIDATES = [
  "gemini-embedding-001",
  "text-embedding-004",
  "models/text-embedding-004",
  "embedding-001",
  "text-embedding-3-small",
];

async function probe(model, dims) {
  const body = { model, input: ["pricing questions from the audience"] };
  if (dims) body.dimensions = dims;
  try {
    const res = await fetch(base + "/embeddings", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      // First line only: enough to tell "no such model" from "bad request".
      return { ok: false, note: res.status + " " + t.replace(/\s+/g, " ").slice(0, 120) };
    }
    const j = await res.json();
    const v = j?.data?.[0]?.embedding;
    return Array.isArray(v)
      ? { ok: true, dim: v.length }
      : { ok: false, note: "no embedding array in response" };
  } catch (e) {
    return { ok: false, note: String(e?.message ?? e).slice(0, 120) };
  }
}

console.log("## Embedding probe\n");
console.log("| model | native dim | dimensions:512 honoured? | note |");
console.log("|---|---|---|---|");
for (const m of CANDIDATES) {
  const native = await probe(m, null);
  if (!native.ok) { console.log(`| ${m} | — | — | ${native.note} |`); continue; }
  const asked = await probe(m, 512);
  const honoured = asked.ok && asked.dim === 512 ? `**yes**` : asked.ok ? `no (got ${asked.dim})` : `no (${asked.note})`;
  console.log(`| ${m} | ${native.dim} | ${honoured} | |`);
}
console.log("\nDone. This step is green regardless of what it found.");
