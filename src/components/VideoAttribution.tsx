import { isNotable, type VideoAttribution as Attribution } from "@/lib/analysis/videoAttribution";

/**
 * How this video sat against its own stablemates, and what it shares with
 * them.
 *
 * The heading is a question and the body never answers it with "because".
 * Every row is a comparison the reader completes: this video is 15-30s; the
 * client's 15-30s videos ran at 1.8x, the rest at 1.1x, on n=12 and n=31.
 * That is a fact about a corpus. Whether the length caused anything is not
 * something this data can say, and the footnote says so rather than leaving
 * the reader to assume otherwise.
 */
export default function VideoAttribution({ data }: { data: Attribution }) {
  if (data.index == null) {
    return (
      <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
        <h2 className="text-sm font-semibold">How this one landed</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Not scored yet — a video needs a few posts of history on its account
          before it can be compared to anything.
        </p>
      </section>
    );
  }

  const vs = data.vsClient;
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">How this one landed</h2>
        {vs != null && (
          <span className="text-xs text-[var(--muted)]">
            <span
              className={`tabular font-medium ${
                vs >= 1.15
                  ? "text-[var(--success)]"
                  : vs <= 0.87
                    ? "text-[var(--danger)]"
                    : ""
              }`}
            >
              {vs.toFixed(2)}×
            </span>{" "}
            this client&apos;s median, over {data.cohort} scored videos
          </span>
        )}
      </div>

      {data.nothingComparable ? (
        /* Said out loud, because an empty list reads as "nothing distinguishes
           this video" when the truth is "not enough comparable videos yet". */
        <p className="mt-2 text-xs text-[var(--muted)]">
          Nothing to compare it against yet. Every attribute this video has
          appears on fewer than 8 of the client&apos;s scored videos — or on
          nearly all of them — so no split has two usable sides. Tagging more
          hooks is the fastest way to change that.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-col gap-1">
            {data.rows.map((r) => {
              const notable = isNotable(r);
              return (
                <div
                  key={r.key}
                  className={`flex items-baseline justify-between gap-3 text-xs ${
                    r.underpowered ? "text-[var(--muted)]" : ""
                  }`}
                >
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--muted)]">
                      {r.family}
                    </span>
                    <span className="truncate">{r.label}</span>
                  </span>
                  <span className="flex shrink-0 items-baseline gap-2">
                    <span className="tabular text-[var(--muted)]">
                      {r.medianWith.toFixed(2)}× vs {r.medianWithout.toFixed(2)}×
                    </span>
                    <span
                      className={`tabular font-medium ${
                        notable
                          ? r.ratio > 1
                            ? "text-[var(--success)]"
                            : "text-[var(--danger)]"
                          : ""
                      }`}
                      title="Median of this client's videos WITH this attribute, divided by the median of those without."
                    >
                      {r.ratio.toFixed(2)}×
                    </span>
                    <span className="tabular text-[var(--muted)]">
                      n={r.nWith}/{r.nWithout}
                      {r.underpowered ? " · too few" : ""}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>

          {/* The disclaimer is load-bearing, not boilerplate. Without it a
              coloured 1.8x beside "Question hook" is read as a cause. */}
          <p className="mt-2 border-t border-[var(--border)] pt-2 text-[11px] text-[var(--muted)]">
            Associations within this client&apos;s own corpus, not causes.
            Videos sharing an attribute also share a week, a topic and an
            editor. No significance test is run here — the workspace engine on
            the Insights tab is what tests whether something holds in general.
          </p>
        </>
      )}
    </section>
  );
}
