// Model-adapter tests. No key, no network, no bill: the transport is injected,
// so every rule that protects a client report is checkable here.
//
//   node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/llm-test.mjs
import {
  digestOf, validate, callModel, extractJson, budgetState, assertWithinBudget,
  configFromEnv, HOUSE_RULES, VISION_HOUSE_RULES, LlmError,
} from "../src/lib/llm.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

const CFG = { baseUrl: "https://example.test/v1", apiKey: "k", model: "test-model" };

/** A transport that returns queued replies and records what it was sent. */
function mockTransport(replies) {
  const sent = [];
  const fn = async (cfg, body) => {
    sent.push(body);
    const next = replies.shift();
    if (next?.httpError) return { ok: false, status: next.httpError, text: "boom" };
    return {
      ok: true, status: 200,
      json: {
        choices: [{ message: { content: next?.content ?? "{}" } }],
        usage: { prompt_tokens: next?.in ?? 10, completion_tokens: next?.out ?? 5 },
      },
    };
  };
  fn.sent = sent;
  return fn;
}

const SCHEMA = {
  type: "object",
  required: ["claims"],
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        required: ["text", "confidence"],
        properties: {
          text: { type: "string" },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
          sampleSize: { type: "integer" },
        },
      },
    },
  },
};

/* ---- Digest stability ---------------------------------------------------- */
{
  check("the same facts digest identically",
    digestOf({ a: 1, b: [2, 3] }) === digestOf({ a: 1, b: [2, 3] }));

  // The one that matters: a refactor reordering an object literal must not
  // silently re-buy every analysis in the system.
  check("key order does not change the digest",
    digestOf({ a: 1, b: 2 }) === digestOf({ b: 2, a: 1 }));
  check("nested key order does not change the digest",
    digestOf({ x: { a: 1, b: 2 } }) === digestOf({ x: { b: 2, a: 1 } }));

  check("different values digest differently",
    digestOf({ a: 1 }) !== digestOf({ a: 2 }));
  // Array order IS meaningful -- a ranked list reordered is different input.
  check("array order still matters", digestOf([1, 2]) !== digestOf([2, 1]));
}

/* ---- Schema validation --------------------------------------------------- */
{
  check("a valid payload passes",
    validate({ claims: [{ text: "x", confidence: "high" }] }, SCHEMA).length === 0);

  check("a missing required field is caught",
    validate({ claims: [{ text: "x" }] }, SCHEMA)
      .some((p) => p.includes("confidence") && p.includes("required")));

  check("a wrong type is caught",
    validate({ claims: [{ text: 5, confidence: "high" }] }, SCHEMA)
      .some((p) => p.includes("expected string")));

  check("a value outside an enum is caught",
    validate({ claims: [{ text: "x", confidence: "certain" }] }, SCHEMA)
      .some((p) => p.includes("expected one of")));

  check("a non-integer where an integer is required is caught",
    validate({ claims: [{ text: "x", confidence: "low", sampleSize: 2.5 }] }, SCHEMA)
      .some((p) => p.includes("expected integer")));

  check("an array where an object belongs is caught",
    validate([], SCHEMA).some((p) => p.includes("expected object")));

  check("the error names the path",
    validate({ claims: [{ text: 5, confidence: "high" }] }, SCHEMA)[0].startsWith("$.claims[0].text"));
}

/* ---- Fence stripping ----------------------------------------------------- */
{
  check("a fenced reply is unwrapped", extractJson('```json\n{"a":1}\n```') === '{"a":1}');
  check("a bare reply is untouched", extractJson('{"a":1}') === '{"a":1}');
}

/* ---- The house rules travel on every call -------------------------------- */
{
  const t = mockTransport([{ content: '{"claims":[]}' }]);
  await callModel({ cfg: CFG, system: "Task specifics.", user: "table", schema: SCHEMA, transport: t });
  const sys = t.sent[0].messages[0].content;

  check("the system prompt carries the house rules", sys.startsWith(HOUSE_RULES));
  check("and the caller's own instructions", sys.includes("Task specifics."));
  check("the no-computing rule is stated",
    /never calculate|Never calculate/i.test(sys) && /re-derive/i.test(sys));
  check("the retention vocabulary rule is stated",
    sys.includes("retention") && sys.includes("re-watched"));
  check("JSON mode is requested", t.sent[0].response_format?.type === "json_object");
}

/* ---- Retry on schema failure --------------------------------------------- */
{
  const t = mockTransport([
    { content: '{"claims":[{"text":"x"}]}', in: 100, out: 20 },      // missing confidence
    { content: '{"claims":[{"text":"x","confidence":"low"}]}', in: 120, out: 25 },
  ]);
  const r = await callModel({ cfg: CFG, system: "s", user: "u", schema: SCHEMA, transport: t });

  check("an invalid first reply is retried", r.retried === true);
  check("and the retry's data is returned", r.data.claims[0].confidence === "low");
  check("tokens from BOTH attempts are billed",
    r.inputTokens === 220 && r.outputTokens === 45, `${r.inputTokens}/${r.outputTokens}`);
  check("the retry tells the model what was wrong",
    t.sent[1].messages.at(-1).content.includes("confidence"));
}

/* ---- Two failures is a failure ------------------------------------------- */
{
  const t = mockTransport([
    { content: '{"claims":[{"text":"x"}]}' },
    { content: '{"claims":[{"text":"y"}]}' },
  ]);
  let err = null;
  try {
    await callModel({ cfg: CFG, system: "s", user: "u", schema: SCHEMA, transport: t });
  } catch (e) { err = e; }
  check("a second schema failure throws rather than returning prose",
    err instanceof LlmError && err.kind === "schema", String(err?.kind));
  check("and it does not try a third time", t.sent.length === 2, `${t.sent.length} calls`);
}

/* ---- Transport failures -------------------------------------------------- */
{
  const t = mockTransport([{ httpError: 500 }]);
  let err = null;
  try { await callModel({ cfg: CFG, system: "s", user: "u", schema: SCHEMA, transport: t }); }
  catch (e) { err = e; }
  check("an HTTP error surfaces as a transport error",
    err instanceof LlmError && err.kind === "transport");

  const bad = mockTransport([{ content: "not json at all" }, { content: "still not json" }]);
  let err2 = null;
  try { await callModel({ cfg: CFG, system: "s", user: "u", schema: SCHEMA, transport: bad }); }
  catch (e) { err2 = e; }
  check("unparseable content is a schema failure, not a crash",
    err2 instanceof LlmError && err2.kind === "schema");
}

/* ---- Budget: a hard stop, not a warning ---------------------------------- */
{
  const ok = budgetState(500_000, 1_000_000);
  check("under budget is not exhausted", !ok.exhausted && !ok.warn);
  check("remaining is reported", ok.remaining === 500_000);

  const warn = budgetState(850_000, 1_000_000);
  check("past 80% warns but still allows", warn.warn && !warn.exhausted);

  const spent = budgetState(1_000_000, 1_000_000);
  check("at the ceiling it is exhausted", spent.exhausted);
  check("and remaining never goes negative", budgetState(1_200_000, 1_000_000).remaining === 0);

  let err = null;
  try { assertWithinBudget(spent); } catch (e) { err = e; }
  check("assertWithinBudget throws at the ceiling",
    err instanceof LlmError && err.kind === "budget");

  // No ceiling configured means no enforcement -- but it must not crash.
  check("a zero limit disables enforcement rather than blocking everything",
    !budgetState(999, 0).exhausted);
}

/* ---- Config -------------------------------------------------------------- */
{
  let err = null;
  try { configFromEnv({}); } catch (e) { err = e; }
  check("missing config names exactly what is missing",
    err instanceof LlmError && err.message.includes("LLM_BASE_URL") &&
    err.message.includes("LLM_API_KEY") && err.message.includes("LLM_MODEL"));

  const cfg = configFromEnv({
    LLM_BASE_URL: "https://x/v1", LLM_API_KEY: "k", LLM_MODEL: "m", LLM_VISION_MODEL: "v",
  });
  check("a complete environment builds a config", cfg.model === "m" && cfg.visionModel === "v");

  // An unset GitHub secret interpolates to "", and `??` does not catch "".
  // Left raw, the vision fallback would choose the empty string over the real
  // model name and the request would go out with no model at all.
  const blank = configFromEnv({
    LLM_BASE_URL: "https://x/v1", LLM_API_KEY: "k", LLM_MODEL: "m", LLM_VISION_MODEL: "",
  });
  check("an empty LLM_VISION_MODEL falls back rather than blanking the model",
    (blank.visionModel ?? blank.model) === "m");
  const spaces = configFromEnv({
    LLM_BASE_URL: "https://x/v1", LLM_API_KEY: "k", LLM_MODEL: "m", LLM_VISION_MODEL: "   ",
  });
  check("a whitespace-only LLM_VISION_MODEL falls back too",
    (spaces.visionModel ?? spaces.model) === "m");
}

/* ---- Size bounds, which used to be decorative ----------------------------
   IDEAS_SCHEMA carried maxItems:5 and capped nothing: validate() ignored the
   keyword, and json_object mode never shows the schema to the provider. Ten
   ideas would have validated first time and all ten been stored. */
{
  const arr = { type: "array", minItems: 2, maxItems: 3, items: { type: "string" } };
  check("maxItems is enforced", validate(["a", "b", "c", "d"], arr).length === 1);
  check("the message names both the bound and the actual",
    /at most 3 items, got 4/.test(validate(["a", "b", "c", "d"], arr)[0]));
  check("minItems is enforced", /at least 2 items, got 1/.test(validate(["a"], arr)[0]));
  check("a length inside the bounds passes", validate(["a", "b"], arr).length === 0);

  const str = { type: "string", maxLength: 5 };
  check("maxLength is enforced", /at most 5 characters, got 8/.test(validate("abcdefgh", str)[0]));
  check("a short enough string passes", validate("abc", str).length === 0);
  check("a non-string is still caught by type",
    /expected string/.test(validate(7, str)[0]));

  // The enum path must survive being moved inside the string branch.
  const en = { type: "string", enum: ["instagram", "tiktok"] };
  check("a string enum still rejects the wrong case",
    /expected one of/.test(validate("Instagram", en)[0]));
  check("a string enum still accepts a listed value", validate("tiktok", en).length === 0);
}

/* ---- Multimodal content ---------------------------------------------------
   THE REGRESSION THIS FILE EXISTED WITHOUT.

   `LlmMessage.content` was typed `string`, so the vision handler built the
   right OpenAI content array and then JSON.stringify'd it to compile. A
   megabyte of base64 went to the provider as PROSE; no image was ever
   transmitted. Nothing caught it because vision_extract had never been
   drained -- it was missing from every worker's --kinds list, so the one
   model call a USER can trigger was also the only one never exercised.

   The assertion is deliberately about the WIRE, not the types: tsc is happy
   either way once the type is widened, but only the transport can prove an
   array left as an array. */
{
  const seen = [];
  const transport = async (_cfg, body) => {
    seen.push(body);
    return { ok: true, status: 200, json: {
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    } };
  };

  const parts = [
    { type: "text", text: "Read the analytics figures in this screenshot." },
    { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
  ];
  await callModel({
    cfg: { baseUrl: "https://x/v1", apiKey: "k", model: "m" },
    system: "s", user: parts, schema: { type: "object" }, transport,
  });

  const userMsg = seen[0].messages.find((m) => m.role === "user");
  check("a content array reaches the transport as an array, not a string",
    Array.isArray(userMsg.content));
  check("the image part survives with its data URL intact",
    userMsg.content[1]?.image_url?.url === "data:image/png;base64,iVBORw0KGgo=");
  check("a plain string prompt is still sent as a plain string",
    typeof seen[0].messages.find((m) => m.role === "system").content === "string");

  // The vision preamble must not be the narration one: HOUSE_RULES opens by
  // telling the model it was handed a table of figures, which is false for a
  // screenshot and instructs it to report nothing.
  seen.length = 0;
  await callModel({
    cfg: { baseUrl: "https://x/v1", apiKey: "k", model: "m" },
    system: "s", user: parts, schema: { type: "object" },
    houseRules: VISION_HOUSE_RULES, transport,
  });
  const sys = seen[0].messages.find((m) => m.role === "system").content;
  check("houseRules overrides the narration preamble for image calls",
    sys.includes("transcribe") && !sys.includes("table of figures"));
  check("the vision preamble keeps the arithmetic rule",
    /never calculate, convert, expand, round, or infer/i.test(sys));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
