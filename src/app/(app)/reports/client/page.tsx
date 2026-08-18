import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { buildClientReport, monthPeriod } from "@/lib/buildClientReport";
import PageHeader from "@/components/PageHeader";
import PlatformIcon from "@/components/PlatformIcon";
import { Empty } from "@/components/Stat";
import { AlertTriangle } from "lucide-react";
import PrintReportButton from "@/components/PrintReportButton";

/**
 * The monthly client report, for any client and any month.
 *
 * Everything on this page is either measured or declared missing. Half of a
 * full report is audience data no public API serves and Instagram never will
 * -- followers, reach, demographics -- which reaches the system only when
 * somebody types it into the period sheet on Data sync and confirms it. Where
 * that has not happened the section says so in words.
 *
 * That refusal is the feature. A generated report that prints zeros for the
 * numbers nobody entered looks finished, and gets sent.
 */
export const metadata = { title: "Client report" };

const N = (n: number | null | undefined) =>
  n == null ? null : n.toLocaleString("en-GB");

function Figure({ value, label }: { value: number | null; label: string }) {
  return (
    <div className="min-w-[120px]">
      <div className="numeral text-[28px] leading-[1.05]">
        {N(value) ?? <span className="text-[16px] text-[var(--muted)]">not recorded</span>}
      </div>
      <div className="mt-1 text-[10.5px] font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
        {label}
      </div>
    </div>
  );
}

export default async function ClientReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const supabase = await createClient();
  const sp = await searchParams;
  const ws = session.active.id;

  const { data: clientRows } = await supabase
    .from("clients")
    .select("id, name")
    .eq("workspace_id", ws)
    .is("deleted_at", null)
    .eq("is_archived", false)
    .order("name");
  const clients = (clientRows ?? []) as { id: string; name: string }[];

  const now = new Date();
  const clientId = sp.client ?? clients[0]?.id;
  const year = Number(sp.year) || now.getUTCFullYear();
  const month = Number(sp.month) || now.getUTCMonth() + 1;
  const report = clientId ? await buildClientReport(ws, clientId, year, month) : null;

  // Twelve months back and three forward: a report is usually written for the
  // month just gone, occasionally re-issued for an older one, and the forward
  // months exist so choosing one shows an honest empty rather than being
  // impossible to ask for.
  const months = Array.from({ length: 16 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 3 - i, 1));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
  });

  const href = (over: { client?: string; year?: number; month?: number }) =>
    `/reports/client?${new URLSearchParams({
      client: over.client ?? clientId ?? "",
      year: String(over.year ?? year),
      month: String(over.month ?? month),
    })}`;

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <div className="no-print">
        <PageHeader
          title="Client report"
          subtitle="Everything here is measured or declared missing. Nothing is estimated."
        />
      </div>

      <div className="no-print card mb-5 flex flex-wrap items-center gap-2 p-3">
        <select
          className="input max-w-[240px] py-1.5 text-sm"
          defaultValue={clientId}
          name="client"
          // A plain form control, because this page is a document: no reason
          // to ship a client component to change two query parameters.
          disabled
        >
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="ml-auto">
          <PrintReportButton />
        </div>
        <div className="flex flex-wrap gap-1">
          {clients.slice(0, 8).map((c) => (
            <Link
              key={c.id}
              href={href({ client: c.id })}
              className={`rounded px-2 py-1 text-xs transition-colors ${
                c.id === clientId
                  ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                  : "text-[var(--muted)] hover:bg-[var(--bg-subtle)]"
              }`}
            >
              {c.name}
            </Link>
          ))}
        </div>
      </div>

      <div className="no-print card mb-5 flex flex-wrap gap-1 p-2">
        {months.map(({ y, m }) => (
          <Link
            key={`${y}-${m}`}
            href={href({ year: y, month: m })}
            className={`rounded px-2 py-1 text-xs transition-colors ${
              y === year && m === month
                ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                : "text-[var(--muted)] hover:bg-[var(--bg-subtle)]"
            }`}
          >
            {monthPeriod(y, m).label}
          </Link>
        ))}
      </div>

      {!report ? (
        <Empty>Pick a client to generate a report.</Empty>
      ) : (
        <>
          {/* The cover takes the first sheet on its own, as both real
              reports do. */}
          <section className="report-cover card mb-5 p-6 text-center">
            <div className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-[var(--muted)]">
              Social media performance report
            </div>
            <h2 className="numeral mt-2 text-[32px] leading-tight">{report.clientName}</h2>
            <div className="mt-1 text-sm text-[var(--muted)]">{report.periodLabel}</div>
            <div className="mt-1 text-xs text-[var(--muted)]">
              {report.period.start} to {report.period.end}
            </div>
          </section>

          {/* Refusals come before anything else. A report with a video missing
              looks complete, so this cannot be a footnote. */}
          {report.blockers.length > 0 && (
            <section className="no-print card mb-5 border-[var(--warn)]/40 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <AlertTriangle size={14} className="text-[var(--warn)]" />
                This report is not ready to send
              </div>
              <ul className="space-y-1.5">
                {report.blockers.map((b) => (
                  <li key={b.code + b.message} className="text-xs text-[var(--muted)]">
                    {b.message}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {report.sections.length === 0 && (
            <Empty>This client has no accounts set up, so there is nothing to report on.</Empty>
          )}

          {report.sections.map((s) => (
            <section key={s.platform} className="card mb-4 p-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <PlatformIcon platform={s.platform} size={15} />
                <h3 className="text-sm font-semibold">{s.platformLabel}</h3>
                <span className="text-xs text-[var(--muted)]">@{s.handle}</span>
              </div>

              <p className="mb-4 text-sm leading-relaxed">{s.narrative}</p>

              {s.metrics ? (
                <div className="mb-4 flex flex-wrap gap-6">
                  <Figure value={s.metrics.views} label="Views" />
                  <Figure value={s.metrics.likes} label="Likes" />
                  {s.platform.startsWith("youtube") ? (
                    <>
                      <Figure value={s.metrics.subscribers} label="Subscribers" />
                      <Figure value={s.metrics.netSubscribers} label="New subscribers" />
                    </>
                  ) : (
                    <>
                      <Figure value={s.metrics.followers} label="Followers" />
                      <Figure value={s.metrics.netFollowers} label="Net new followers" />
                    </>
                  )}
                  {s.metrics.reach != null && <Figure value={s.metrics.reach} label="Accounts reached" />}
                </div>
              ) : (
                /* Named precisely, with the fix, rather than left blank. */
                <p className="mb-4 rounded-[var(--radius-sm)] bg-[var(--bg-subtle)] px-3 py-2 text-xs text-[var(--muted)]">
                  No audience figures have been confirmed for @{s.handle} for this period. Views,
                  followers and reach come from the platform&apos;s own dashboard — add them on Data
                  sync and confirm the period, and this block fills in.
                </p>
              )}

              {s.top.length > 0 ? (
                <div>
                  <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
                    Top {s.top.length === 1 ? "video" : `${s.top.length} videos`} this period
                  </div>
                  <ol className="space-y-1.5">
                    {s.top.map((t, i) => (
                      <li key={t.postId} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                        <span className="tabular w-4 shrink-0 text-xs text-[var(--muted)]">{i + 1}</span>
                        {/* Verbatim: typos, curly quotes and emoji as posted. */}
                        <span className="min-w-0 flex-1 truncate">{t.title || "Untitled"}</span>
                        <span className="tabular shrink-0 text-xs">
                          {N(t.views)} views · {N(t.likes)} likes
                        </span>
                        {t.basis === "lifetime" && (
                          <span
                            className="shrink-0 rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]"
                            title="Published just before this period, with no earlier reading — its lifetime count stands in for what it earned inside."
                          >
                            lifetime
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              ) : (
                <p className="text-xs text-[var(--muted)]">
                  No video on this account could be measured inside this period.
                </p>
              )}

              {/* Never silently dropped: a video published on the 30th and
                  first scraped in August is real, and possibly the best of
                  the month. */}
              {s.unmeasurable.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-[var(--muted)]">
                    {s.unmeasurable.length} video{s.unmeasurable.length === 1 ? "" : "s"} could not be
                    measured for this period
                  </summary>
                  <ul className="mt-1.5 space-y-1">
                    {s.unmeasurable.map((u) => (
                      <li key={u.postId} className="text-xs text-[var(--muted)]">
                        {u.title || "Untitled"} —{" "}
                        {u.reason === "no-reading-by-period-end"
                          ? "first measured after the period ended"
                          : u.reason === "published-before-history"
                            ? "published before our readings begin, so its share of this period cannot be separated"
                            : "never measured"}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          ))}

          {report.sections.some((s) => s.metrics) && (
            <section className="card mb-4 p-5">
              <h3 className="mb-3 text-sm font-semibold">Across all platforms</h3>
              <div className="mb-3 flex flex-wrap gap-6">
                <Figure value={report.combined.views} label="Combined views" />
                <Figure value={report.combined.likes} label="Combined likes" />
              </div>
              {/* The caveat travels with the figure so no renderer can print
                  one without the other. */}
              <p className="text-xs leading-relaxed text-[var(--muted)]">{report.combined.caveat}</p>
            </section>
          )}

          <p className="px-1 text-xs leading-relaxed text-[var(--muted)]">{report.likesCaveat}</p>
        </>
      )}
    </div>
  );
}
