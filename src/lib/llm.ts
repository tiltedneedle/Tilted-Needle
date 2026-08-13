/**
 * The model adapter (PRD-video-intelligence §7).
 *
 * Provider-agnostic by contract: base URL, key, and model name all come from
 * the environment, and the wire format targeted is OpenAI-compatible chat
 * completions, which every major provider speaks. Changing provider is a
 * config change, not a code change.
 *
 * Three rules are enforced here rather than left to each caller, because each
 * one is a way this product could quietly start lying to a paying client:
 *
 *   THE MODEL NARRATES, IT NEVER COMPUTES. Callers pass a table of figures
 *   the system worked out itself, and the system prompt forbids inventing or
 *   recalculating any of them. No prompt asks for a percentage, a ranking, or
 *   a judgement about what counts as a peak.
 *
 *   OUTPUT IS STRUCTURED OR IT IS NOTHING. Every response is validated against
 *   a schema before it can reach a screen. A response that fails twice is a
 *   failure, never raw prose rendered hopefully.
 *
 *   IDENTICAL INPUTS ARE NEVER PAID FOR TWICE. `digestOf` is stable across key
 *   order and whitespace, so the same facts under the same prompt version hit
 *   the cache rather than the API.
 *
 * The transport is injectable so every one of those rules is testable without
 * a network, a key, or a bill.
 */

export type LlmConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Optional separate model for image extraction (§2.1 Route B). */
  visionModel?: string;
};

export type LlmMessage = { role: "system" | "user"; content: string };

/** Minimal transport: whatever performs the HTTP call. Injected for tests. */
export type LlmTransport = (
  cfg: LlmConfig,
  body: Record<string, unknown>,
) => Promise<{
  ok: boolean;
  status: number;
  json?: unknown;
  text?: string;
}>;

export type LlmResult<T> = {
  data: T;
  inputTokens: number;
  outputTokens: number;
  model: string;
  /** True when the first response failed validation and a retry succeeded. */
  retried: boolean;
};

export type LlmErrorKind = "config" | "transport" | "schema" | "budget";

export class LlmError extends Error {
  // A plain field rather than a constructor parameter property: Node's
  // type-stripping loader erases types, it does not transform them, and a
  // parameter property is a transformation. The test suite runs through that
  // loader, so this is the difference between testable and not.
  kind: LlmErrorKind;

  constructor(message: string, kind: LlmErrorKind) {
    super(message);
    this.name = "LlmError";
    this.kind = kind;
  }
}

/* ---- Configuration -------------------------------------------------------- */

/**
 * Monthly token ceiling, defaulted in code rather than left to an env var.
 *
 * Both readers of LLM_MONTHLY_TOKEN_LIMIT treated absent as 0 and 0 as
 * "no limit". The variable is set nowhere -- not in Vercel, not in GitHub, not
 * in .env.example -- so the only guard against a runaway bill on the project's
 * one recurring cost was disabled everywhere, quietly, by default. A ceiling
 * that has to be opted into is not a ceiling.
 *
 * Two million is measured, not guessed: analyses to date average ~3,160 tokens
 * each, so a full pass over all 282 videos is ~890k. This allows roughly two
 * complete passes a month plus re-analysis as comments arrive, and still stops
 * a loop long before it becomes expensive.
 *
 * Setting the env var overrides it; setting it to 0 still means unlimited, for
 * a deliberate backfill.
 */
export const DEFAULT_LLM_MONTHLY_TOKEN_LIMIT = 2_000_000;

export function llmMonthlyTokenLimit(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.LLM_MONTHLY_TOKEN_LIMIT;
  if (raw === undefined || raw === "") return DEFAULT_LLM_MONTHLY_TOKEN_LIMIT;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_LLM_MONTHLY_TOKEN_LIMIT;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const baseUrl = env.LLM_BASE_URL;
  const apiKey = env.LLM_API_KEY;
  const model = env.LLM_MODEL;
  if (!baseUrl || !apiKey || !model) {
    const missing = [
      !baseUrl && "LLM_BASE_URL",
      !apiKey && "LLM_API_KEY",
      !model && "LLM_MODEL",
    ].filter(Boolean);
    throw new LlmError(`Missing ${missing.join(", ")}`, "config");
  }
  return { baseUrl, apiKey, model, visionModel: env.LLM_VISION_MODEL };
}

/* ---- Input digest --------------------------------------------------------- */

/**
 * A stable fingerprint of the exact inputs.
 *
 * Stability is the whole point: the same facts must produce the same digest
 * whatever order the object's keys happen to be in, so object key order is
 * normalised recursively before hashing. Without that, a harmless refactor
 * that reorders a literal would silently re-buy every analysis in the system.
 *
 * FNV-1a, chosen because it needs no crypto import and this is a cache key,
 * not a security boundary.
 */
export function digestOf(input: unknown): string {
  const canonical = JSON.stringify(sortDeep(input));
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // Length is mixed in so two different payloads colliding on the 32-bit hash
  // still differ in the key.
  return `${h.toString(16).padStart(8, "0")}-${canonical.length.toString(36)}`;
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, val]) => [k, sortDeep(val)]),
    );
  }
  return v;
}

/* ---- Schema validation ---------------------------------------------------- */

/**
 * A deliberately small JSON-Schema subset: type, required, properties, items,
 * enum. Enough to pin every shape this product asks for, small enough to read
 * in one sitting, and it brings no dependency onto the worker.
 *
 * Returns a list of problems; empty means valid.
 */
export function validate(value: unknown, schema: Record<string, unknown>, path = "$"): string[] {
  const problems: string[] = [];
  const type = schema.type as string | undefined;

  if (type === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return [`${path}: expected object, got ${describe(value)}`];
    }
    const obj = value as Record<string, unknown>;
    for (const key of (schema.required as string[] | undefined) ?? []) {
      if (!(key in obj)) problems.push(`${path}.${key}: required`);
    }
    const props = (schema.properties as Record<string, Record<string, unknown>>) ?? {};
    for (const [key, sub] of Object.entries(props)) {
      if (key in obj) problems.push(...validate(obj[key], sub, `${path}.${key}`));
    }
    return problems;
  }

  if (type === "array") {
    if (!Array.isArray(value)) return [`${path}: expected array, got ${describe(value)}`];
    const items = schema.items as Record<string, unknown> | undefined;
    if (items) value.forEach((v, i) => problems.push(...validate(v, items, `${path}[${i}]`)));
    return problems;
  }

  if (schema.enum) {
    const allowed = schema.enum as unknown[];
    if (!allowed.includes(value as never)) {
      return [`${path}: expected one of ${JSON.stringify(allowed)}, got ${JSON.stringify(value)}`];
    }
    return [];
  }

  if (type === "string" && typeof value !== "string") {
    return [`${path}: expected string, got ${describe(value)}`];
  }
  if (type === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
    return [`${path}: expected number, got ${describe(value)}`];
  }
  if (type === "integer" && !Number.isInteger(value)) {
    return [`${path}: expected integer, got ${describe(value)}`];
  }
  if (type === "boolean" && typeof value !== "boolean") {
    return [`${path}: expected boolean, got ${describe(value)}`];
  }
  return problems;
}

function describe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/* ---- The house system prompt ---------------------------------------------- */

/**
 * Prepended to every call. This is where "the model narrates, it never
 * computes" stops being a design note and becomes an instruction, and where
 * the vocabulary rule from §7.6 is enforced -- calling replay intensity
 * "retention" would put a false claim in a client report.
 */
export const HOUSE_RULES = [
  "You write for a marketing agency's internal analytics tool.",
  "",
  "You are given a table of figures the system has already computed.",
  "Write ONLY about what is in that table.",
  "Never calculate, re-derive, estimate, rank, or infer a number that is not",
  "given to you. If a figure you would need is absent, say it is not available",
  "rather than supplying one.",
  "",
  "Never describe replay or most-replayed data as 'retention', 'drop-off', or",
  "'where viewers left'. Replay intensity means a segment was re-watched. Only",
  "figures explicitly labelled as retention may be called retention.",
  "",
  "State sample sizes when they are given. Prefer plain sentences to hedging.",
  "Respond with JSON only, matching the requested schema exactly. No prose",
  "outside the JSON, and no markdown fences.",
].join("\n");

/* ---- The call ------------------------------------------------------------- */

const defaultTransport: LlmTransport = async (cfg, body) => {
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown;
  try { json = JSON.parse(text); } catch { /* reported as a transport error below */ }
  return { ok: res.ok, status: res.status, json, text };
};

/** Strip the markdown fences models add despite being told not to. */
export function extractJson(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : content).trim();
}

export async function callModel<T = unknown>({
  cfg,
  system,
  user,
  schema,
  maxTokens = 1500,
  temperature = 0.2,
  transport = defaultTransport,
  model,
}: {
  cfg: LlmConfig;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
  transport?: LlmTransport;
  model?: string;
}): Promise<LlmResult<T>> {
  const chosen = model ?? cfg.model;

  const attempt = async (messages: LlmMessage[]) => {
    const res = await transport(cfg, {
      model: chosen,
      messages,
      max_tokens: maxTokens,
      temperature,
      response_format: { type: "json_object" },
    });
    if (!res.ok) {
      const err = new LlmError(
        `provider returned ${res.status}: ${(res.text ?? "").slice(0, 200)}`,
        "transport",
      );
      // A quota refusal is NOT a bad job -- it is the same job at the wrong
      // moment. Gemini's free tier answers 429 once the daily allowance is
      // spent, and that allowance resets. Without this flag the worker spent
      // all four attempts inside one exhausted window and marked the job
      // FAILED PERMANENTLY, so a transient limit silently became a hole in
      // the corpus that nothing would ever refill.
      //
      // `blocked` is the signal the worker already understands: pause this
      // kind, leave the job pending, spend no attempt. Exactly what the
      // transcript path does when an IP is refused.
      if (res.status === 429 || res.status === 503) {
        (err as LlmError & { blocked?: boolean }).blocked = true;
      }
      throw err;
    }
    const body = res.json as
      | { choices?: { message?: { content?: string } }[]; usage?: Record<string, number> }
      | undefined;
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new LlmError("provider returned no message content", "transport");
    }
    return {
      content,
      inputTokens: body?.usage?.prompt_tokens ?? 0,
      outputTokens: body?.usage?.completion_tokens ?? 0,
    };
  };

  const messages: LlmMessage[] = [
    { role: "system", content: `${HOUSE_RULES}\n\n${system}` },
    { role: "user", content: user },
  ];

  const first = await attempt(messages);
  const problems = parseAndValidate<T>(first.content, schema);

  if (problems.errors.length === 0) {
    return {
      data: problems.value as T,
      inputTokens: first.inputTokens,
      outputTokens: first.outputTokens,
      model: chosen,
      retried: false,
    };
  }

  // One retry, telling the model exactly what was wrong. A second failure is a
  // failure: rendering unvalidated output would defeat the point of validating.
  const retry = await attempt([
    ...messages,
    { role: "user", content:
      `Your previous reply did not match the schema:\n${problems.errors.join("\n")}\n` +
      `Reply again with JSON only, matching the schema exactly.` },
  ]);
  const second = parseAndValidate<T>(retry.content, schema);
  if (second.errors.length > 0) {
    throw new LlmError(
      `response failed schema validation twice: ${second.errors.slice(0, 4).join("; ")}`,
      "schema",
    );
  }

  return {
    data: second.value as T,
    inputTokens: first.inputTokens + retry.inputTokens,
    outputTokens: first.outputTokens + retry.outputTokens,
    model: chosen,
    retried: true,
  };
}

function parseAndValidate<T>(content: string, schema: Record<string, unknown>): {
  value: T | null;
  errors: string[];
} {
  let value: unknown;
  try {
    value = JSON.parse(extractJson(content));
  } catch {
    return { value: null, errors: ["response was not valid JSON"] };
  }
  return { value: value as T, errors: validate(value, schema) };
}

/* ---- Budget --------------------------------------------------------------- */

export type BudgetState = {
  usedTokens: number;
  limitTokens: number;
  remaining: number;
  /** At or past the ceiling: callers must queue rather than spend. */
  exhausted: boolean;
  /** Past the warning line, for the admin panel. */
  warn: boolean;
};

/**
 * The LLM is the only paid line in the whole platform, which makes it the only
 * thing that can produce a surprise bill -- so it gets a hard stop rather than
 * a warning. `used` is summed from ai_analyses for the calendar month by the
 * caller; this function owns the arithmetic and the thresholds.
 */
export function budgetState(usedTokens: number, limitTokens: number): BudgetState {
  const remaining = Math.max(0, limitTokens - usedTokens);
  return {
    usedTokens,
    limitTokens,
    remaining,
    exhausted: limitTokens > 0 && usedTokens >= limitTokens,
    warn: limitTokens > 0 && usedTokens >= limitTokens * 0.8,
  };
}

export function assertWithinBudget(state: BudgetState): void {
  if (state.exhausted) {
    throw new LlmError(
      `monthly token ceiling reached (${state.usedTokens}/${state.limitTokens}); ` +
        `analyses will queue until it resets`,
      "budget",
    );
  }
}
