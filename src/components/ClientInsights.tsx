import Link from "next/link";
import { SectionHeading } from "@/components/Stat";
import type { ClientEvidence } from "@/lib/analysis/clientEvidence";

/**
 * What works, per client -- rendered from the computed evidence table with no
 * model involved (PRD-video-intelligence §5.3, §5.4).
 *
 * Deliberately readable on its own. The AI layer's job here is narration, and
 * narration is a convenience: the table is the finding. That ordering is also
 * the safety property, since a reader can check every number against the
 * sample size printed beside it.
 *
 * All figures are MEDIANS. A mean over social performance is dominated by
 * whichever video went viral -- it put one client's TikTok at "66.9x
 * baseline" when the typical post was at 0.97x. The peak is shown separately
 * so a real hit stays visible without pretending to be typical.
 */
export default function ClientInsights({
  entries,
}: {
  entries: { clientId: string; clientName: string; evidence: ClientEvidence }[];
}) {
  if (entries.length === 0) {
    return (
      <div className="card p-10 text-center text-sm text-[var(--muted)]">
        No client has enough scored work yet to characterise.
      </div>
    );
  }

  const characterised = entries.filter((e) => e.evidence.splits !== null);
  const tooSmall = entries.filter((e) => e.evidence.splits === null);

  return (
    <>
      <p className="mb-4 text-xs text-[var(--muted)]">
        Median performance against each account&rsquo;s own baseline, so 1.0×
        means &ldquo;typical for them&rdquo;. Comparisons are associations over a
        small library, never causes — the sample size sits beside every one.
      </p>

      <div className="space-y-6">
        {characterised.map(({ clientId, clientName, evidence: e }) => (
          <section key={clientId} className="card animate-rise p-4">
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Link
                href={`/content?client=${clientId}`}
                className="text-sm font-semibold transition-colors hover:text-[var(--accent)]"
              >
                {clientName}
              </Link>
              <span className="text-xs text-[var(--muted)]">
                {e.scoredCount} of {e.videoCount} videos scored
              </span>
            </div>

            {e.platformFit.length > 0 && (
              <div className="mb-3">
                <div className="mb-1 text-[11px] uppercase tracking-wide text-[var(--muted)]">
                  Platform fit
                </div>
                <div className="flex flex-wrap gap-2">
                  {e.platformFit.map((p) => (
                    <span
                      key={p.platform}
                      className="rounded bg-[var(--bg-subtle)] px-2 py-1 text-xs"
                      title={`Best single post: ${p.peakIndex}× — shown separately because one hit is not the typical case`}
                    >
                      <span className="capitalize">{p.platform}</span>{" "}
                      <span className="tabular font-medium">{p.medianIndex}×</span>{" "}
                      <span className="text-[var(--muted)]">
                        n={p.n} · peak {p.peakIndex}×
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {e.splits && e.splits.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                      <th className="py-1.5 pr-3 font-medium">Attribute</th>
                      <th className="py-1.5 pr-3 text-right font-medium">With</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Without</th>
                      <th className="py-1.5 text-right font-medium">Ratio</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {e.splits.map((s) => (
                      <tr key={s.label}>
                        <td className="py-1.5 pr-3">{s.label}</td>
                        <td className="tabular py-1.5 pr-3 text-right">
                          {s.withMedian}×{" "}
                          <span className="text-xs text-[var(--muted)]">n={s.withN}</span>
                        </td>
                        <td className="tabular py-1.5 pr-3 text-right text-[var(--muted)]">
                          {s.withoutMedian}× <span className="text-xs">n={s.withoutN}</span>
                        </td>
                        <td
                          className={`tabular py-1.5 text-right font-medium ${
                            s.ratio >= 1.3
                              ? "text-emerald-500"
                              : s.ratio <= 0.77
                                ? "text-[var(--muted)]"
                                : ""
                          }`}
                        >
                          {s.ratio}×
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {e.lengthHint && (
              <p className="mt-2 text-xs text-[var(--muted)]">
                Best quarter of their work runs{" "}
                <span className="tabular text-[var(--fg)]">{e.lengthHint.topMedian}s</span> at
                the median; the rest{" "}
                <span className="tabular text-[var(--fg)]">{e.lengthHint.restMedian}s</span>{" "}
                (n={e.lengthHint.n}).
              </p>
            )}

            {/* Limits are shown, never hidden: a gap in the data is itself
                information, and a reader who cannot see it will assume there
                isn't one. */}
            {e.notes.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {e.notes.map((n, i) => (
                  <li key={i} className="text-xs text-[var(--muted)]">
                    {n}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {tooSmall.length > 0 && (
        <section className="mt-6">
          <SectionHeading
            title="Not enough work yet"
            note="Characterising these would mean reporting a pattern the sample cannot carry"
          />
          <div className="card p-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
              {tooSmall.map(({ clientId, clientName, evidence }) => (
                <span key={clientId}>
                  {clientName}{" "}
                  <span className="tabular">({evidence.scoredCount} scored)</span>
                </span>
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
