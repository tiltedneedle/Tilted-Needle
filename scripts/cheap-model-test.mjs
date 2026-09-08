// Which model the cheap lane uses, and why it must depend on the provider.
//   node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/cheap-model-test.mjs
//
// The bug this pins: `?? "gpt-4o-mini"` is a guaranteed 404 on any provider
// that is not OpenAI. Measured in CI against a Gemini OpenAI-compatible
// endpoint -- "models/gpt-4o-mini is not found for API version v1main" -- on
// every describe job the pipeline claimed.
import { cheapModel, embeddingModel, EMBED_DIMENSIONS } from "../src/lib/llm.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

const openai = { LLM_BASE_URL: "https://api.openai.com/v1", LLM_MODEL: "gpt-4o" };
const gemini = {
  LLM_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai",
  LLM_MODEL: "gemini-2.0-flash",
};

check("an explicit override always wins, on any provider",
  cheapModel("my-model", gemini) === "my-model" && cheapModel("my-model", openai) === "my-model");

check("OpenAI keeps its cheap tier",
  cheapModel(undefined, openai) === "gpt-4o-mini");

check("a non-OpenAI provider falls back to the model it was configured with",
  cheapModel(undefined, gemini) === "gemini-2.0-flash",
  cheapModel(undefined, gemini));

check("an empty override is not an override (unset CI secrets interpolate to \"\")",
  cheapModel("", gemini) === "gemini-2.0-flash" && cheapModel("   ", openai) === "gpt-4o-mini");

/* HOSTNAME, NOT SUBSTRING. A gateway that merely mentions OpenAI in a query
   string does not serve OpenAI's model names, and matching the whole URL
   would send gpt-4o-mini straight back into the 404 this file exists for. */
check("a proxy that only mentions openai in its URL is not treated as OpenAI",
  cheapModel(undefined, { LLM_BASE_URL: "https://gw.example.com/v1?upstream=api.openai.com", LLM_MODEL: "llama-3" }) === "llama-3");

check("a subdomain of OpenAI still counts",
  cheapModel(undefined, { LLM_BASE_URL: "https://eu.api.openai.com/v1", LLM_MODEL: "gpt-4o" }) === "gpt-4o-mini");

/* Degenerate environments must not throw here: configFromEnv already raises a
   precise "Missing LLM_BASE_URL" and that is the error worth surfacing. */
check("an unparseable base URL falls back rather than throwing",
  cheapModel(undefined, { LLM_BASE_URL: "not a url", LLM_MODEL: "some-model" }) === "some-model");
check("no environment at all still yields a usable name", cheapModel(undefined, {}) === "gpt-4o-mini");

/* ---- Embedding model: wrong here is SILENT, not a 404 ------------------- */
{
  check("OpenAI gets its own embedding model",
    embeddingModel(openai) === "text-embedding-3-small");

  /* Measured against the live endpoint 2026-09-08: gemini-embedding-001 is
     natively 3072 and honours `dimensions: 512`. The other Gemini embedding
     names (text-embedding-004, embedding-001) all 404 on that endpoint. */
  check("Gemini gets the model that can actually produce 512 dimensions",
    embeddingModel(gemini) === "gemini-embedding-001");

  check("the width is fixed by the halfvec(512) column", EMBED_DIMENSIONS === 512);

  check("an explicit EMBED_MODEL wins",
    embeddingModel({ ...gemini, EMBED_MODEL: "custom-embed" }) === "custom-embed");

  /* THROWS rather than guessing. A wrong chat model 404s; a wrong embedding
     model returns numbers that compare meaninglessly against cached vectors,
     merging unrelated themes with no error anywhere. */
  let threw = false;
  try { embeddingModel({ LLM_BASE_URL: "https://llm.example.com/v1", LLM_MODEL: "x" }); }
  catch { threw = true; }
  check("an unknown provider refuses to guess an embedding model", threw);

  let threwUnset = false;
  try { embeddingModel({}); } catch { threwUnset = true; }
  check("and so does no configuration at all", threwUnset);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
