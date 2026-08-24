import type { TopicTrend, TopicContext } from "@/lib/analysis/topicVelocity";

/**
 * What the slate is drifting towards, and what it is drifting away from.
 *
 * THE CONTEXT LINE IS NOT DECORATION. On this corpus output rose 15.57x
 * between the two windows, and against that every topic's raw count is up.
 * A reader who does not know the slate exploded will read "Lifestyle: 97
 * videos, up from 7" as a topic decision when it is mostly a volume
 * decision. So the workspace change is stated first, in the same units, and
 * the per-topic figures are explicitly shares of it.
 *
 * Tagging coverage is stated for the same reason: it is 37% now against 57%
 * before, so the shares are drawn from differently-representative samples and
 * a reader is entitled to know that before trusting a 1.37x.
 */
export default function TopicVelocity({
  trends,
  context,
  windowDays,
}: {
  trends: TopicTrend[];
  context: TopicContext;
  windowDays: number;
}) {
  const ranked = trends.filter((t) => !t.underpowered && t.outputRatio != null);
  const thin = trends.filter((t) => t.underpowered || t.outputRatio == null);
  if (!trends.length) return null;

  const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n * 100)}%`);

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
      <h2 className="text-sm font-semibold">Where the slate is moving</h2>
      <p className="mt-0.5 text-xs text-[var(--muted)]">
        Last {windowDays} days against the {windowDays} before.
      </p>

      {/* Stated before any per-topic number, because it reframes all of them. */}
      <p className="mt-2 rounded bg-[var(--bg-subtle)] px-2 py-1.5 text-xs text-[var(--muted)]">
        Output overall:{" "}
        <span className="tabular font-medium text-[var(--fg)]">
          {context.recentTotal}
        </span>{" "}
        videos vs{" "}
        <span className="tabular font-medium text-[var(--fg)]">
          {context.priorTotal}
        </span>
        {context.volumeRatio != null && (
          <>
            {" "}
            (<span className="tabular">{context.volumeRatio.toFixed(2)}×</span>)
          </>
        )}
        . Topic figures below are <strong>shares of that slate</strong>, so a
        topic can grow in count and still be losing ground.
        {context.recentCoverage != null && context.priorCoverage != null && (
          <>
            {" "}Labelled: {pct(context.recentCoverage)} vs{" "}
            {pct(context.priorCoverage)}.
          </>
        )}
      </p>

      {ranked.length > 0 ? (
        <div className="mt-3 flex flex-col gap-1">
          {ranked.map((t) => {
            const diverging =
              t.tractionRatio != null && t.outputRatio != null
              && t.outputRatio > 1.15 && t.tractionRatio < 0.87;
            return (
              <div key={t.topic} className="flex items-baseline justify-between gap-3 text-xs">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate">{t.topic}</span>
                  {diverging && (
                    <span
                      className="shrink-0 rounded bg-[var(--danger)] px-1 py-0.5 text-[10px] text-white"
                      title="More of the slate, less traction — the audience is not following the shift."
                    >
                      more output, less traction
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-baseline gap-2">
                  <span className="tabular text-[var(--muted)]">
                    {pct(t.priorShare)} → {pct(t.recentShare)}
                  </span>
                  <span
                    className={`tabular font-medium ${
                      t.status === "rising"
                        ? "text-[var(--success)]"
                        : t.status === "falling"
                          ? "text-[var(--danger)]"
                          : ""
                    }`}
                    title="This topic's share of tagged output now, divided by its share before."
                  >
                    {t.outputRatio!.toFixed(2)}×
                  </span>
                  {t.tractionRatio != null && (
                    <span
                      className="tabular text-[var(--muted)]"
                      title="Median performance index now, divided by before."
                    >
                      traction {t.tractionRatio.toFixed(2)}×
                    </span>
                  )}
                  <span className="tabular text-[var(--muted)]">
                    n={t.recentCount}/{t.priorCount}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-3 text-xs text-[var(--muted)]">
          No topic has enough labelled videos in both windows to compare yet.
        </p>
      )}

      {/* Named rather than hidden. A topic that appeared this period is a real
          editorial event, and dropping it from the list because it has no
          prior window to divide by would hide exactly the new thing. */}
      {thin.length > 0 && (
        <p className="mt-2 border-t border-[var(--border)] pt-2 text-[11px] text-[var(--muted)]">
          Too few to compare:{" "}
          {thin.map((t, i) => (
            <span key={t.topic}>
              {i > 0 && ", "}
              {t.topic}
              <span className="opacity-70">
                {" "}
                ({t.status === "new"
                  ? "new"
                  : t.status === "dropped"
                    ? "none this period"
                    : `${t.recentCount}/${t.priorCount}`})
              </span>
            </span>
          ))}
          .
        </p>
      )}
    </section>
  );
}
