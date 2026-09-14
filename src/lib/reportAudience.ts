/**
 * What the audience said, for the client report.
 *
 * The document had numbers about the client's videos and nothing about the
 * people watching them, while the system held merged comment themes for every
 * client and per-post counts of questions, purchase intent and confusion.
 * This puts them on the page, under the same counting discipline the app
 * uses: a theme's count is the set of comment ids the model returned and the
 * system verified, and the denominator is the DISTINCT union of those sets --
 * a comment carrying two themes is counted once.
 *
 * SCOPED TO THE PERIOD WHEN IT CAN BE. Themes are stored per client over all
 * time, but a monthly report is about a month, so each theme is re-counted
 * over the comments posted inside the period. A month with too few themed
 * comments to say anything -- a client whose comment route only just came
 * online, say -- falls back to all time, and the page says so. A thin month
 * must never be padded with history and called the month.
 *
 * Pure. The builder feeds it rows; the document draws whatever comes back.
 */
import type { ReportPeriod } from "@/lib/clientReport";

export type ThemeRow = {
  label: string;
  sentiment: string | null;
  /** Verified comment ids, from merged_themes.comment_ids. */
  commentIds: string[];
  postCount: number;
};

export type CommentRef = { id: string; publishedAt: string | null; postId?: string };

export type AudienceTheme = {
  label: string;
  sentiment: "positive" | "neutral" | "negative" | null;
  comments: number;
  posts: number;
};

export type AudienceSignals = {
  analysed: number;
  questions: number;
  intent: number;
  confusion: number;
  mentions: number;
};

export type ReportAudience = {
  /** Which comments the theme counts cover. */
  scope: "period" | "all";
  scopeNote: string;
  themes: AudienceTheme[];
  /** Distinct themed comments in scope -- the honest denominator. */
  distinctComments: number;
  /** Themed comments by sentiment, in scope. Distinct within each bucket. */
  sentiment: { positive: number; neutral: number; negative: number };
  /** Per-post counters rolled up across the client's analysed comments, all time. */
  signals: AudienceSignals | null;
};

/** Below this the period cannot support a themes list and all time is used. */
export const MIN_PERIOD_THEMED = 10;
export const TOP_THEMES = 8;

function normSentiment(s: string | null): AudienceTheme["sentiment"] {
  return s === "positive" || s === "neutral" || s === "negative" ? s : null;
}

function inPeriod(c: CommentRef, period: ReportPeriod): boolean {
  if (!c.publishedAt) return false;
  const d = c.publishedAt.slice(0, 10);
  return d >= period.start && d <= period.end;
}

/**
 * Re-count every theme over a set of allowed comment ids, drop the empties,
 * rank by count, and compute the distinct denominator over what survives.
 */
function countOver(themes: ThemeRow[], allowed: Set<string> | null, postOf: Map<string, string>) {
  const counted = themes
    .map((t) => {
      const ids = allowed ? t.commentIds.filter((id) => allowed.has(id)) : t.commentIds;
      // Posts counted from the comments actually in scope, so "3 comments
      // across 14 videos" cannot happen: 3 comments sit on at most 3 videos.
      // Falls back to the stored all-time figure only when the comment ->
      // post map is unavailable.
      const known = ids.map((id) => postOf.get(id)).filter((x): x is string => !!x);
      const posts = known.length ? new Set(known).size : Math.min(t.postCount, ids.length);
      return { t, ids, posts };
    })
    .filter((x) => x.ids.length > 0)
    .sort((a, b) => b.ids.length - a.ids.length || a.t.label.localeCompare(b.t.label));

  const distinct = new Set<string>();
  const bySentiment = { positive: new Set<string>(), neutral: new Set<string>(), negative: new Set<string>() };
  for (const { t, ids } of counted) {
    for (const id of ids) {
      distinct.add(id);
      const s = normSentiment(t.sentiment);
      if (s) bySentiment[s].add(id);
    }
  }
  return { counted, distinct, bySentiment };
}

export function buildAudience(input: {
  themes: ThemeRow[];
  comments: CommentRef[];
  signals: AudienceSignals | null;
  period: ReportPeriod;
  periodLabel: string;
}): ReportAudience | null {
  const periodIds = new Set(input.comments.filter((c) => inPeriod(c, input.period)).map((c) => c.id));
  const postOf = new Map(input.comments.filter((c) => c.postId).map((c) => [c.id, c.postId!]));

  let scope: ReportAudience["scope"] = "period";
  let result = countOver(input.themes, periodIds, postOf);
  if (result.distinct.size < MIN_PERIOD_THEMED) {
    scope = "all";
    result = countOver(input.themes, null, postOf);
  }

  const hasSignals = input.signals != null && input.signals.analysed > 0;
  if (result.counted.length === 0 && !hasSignals) return null;

  const themes: AudienceTheme[] = result.counted.slice(0, TOP_THEMES).map(({ t, ids, posts }) => ({
    label: t.label,
    sentiment: normSentiment(t.sentiment),
    comments: ids.length,
    posts,
  }));

  const scopeNote = scope === "period"
    ? `Themes are counted over comments posted in ${input.periodLabel}.`
    : `Fewer than ${MIN_PERIOD_THEMED} themed comments were posted in ${input.periodLabel}, so themes are counted since tracking began.`;

  return {
    scope,
    scopeNote,
    themes,
    distinctComments: result.distinct.size,
    sentiment: {
      positive: result.bySentiment.positive.size,
      neutral: result.bySentiment.neutral.size,
      negative: result.bySentiment.negative.size,
    },
    signals: hasSignals ? input.signals : null,
  };
}

/**
 * The one sentence the page opens with, from the strongest thing it can say.
 * Signals first (a question count is a concrete ask), then the leading theme.
 */
export function audienceLead(a: ReportAudience): string {
  if (a.signals) {
    const parts: string[] = [];
    if (a.signals.questions > 0) parts.push(`${a.signals.questions} question${a.signals.questions === 1 ? "" : "s"}`);
    if (a.signals.intent > 0) parts.push(`${a.signals.intent} signal${a.signals.intent === 1 ? "" : "s"} of intent to buy`);
    if (parts.length) return `Across ${a.signals.analysed.toLocaleString("en-GB")} analysed comments, your audience left ${parts.join(" and ")}.`;
  }
  const top = a.themes[0];
  if (top) {
    return `"${top.label}" is what your audience talked about most: ${top.comments} of ${a.distinctComments} themed comments.`;
  }
  return "What your audience said.";
}
