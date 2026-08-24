import Link from "next/link";
import { SectionHeading } from "@/components/Stat";
import type { ClientEvidence } from "@/lib/analysis/clientEvidence";
import type { HookPerformance } from "@/lib/analysis/hookTypes";

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
export type MergedThemeRow = {
  label: string;
  sentiment: string | null;
  commentCount: number;
  postCount: number;
  sourceCount: number;
};

/** Tier 3: what the audience was DOING, counted rather than interpreted. */
export type AudienceCounts = {
  analysed: number;
  filtered: number;
  questions: number;
  intent: number;
  mentions: number;
  confusion: number;
};

export default function ClientInsights({
  entries,
  themesByClient = new Map(),
  themeDenominators = new Map(),
  audienceByClient = new Map(),
  hooksByClient = new Map(),
}: {
  entries: { clientId: string; clientName: string; evidence: ClientEvidence }[];
  /** Client-level audience themes, merged across posts by the embedding
   *  layer. Counts are unions of VERIFIED comment ids -- see themeMerge.ts. */
  themesByClient?: Map<string, MergedThemeRow[]>;
  /** Total analysed comments per client, so every share has a denominator. */
  themeDenominators?: Map<string, number>;
  /** Tier 3 counters summed over the client's posts. */
  audienceByClient?: Map<string, AudienceCounts>;
  /** Hand-tagged hook types, scored against their siblings. */
  hooksByClient?: Map<string, HookPerformance[]>;
}) {
  if (entries.length === 0) {
    return (
      <div className="empty">
        No client has enough scored work yet to characterise.
      </div>
    );
  }

  const characterised = entries.filter((e) => e.evidence.splits !== null);
  const tooSmall = entries.filter((e) => e.evidence.splits === null);

  return (
    <>
      {/* The baseline framing ("1.0x means typical for them") is gone with
          the rest of the multiplier model. What each comparison ranks is
          unchanged -- which formats and platforms did better FOR THIS CLIENT
          -- but it is now described in plain terms rather than as a ratio
          against a median that moves as the account grows. */}
      <p className="mb-4 text-xs text-[var(--muted)]">
        What tended to do better for each client, ranked within their own
        library. These are associations over a small number of videos, never
        causes — the sample size sits beside every one.
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
                      {/* "Adjusted", not "Ratio". The raw ratio is still shown
                          beneath it, but the number given prominence is the
                          one that survives being wrong -- a per-client ratio
                          from three videos is mostly noise, and the number is
                          what gets remembered. */}
                      <th className="py-1.5 text-right font-medium">Adjusted</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {e.splits.map((s) => (
                      <tr key={s.id} className={s.state === "none" ? "text-[var(--muted)]" : ""}>
                        <td className="py-1.5 pr-3">
                          {s.label}
                          {s.state === "holds" && (
                            <span className="ml-1.5 whitespace-nowrap rounded px-1 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)] ring-1 ring-[var(--border)]">
                              agency-wide
                            </span>
                          )}
                        </td>
                        <td className="tabular py-1.5 pr-3 text-right">
                          {s.withMedian}×{" "}
                          <span className="text-xs text-[var(--muted)]">n={s.withN}</span>
                        </td>
                        <td className="tabular py-1.5 pr-3 text-right text-[var(--muted)]">
                          {s.withoutMedian}× <span className="text-xs">n={s.withoutN}</span>
                        </td>
                        <td
                          className={`tabular py-1.5 text-right font-medium ${
                            /* Colour is reserved for "acting". Colouring a raw
                               ratio was the old behaviour and it made noise
                               look like a result: at n=3 a 0.33x is routine,
                               and green or grey on it is a recommendation
                               nobody checked. */
                            s.state !== "acting"
                              ? "text-[var(--muted)]"
                              : (s.multiplier ?? 1) >= 1
                                ? "text-[var(--success)]"
                                : "text-[var(--danger)]"
                          }`}
                        >
                          {s.multiplier == null ? (
                            <span className="text-xs" title="Not enough clients contributed to test this">
                              not tested
                            </span>
                          ) : (
                            <>
                              {s.multiplier}×
                              <span className="ml-1 block text-[10px] font-normal text-[var(--muted)]">
                                raw {s.ratio}×
                                {s.pooledMultiplier != null
                                  ? ` · ${s.pooledMultiplier}× over ${s.contributingClients}`
                                  : ""}
                              </span>
                            </>
                          )}
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

            {/* What the audience was DOING, counted. Distinct from the themes
                below, which say what they talked ABOUT.

                Questions are the useful one and the PRD says why: unmet
                information demand is the next video's topic chosen by the
                audience rather than guessed. Purchase intent is the figure an
                agency can actually put in front of a client.

                Every rate carries its denominator, and the denominator is the
                SUBSTANTIVE set -- short reactions ("first", "W", a bare emoji)
                are excluded before counting, and the excluded count is shown
                too, because a rate whose denominator is hidden is not a
                measurement. */}
            {(() => {
              const a = audienceByClient.get(clientId);
              if (!a || a.analysed === 0) return null;
              const pct = (n: number) => Math.round((n * 100) / a.analysed);
              // "1 questions" is the kind of small wrongness that makes a
              // careful number look careless.
              const s = (n: number, one: string, many: string) => (n === 1 ? one : many);
              return (
                <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-[var(--border)] pt-3 text-xs">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
                    What they did
                  </span>
                  <span title="Comments that ask something. Unmet information demand: the next video's topic, chosen by the audience rather than guessed.">
                    <span className="tabular font-medium">{a.questions}</span>{" "}
                    <span className="text-[var(--muted)]">{s(a.questions, "question", "questions")} ({pct(a.questions)}%)</span>
                  </span>
                  <span title="Comments asking price, availability or how to book.">
                    <span className="tabular font-medium">{a.intent}</span>{" "}
                    <span className="text-[var(--muted)]">{s(a.intent, "buying signal", "buying signals")} ({pct(a.intent)}%)</span>
                  </span>
                  {a.mentions > 0 && (
                    <span title="Comments tagging someone else — the publicly visible cousin of a DM share.">
                      <span className="tabular font-medium">{a.mentions}</span>{" "}
                      <span className="text-[var(--muted)]">tagged {s(a.mentions, "a friend", "friends")}</span>
                    </span>
                  )}
                  {a.confusion > 0 && (
                    <span title="Comments saying they got lost. Ambiguous: confusion also drives rewatches, which platforms reward.">
                      <span className="tabular font-medium">{a.confusion}</span>{" "}
                      <span className="text-[var(--muted)]">said they were lost</span>
                    </span>
                  )}
                  <span className="text-[var(--muted)]">
                    of {a.analysed} substantive
                    {a.filtered > 0 ? ` · ${a.filtered} short ${s(a.filtered, "reaction", "reactions")} excluded` : ""}
                  </span>
                </div>
              );
            })()}

            {/* WHICH HOOKS WORK, from the tags a human applied.
                Ratios are against the client's OTHER hooks rather than
                against 1.0, because 1.0 is "this account's typical post"
                including every untagged one -- and a hook can only be judged
                against the alternatives that were actually on the table.

                Rows below the 8-video floor are shown greyed with their n
                rather than hidden. Hiding them would make a client with 30
                tagged videos look identical to one with none; showing them
                unmarked would invite reading a 3-video hook as a finding.
                Neither is descriptive, and this is a descriptive table -- it
                runs no test, so it must not look like the engine's output. */}
            {(hooksByClient.get(clientId)?.length ?? 0) > 0 && (
              <div className="mt-3 border-t border-[var(--border)] pt-3">
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
                  Which hooks land
                </p>
                <div className="flex flex-col gap-1">
                  {hooksByClient.get(clientId)!.map((h) => (
                    <div
                      key={h.hookType}
                      className={`flex items-baseline justify-between gap-3 text-xs ${
                        h.underpowered ? "text-[var(--muted)]" : ""
                      }`}
                    >
                      <span className="truncate">{h.label}</span>
                      <span className="flex shrink-0 items-baseline gap-2">
                        {h.ratio != null && !h.underpowered && (
                          <span
                            className={`tabular font-medium ${
                              h.ratio >= 1.15
                                ? "text-[var(--success)]"
                                : h.ratio <= 0.87
                                  ? "text-[var(--danger)]"
                                  : ""
                            }`}
                            title="Median index for this hook, divided by the median of this client's other tagged hooks."
                          >
                            {h.ratio.toFixed(2)}×
                          </span>
                        )}
                        <span className="tabular text-[var(--muted)]">
                          n={h.n}
                          {h.underpowered ? " · too few to rank" : ""}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-[var(--muted)]">
                  Against this client&apos;s other tagged hooks. Descriptive —
                  no significance test, so treat a gap as a lead, not a finding.
                </p>
              </div>
            )}

            {/* What the AUDIENCE says, merged across this client's posts.
                Each per-post analysis invents its own labels, so "how much is
                it", "Pricing?" and "what's the cost" were three orphan rows
                until the embedding layer merged them. The count beside each
                theme is a union of VERIFIED comment ids -- the model grouped,
                the system counted -- and the denominator is stated because a
                share against an unknown total is not a statement. */}
            {(themesByClient.get(clientId)?.length ?? 0) > 0 && (
              <div className="mt-3 border-t border-[var(--border)] pt-3">
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
                  What their audience says
                  {themeDenominators.get(clientId) ? (
                    <span className="ml-1.5 normal-case tracking-normal">
                      · {themeDenominators.get(clientId)} distinct comments grouped
                    </span>
                  ) : null}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {themesByClient.get(clientId)!.slice(0, 8).map((t) => (
                    <span
                      key={t.label}
                      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1 ring-[var(--border)]"
                      title={`${t.commentCount} comments across ${t.postCount} post${t.postCount === 1 ? "" : "s"}, merged from ${t.sourceCount} per-post theme${t.sourceCount === 1 ? "" : "s"}`}
                    >
                      {t.sentiment === "positive" ? (
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
                      ) : t.sentiment === "negative" ? (
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--danger)]" />
                      ) : (
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--muted)]" />
                      )}
                      {t.label}
                      <span className="tabular text-[var(--muted)]">{t.commentCount}</span>
                    </span>
                  ))}
                </div>
              </div>
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
