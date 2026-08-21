import { MessageSquare } from "lucide-react";

/**
 * What the comments on this video are actually saying.
 *
 * The analysis has been running and storing results for a while; nothing
 * rendered them. `ai_analyses` reached the UI in exactly one place -- the
 * screenshot drafts on this same page -- so twenty stored comment analyses
 * existed where nobody could see them, which is indistinguishable from the
 * feature not working.
 *
 * EVERY NUMBER HERE IS COUNTED, NOT CLAIMED. The model groups comment ids
 * into themes and does no arithmetic at all; the counts and shares are
 * computed from the ids afterwards, and any id it invents is dropped. So a
 * theme's size is a fact about the comments, not the model's impression of
 * them -- which is the only reason it is safe to print a percentage next to
 * a machine's opinion.
 */

type Theme = {
  label: string;
  sentiment: "positive" | "neutral" | "negative";
  count: number;
  share: number;
};

export type CommentThemeResult = {
  themes: Theme[];
  overallSentiment: "positive" | "mixed" | "neutral" | "negative";
  analysedCount: number;
  unthemedCount: number;
};

/* Sentiment gets a hue, but only through tokens -- the raw Tailwind palette
   bypasses the contrast gate, which is how text-emerald-500 sat at 2.47:1 in
   light mode across two dozen files. */
const TONE: Record<string, string> = {
  positive: "var(--success)",
  negative: "var(--danger)",
  neutral: "var(--muted)",
};

const OVERALL: Record<string, string> = {
  positive: "mostly positive",
  negative: "mostly negative",
  neutral: "flat",
  mixed: "genuinely split",
};

export default function CommentThemes({
  result,
}: {
  result: CommentThemeResult | null;
}) {
  if (!result || result.themes.length === 0) return null;

  const { themes, overallSentiment, analysedCount, unthemedCount } = result;
  const themed = analysedCount - unthemedCount;

  return (
    <section className="card mb-5 p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <MessageSquare size={15} className="shrink-0 text-[var(--muted)]" />
        <span className="text-sm font-semibold">What the comments say</span>
        <span className="text-xs text-[var(--muted)]">
          {OVERALL[overallSentiment] ?? overallSentiment}
        </span>
        {/* The denominator is stated because it is the honest limit of the
            finding: a theme covering 12 of 300 comments is a real theme and a
            small one, and hiding the 300 would let it read as the whole. */}
        <span className="ml-auto text-[11px] text-[var(--muted)]">
          {themed.toLocaleString()} of {analysedCount.toLocaleString()} comments grouped
        </span>
      </div>

      <div className="space-y-2">
        {themes.map((t) => (
          <div key={t.label} className="flex items-center gap-2.5">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: TONE[t.sentiment] ?? "var(--muted)" }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate text-sm">{t.label}</span>
            {/* A bar, not a pie: these shares do not sum to 1 -- comments
                that fit no theme are deliberately left out -- so anything
                implying a whole would be a lie about the data. */}
            <span
              className="hidden h-1.5 w-24 shrink-0 overflow-hidden rounded-full sm:block"
              style={{ background: "var(--bg-subtle)" }}
              aria-hidden="true"
            >
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.max(4, Math.round(t.share * 100))}%`,
                  background: TONE[t.sentiment] ?? "var(--muted)",
                }}
              />
            </span>
            <span className="tabular w-10 shrink-0 text-right text-xs text-[var(--muted)]">
              {t.count.toLocaleString()}
            </span>
          </div>
        ))}
      </div>

      {unthemedCount > 0 && (
        <p className="mt-3 text-[11px] leading-snug text-[var(--muted)]">
          {unthemedCount.toLocaleString()} comment{unthemedCount === 1 ? "" : "s"} fit no
          theme and {unthemedCount === 1 ? "is" : "are"} left out rather than forced into
          one — emoji, tags and one-word replies mostly.
        </p>
      )}
    </section>
  );
}
