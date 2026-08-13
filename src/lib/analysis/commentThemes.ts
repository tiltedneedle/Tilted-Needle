/**
 * Comment themes and sentiment (PRD-video-intelligence §5.3).
 *
 * The split that makes this trustworthy: the MODEL assigns labels, the SYSTEM
 * does the counting.
 *
 * Clustering free text into themes is a language task and genuinely belongs to
 * a model. Counting how many comments landed in each cluster is arithmetic,
 * and §7.2 forbids the model doing arithmetic — so the model returns the
 * comment ids it grouped, and every number on screen is computed here by
 * counting them. A model that claims "47 people asked about pricing" while
 * listing four ids gets a theme of four, and the discrepancy is recorded.
 *
 * That is not defensive padding. It is the difference between a report whose
 * numbers are checkable and one whose numbers are a language model's
 * impression of numbers.
 */

export const COMMENT_THEMES_SCHEMA = {
  type: "object",
  required: ["themes", "overallSentiment"],
  properties: {
    // "neutral" belongs here because the per-theme enum below already allows
    // it. Without it the two disagreed, and the model -- reasonably -- used
    // the same word for both: half of all analyse jobs died on
    // `$.overallSentiment: expected one of ["positive","mixed","negative"]`
    // and were marked permanently failed. "mixed" is not a synonym; a thread
    // of flat "first" comments is neutral, not mixed.
    overallSentiment: { type: "string", enum: ["positive", "mixed", "neutral", "negative"] },
    themes: {
      type: "array",
      items: {
        type: "object",
        required: ["label", "sentiment", "commentIds"],
        properties: {
          label: { type: "string" },
          sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
          commentIds: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

export type CommentInput = {
  id: string;
  text: string;
  likeCount: number | null;
};

export type ModelThemes = {
  overallSentiment: "positive" | "mixed" | "neutral" | "negative";
  themes: { label: string; sentiment: "positive" | "neutral" | "negative"; commentIds: string[] }[];
};

export type ThemeResult = {
  label: string;
  sentiment: "positive" | "neutral" | "negative";
  /** Counted here, from ids that actually exist. Never taken from the model. */
  count: number;
  /** Share of the comments that were sent for analysis. */
  share: number;
  exampleIds: string[];
};

export type CommentAnalysis = {
  overallSentiment: "positive" | "mixed" | "neutral" | "negative";
  themes: ThemeResult[];
  analysedCount: number;
  /** Comments the model placed in no theme at all. */
  unthemedCount: number;
  /** Problems worth surfacing rather than hiding. */
  problems: string[];
};

/** Comments are truncated and capped so one viral thread cannot blow a budget. */
export const MAX_COMMENTS = 300;
export const MAX_COMMENT_CHARS = 400;

/**
 * The evidence the model is given. Ids are short indices rather than UUIDs:
 * a UUID costs ~15 tokens and buys nothing, and shorter ids mean more actual
 * comments fit in the same budget.
 */
export function buildEvidence(comments: CommentInput[]): {
  prompt: string;
  idMap: Map<string, string>;
  sent: CommentInput[];
} {
  // Most-liked first: if the cap bites, it should keep the comments the
  // audience itself surfaced rather than whichever the API returned first.
  const ranked = [...comments].sort((a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0));
  const sent = ranked.slice(0, MAX_COMMENTS);

  const idMap = new Map<string, string>();
  const lines = sent.map((c, i) => {
    const shortId = `c${i + 1}`;
    idMap.set(shortId, c.id);
    const text = c.text.replace(/\s+/g, " ").trim().slice(0, MAX_COMMENT_CHARS);
    return `${shortId}: ${text}`;
  });

  return { prompt: lines.join("\n"), idMap, sent };
}

export const SYSTEM_PROMPT = [
  "Group the comments below into themes.",
  "",
  "For each theme give a short label (2-4 words), a sentiment, and the list of",
  "comment ids belonging to it. Use ONLY the ids given. Do not count anything:",
  "the ids are the evidence and the totals are computed from them.",
  "Every comment may appear in at most one theme; comments that fit no theme",
  "are simply left out.",
  "Prefer few, meaningful themes over many thin ones. Group complaints",
  "together rather than splitting them: they are the actionable ones.",
].join("\n");

/**
 * Turn the model's grouping into counted results.
 *
 * Every id is checked against what was actually sent. A hallucinated id is
 * dropped and reported; a duplicate across themes is kept only in the first,
 * so shares always sum to at most 1.
 */
export function tallyThemes(model: ModelThemes, idMap: Map<string, string>): CommentAnalysis {
  const problems: string[] = [];
  const claimed = new Set<string>();
  const themes: ThemeResult[] = [];
  const analysed = idMap.size;

  let invented = 0;
  let duplicated = 0;

  for (const t of model.themes) {
    const real: string[] = [];
    for (const shortId of t.commentIds) {
      const realId = idMap.get(shortId);
      if (!realId) { invented++; continue; }
      if (claimed.has(realId)) { duplicated++; continue; }
      claimed.add(realId);
      real.push(realId);
    }
    // A theme with nothing real behind it is not a finding.
    if (real.length === 0) continue;
    themes.push({
      label: t.label.trim().slice(0, 60),
      sentiment: t.sentiment,
      count: real.length,
      share: analysed > 0 ? real.length / analysed : 0,
      exampleIds: real.slice(0, 3),
    });
  }

  if (invented > 0) {
    problems.push(`${invented} comment id${invented === 1 ? "" : "s"} referenced by the model did not exist and were dropped.`);
  }
  if (duplicated > 0) {
    problems.push(`${duplicated} comment${duplicated === 1 ? "" : "s"} appeared in more than one theme; kept in the first.`);
  }

  // Biggest first: the reader's question is "what are people mostly saying".
  themes.sort((a, b) => b.count - a.count);

  return {
    overallSentiment: model.overallSentiment,
    themes,
    analysedCount: analysed,
    unthemedCount: Math.max(0, analysed - claimed.size),
    problems,
  };
}

/**
 * A one-line summary for `platform_posts.comment_sentiment`, the column that
 * has existed since the first content migration and has never been written to.
 */
export function summaryLine(a: CommentAnalysis): string {
  if (a.themes.length === 0) return `${a.overallSentiment}, no clear themes`;
  const top = a.themes.slice(0, 3).map((t) => `${t.label} (${t.count})`).join(", ");
  return `${a.overallSentiment} — ${top}`;
}
