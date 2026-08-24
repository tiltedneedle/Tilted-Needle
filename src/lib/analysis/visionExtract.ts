/**
 * Read analytics numbers out of a screenshot (PRD-video-intelligence §2.1,
 * Route B).
 *
 * Instagram has no clean CSV export, but it does have a screen the client
 * already screenshots. This turns that into structured figures — and it is
 * the one place OCR belongs in this product, because it is the only route to
 * reach, saves and shares at all.
 *
 * THE OUTPUT IS ALWAYS A DRAFT. Nothing here writes to post_analytics. A
 * human confirms every value against the image before it is stored, which is
 * not ceremony: OCR misreads 1.2k as 12k, drops decimal points, and confuses
 * "reach" with "impressions" — and unlike a CSV, there is no header row to
 * check the mapping against. An unconfirmed number here would become a number
 * in a client report.
 *
 * The model is therefore asked to do exactly one thing it is good at:
 * transcribe what it can see, and say plainly when it cannot see something.
 * It is never asked to infer, convert, or fill a gap.
 */

export const VISION_SCHEMA = {
  type: "object",
  required: ["fields", "platform"],
  properties: {
    platform: { type: "string", enum: ["instagram", "tiktok", "youtube", "unknown"] },
    fields: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "rawText", "confidence"],
        properties: {
          // Constrained to what post_analytics and post_snapshots can hold.
          // A free-text name would arrive as "Accounts reached" one week and
          // "Reach" the next, and nothing downstream could map either.
          name: {
            type: "string",
            enum: [
              "views", "reach", "impressions", "likes", "comments",
              "shares", "saves", "ctrPercent", "avgViewedPercent", "avgViewSeconds",
            ],
          },
          rawText: { type: "string" },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
        },
      },
    },
  },
} as const;

/**
 * THE SHAPE IS SPELLED OUT HERE BECAUSE NOTHING ELSE TELLS THE MODEL IT.
 *
 * `callModel` sends `response_format: {type:"json_object"}` -- plain JSON
 * mode, not structured outputs -- so VISION_SCHEMA never reaches the
 * provider. It is a post-hoc validator, not a contract the model can see.
 * Asked only for "JSON matching the requested schema", the model returned a
 * perfectly reasonable flat map:
 *
 *     {"Views":"12,847","Accounts reached":"9,412","Impressions":"14.2K", ...}
 *
 * -- every figure transcribed correctly, and every one thrown away, because
 * the validator wanted {platform, fields:[{name,rawText,confidence}]}. The
 * extraction was right and the envelope was wrong.
 *
 * So the envelope is now shown rather than described, the label vocabulary is
 * given as an explicit mapping (screens say "Accounts reached", the database
 * says `reach`), and the enum values are written in the exact case the
 * validator demands -- the first live run failed on "Instagram" for want of a
 * lowercase i.
 */
export const VISION_PROMPT = [
  "Read the analytics figures visible in this screenshot.",
  "",
  "Transcribe ONLY what is legibly on screen. Give the text EXACTLY as shown,",
  "including any k/m suffix, comma, colon, decimal point or percent sign — do",
  "not expand, round, or convert anything.",
  "",
  "If a figure is cropped, blurred, or you are unsure which label it belongs",
  "to, mark its confidence low or leave it out entirely. Never estimate a",
  "number from a chart, and never infer one figure from another.",
  "Every value will be checked by a person against this image before it is",
  "stored, so an omission costs nothing and a guess costs a great deal.",
  "",
  "Reply with EXACTLY this shape and no other keys:",
  "",
  '{"platform":"instagram","fields":[',
  '  {"name":"views","rawText":"12,847","confidence":"high"},',
  '  {"name":"reach","rawText":"9,412","confidence":"high"}',
  "]}",
  "",
  '"platform" is one of: instagram, tiktok, youtube, unknown — lowercase.',
  '"confidence" is one of: low, medium, high — lowercase.',
  '"name" MUST be one of these ten, whatever wording the screen uses:',
  "",
  "  views              Views, Plays, Video views",
  "  reach              Reach, Accounts reached, Unique viewers",
  "  impressions        Impressions, Total views",
  "  likes              Likes",
  "  comments           Comments",
  "  shares             Shares, Sends, Reposts",
  "  saves              Saves, Bookmarks",
  "  ctrPercent         Click-through rate",
  "  avgViewedPercent   Average percent watched",
  "  avgViewSeconds     Average watch time, Average view duration",
  "",
  "Omit any of the ten that is not on screen. Never invent a name outside the",
  "list, and never merge two on-screen figures into one entry. Reach and",
  "impressions are different figures — if both are shown, report both.",
].join("\n");

export type VisionField = {
  name: string;
  rawText: string;
  confidence: "low" | "medium" | "high";
};

export type ExtractedValue = {
  name: string;
  rawText: string;
  /** Parsed number, or null when the text could not be read as one. */
  value: number | null;
  confidence: "low" | "medium" | "high";
  /** Set when the value should not be trusted without a closer look. */
  warning?: string;
};

/**
 * "1.2k" -> 1200, "3.4M" -> 3400000, "1,234" -> 1234.
 *
 * Suffix expansion is done HERE rather than by the model, deliberately. It is
 * arithmetic, the system owns arithmetic (§7.2), and it is also the single
 * most common OCR-adjacent error: a model asked to expand "1.2k" itself will
 * sometimes answer 12000.
 */
export function parseMetricText(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/,/g, "").replace(/\s/g, "");
  if (s === "") return null;

  const m = s.match(/^([0-9]*\.?[0-9]+)\s*([km])?%?$/);
  if (!m) return null;

  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;

  const mult = m[2] === "k" ? 1_000 : m[2] === "m" ? 1_000_000 : 1;
  const scaled = n * mult;
  // A suffixed figure is an approximation the platform itself rounded, so
  // keeping decimals of it would imply precision the source never had.
  return mult > 1 ? Math.round(scaled) : scaled;
}

/** Percentages arrive as "4.85%" and belong in the database as 0.0485. */
export function parsePercentText(raw: string): number | null {
  const n = parseMetricText(raw.replace("%", ""));
  if (n == null || n < 0 || n > 100) return null;
  return Math.round((n / 100) * 1e6) / 1e6;
}

/** "0:35" or "1:23:45" -> seconds. */
export function parseDurationText(raw: string): number | null {
  const s = raw.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  const parts = s.split(":").map((p) => Number(p.trim()));
  if (parts.length < 2 || parts.some((p) => !Number.isFinite(p))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

const PERCENT_FIELDS = new Set(["ctrPercent", "avgViewedPercent"]);
const DURATION_FIELDS = new Set(["avgViewSeconds"]);

/**
 * Turn the model's transcription into values a human can confirm.
 *
 * Every questionable case is flagged rather than dropped: the reviewer is
 * looking at the image, so they can settle it instantly — but only if the row
 * is in front of them. Silently discarding a low-confidence field would hide
 * the very thing worth checking.
 */
export function toExtractedValues(fields: VisionField[]): ExtractedValue[] {
  const seen = new Set<string>();
  const out: ExtractedValue[] = [];

  for (const f of fields) {
    const value = PERCENT_FIELDS.has(f.name)
      ? parsePercentText(f.rawText)
      : DURATION_FIELDS.has(f.name)
        ? parseDurationText(f.rawText)
        : parseMetricText(f.rawText);

    let warning: string | undefined;
    if (value == null) warning = "Could not read this as a number — type it in.";
    else if (f.confidence === "low") warning = "The model was unsure; check it against the image.";
    else if (seen.has(f.name)) warning = "This label appeared more than once on screen.";
    else if (/[km]$/i.test(f.rawText.trim())) {
      warning = `Shown rounded as "${f.rawText.trim()}" — stored as ${value?.toLocaleString()}.`;
    }

    seen.add(f.name);
    out.push({ name: f.name, rawText: f.rawText, value, confidence: f.confidence, warning });
  }

  // Anything needing attention floats to the top of the confirmation form.
  return out.sort((a, b) => (a.warning ? 0 : 1) - (b.warning ? 0 : 1));
}

/**
 * A screenshot is worth importing only if it carries something the public
 * APIs cannot already see. Views and likes are synced automatically; reach,
 * saves and CTR are not.
 */
export const OWNER_ONLY = new Set([
  "reach", "impressions", "saves", "shares", "ctrPercent",
  "avgViewedPercent", "avgViewSeconds",
]);

export function ownerOnlyCount(values: ExtractedValue[]): number {
  return values.filter((v) => OWNER_ONLY.has(v.name) && v.value != null).length;
}
