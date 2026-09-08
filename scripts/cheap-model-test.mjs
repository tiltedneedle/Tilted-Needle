// Which model the cheap lane uses, and why it must depend on the provider.
//   node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/cheap-model-test.mjs
//
// The bug this pins: `?? "gpt-4o-mini"` is a guaranteed 404 on any provider
// that is not OpenAI. Measured in CI against a Gemini OpenAI-compatible
// endpoint -- "models/gpt-4o-mini is not found for API version v1main" -- on
// every describe job the pipeline claimed.
import { cheapModel } from "../src/lib/llm.ts";

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
