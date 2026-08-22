/**
 * Tier 2: what a video IS, described once by a model and cached forever.
 *
 * One call per video on the cheap model -- roughly 400 tokens in, 60 out, so
 * the whole corpus costs about six cents -- through the same schema-validated
 * adapter and digest cache as every other model call here. A descriptor is
 * bought once; re-running is free until the transcript or the prompt changes.
 *
 * THE HOOK DESCRIPTOR IS THE POINT OF THIS FILE, and the least obvious thing
 * in it. A raw hook embedding encodes TOPIC, not style: "What's the best CRM
 * in 2026?" and "What's the best espresso grinder?" are the SAME opening move
 * and land far apart, while "Here's the best CRM" and "What's the best CRM?"
 * are DIFFERENT moves and land almost on top of each other. Cluster raw hooks
 * and you rediscover the topics the team already knows while missing styles --
 * which are the one thing they can change before the next shoot. So the
 * descriptor is topic-stripped BY CONSTRUCTION: the schema has nowhere to put
 * the subject matter except the `topic` field, which is kept separate and is
 * never part of the text that gets embedded.
 *
 * The emotional arc stores both valence and arousal, and AROUSAL is the one
 * that gets tested. Berger & Milkman (JMR 2012): high-arousal emotion travels
 * -- awe, anger, anxiety -- while sadness suppresses sharing no matter how
 * negative. Storing only "positive/negative" would test the wrong axis.
 */

export const DESCRIPTOR_PROMPT_VERSION = 1;

export const DESCRIPTOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["format", "hook", "promise", "arc", "claimType", "topic", "entities"],
  properties: {
    format: {
      type: "string",
      enum: ["talking_head", "listicle", "demo", "skit", "voiceover_broll", "interview", "text_on_screen"],
    },
    /**
     * The opening move, with the topic stripped out. Every field is a CLOSED
     * enum precisely so there is nowhere to smuggle subject matter back in --
     * a free-text "description" field would immediately fill up with topics
     * and quietly undo the whole construction.
     */
    hook: {
      type: "object",
      additionalProperties: false,
      required: ["openingMove", "subjectFrame", "addressee"],
      properties: {
        openingMove: {
          type: "string",
          enum: ["question", "claim", "command", "story_start", "result_first", "greeting", "scene_setting"],
        },
        subjectFrame: {
          type: "string",
          enum: ["viewer_problem", "creator_experience", "third_party", "product", "abstract_topic"],
        },
        addressee: { type: "string", enum: ["viewer_direct", "audience_general", "nobody"] },
      },
    },
    promise: {
      type: "object",
      additionalProperties: false,
      required: ["stated", "paidOffMs"],
      properties: {
        stated: { type: "boolean" },
        // Null when no promise was made, or it never paid off. -1 is not used:
        // a sentinel number would be summed into averages by accident.
        paidOffMs: { type: ["integer", "null"] },
      },
    },
    arc: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["at", "valence", "arousal"],
        properties: {
          at: { type: "string", enum: ["start", "mid", "end"] },
          valence: { type: "number", minimum: -1, maximum: 1 },
          arousal: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    claimType: { type: "string", enum: ["how_to", "opinion", "story", "reveal", "reaction"] },
    topic: { type: "string", maxLength: 80 },
    entities: { type: "array", maxItems: 10, items: { type: "string", maxLength: 60 } },
  },
} as const;

export const DESCRIPTOR_SYSTEM_PROMPT = [
  "You classify short marketing videos from their transcript and title.",
  "Every field describes HOW the video is made, not what it is about — the",
  "single exception is `topic`, which is where the subject matter goes and",
  "nowhere else.",
  "",
  /* THE SHAPE IS SPELLED OUT HERE because callModel validates against the
     schema but never sends it -- the schema parameter is a contract on the
     response, not part of the prompt. The first version of this prompt
     described the semantics and assumed the model would see the enums; it
     answered `format: "short"` and `addressee: "viewers"`, failed validation
     twice per job, and burned two calls each time. Every allowed value must
     appear below, verbatim. */
  "Respond with exactly this JSON shape, choosing only from the listed values:",
  "{",
  '  "format": "talking_head" | "listicle" | "demo" | "skit" | "voiceover_broll" | "interview" | "text_on_screen",',
  '  "hook": {',
  '    "openingMove": "question" | "claim" | "command" | "story_start" | "result_first" | "greeting" | "scene_setting",',
  '    "subjectFrame": "viewer_problem" | "creator_experience" | "third_party" | "product" | "abstract_topic",',
  '    "addressee": "viewer_direct" | "audience_general" | "nobody"',
  "  },",
  '  "promise": { "stated": true|false, "paidOffMs": <integer milliseconds or null> },',
  '  "arc": [',
  '    { "at": "start", "valence": <-1..1>, "arousal": <0..1> },',
  '    { "at": "mid",   "valence": <-1..1>, "arousal": <0..1> },',
  '    { "at": "end",   "valence": <-1..1>, "arousal": <0..1> }',
  "  ],",
  '  "claimType": "how_to" | "opinion" | "story" | "reveal" | "reaction",',
  '  "topic": "<subject matter, max 80 chars>",',
  '  "entities": ["<proper nouns said aloud, max 10>"]',
  "}",
  "",
  "hook.openingMove is the rhetorical move of the first seconds, judged as if",
  "the topic were replaced by a blank: 'What's the best ___?' is a question",
  "whatever fills the blank.",
  "promise.paidOffMs is when the opening's promise is delivered, in",
  "milliseconds from the start, read from the segment timings. Null if no",
  "promise was stated or it never pays off.",
  "arc is three (valence, arousal) readings at start, mid and end. Arousal is",
  "INTENSITY, not positivity: calm contentment is high valence, low arousal;",
  "outrage is low valence, high arousal.",
  "entities are proper nouns actually said aloud — brands, people, places.",
  "Do not infer entities that are merely implied.",
].join("\n");

export type HookDescriptor = {
  openingMove: string;
  subjectFrame: string;
  addressee: string;
};

/**
 * The text that gets embedded for archetype discovery.
 *
 * Rendered from the closed enums plus the COMPUTED structural features, and
 * deliberately never from `topic` or `entities` -- the whole reason the
 * descriptor exists is that those would drag the embedding back to subject
 * matter. Stable wording, because this string is a cache key for an embedding:
 * cosmetic rephrasing would re-buy the whole corpus.
 */
export function renderHookDescriptorText(
  hook: HookDescriptor,
  features: { hookHasQuestion: boolean | null; hookWordCount: number | null; wordsPerSecond: number | null },
): string {
  const pace = features.wordsPerSecond == null
    ? "unknown pace"
    : features.wordsPerSecond > 3.2 ? "fast delivery"
    : features.wordsPerSecond < 2.2 ? "slow delivery"
    : "measured delivery";
  const length = features.hookWordCount == null
    ? ""
    : features.hookWordCount > 55 ? ", dense opening"
    : features.hookWordCount < 30 ? ", sparse opening"
    : "";
  return `${hook.openingMove} opening, framing ${hook.subjectFrame}, addressing ${hook.addressee}, ${pace}${length}`;
}

/** What a descriptor call sends: transcript truncated to what the judgement
 *  needs. The hook is fully covered by 15s; format and arc need the shape of
 *  the whole thing but not every word of a long video. */
export function descriptorInput(
  title: string | null,
  segments: { start_ms: number; dur_ms: number; text: string }[],
): string {
  const lines = [`TITLE: ${title ?? "(none)"}`, "TRANSCRIPT:"];
  let chars = 0;
  for (const s of segments) {
    const line = `[${Math.round((s.start_ms ?? 0) / 1000)}s] ${s.text}`;
    // ~1600 tokens of transcript is plenty to judge format and arc; the cost
    // cap matters more than the tail of a long video.
    if (chars + line.length > 6000) { lines.push("[...truncated]"); break; }
    lines.push(line);
    chars += line.length;
  }
  return lines.join("\n");
}
