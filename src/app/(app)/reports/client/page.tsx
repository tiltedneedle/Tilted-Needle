import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { buildClientReport, monthPeriod } from "@/lib/buildClientReport";
import PageHeader from "@/components/PageHeader";
import ReportDocument from "@/components/ReportDocument";
import PrintReportButton from "@/components/PrintReportButton";
import TemplatePicker from "@/components/TemplatePicker";
import { Empty } from "@/components/Stat";
import { AlertTriangle } from "lucide-react";

/**
 * The monthly client report, for any client and any month.
 *
 * The page is two things stacked: controls that never print, and a document
 * that is the only thing which does. Everything on the document is measured or
 * declared missing -- half a full report is audience data no public interface
 * serves and Instagram never will, so it arrives only when somebody enters and
 * confirms a period on Data sync.
 *
 * That refusal is the feature. A report printing zeros for numbers nobody
 * entered looks finished, and gets sent.
 */
export const metadata = { title: "Client report" };

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
  // month just gone, sometimes re-issued for an older one, and the forward
  // months exist so asking for one returns an honest empty rather than being
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
          subtitle="Every figure is measured or declared missing. Nothing is estimated."
        />

        <div className="card mb-3 flex flex-wrap items-center gap-2 p-3">
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
            Client
          </span>
          <div className="flex flex-wrap gap-1">
            {clients.map((c) => (
              <Link
                key={c.id}
                href={href({ client: c.id })}
                className={`rounded px-2 py-1 text-xs transition-colors ${
                  c.id === clientId
                    ? "bg-[var(--accent)]/15 font-medium text-[var(--accent)]"
                    : "text-[var(--muted)] hover:bg-[var(--bg-subtle)]"
                }`}
              >
                {c.name}
              </Link>
            ))}
          </div>
          <div className="ml-auto">
            <PrintReportButton />
          </div>
        </div>

        {/* Switching is free: a template selects a stylesheet and nothing
            else, so no figure can appear or vanish with the choice. The page
            re-renders on click, so this doubles as the preview rather than
            having a separate mode that can drift from what sends. */}
        {report && clientId && (
          <div className="card mb-3 flex flex-wrap items-center gap-2 p-3">
            <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
              Design
            </span>
            <TemplatePicker clientId={clientId} current={report.template} />
            <span className="text-[11px] text-[var(--muted)]">
              Saved per client — only changes how it looks, never what it says.
            </span>
          </div>
        )}

        <div className="card mb-5 flex flex-wrap items-center gap-2 p-3">
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
            Month
          </span>
          <div className="flex flex-wrap gap-1">
            {months.map(({ y, m }) => (
              <Link
                key={`${y}-${m}`}
                href={href({ year: y, month: m })}
                className={`rounded px-2 py-1 text-xs transition-colors ${
                  y === year && m === month
                    ? "bg-[var(--accent)]/15 font-medium text-[var(--accent)]"
                    : "text-[var(--muted)] hover:bg-[var(--bg-subtle)]"
                }`}
              >
                {monthPeriod(y, m).label}
              </Link>
            ))}
          </div>
        </div>

        {/* A warning to whoever is preparing the report, never part of what a
            client receives -- hence inside the no-print block rather than
            merely styled differently. */}
        {report && report.blockers.length > 0 && (
          <section className="card mb-5 border-[var(--warn)]/40 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <AlertTriangle size={14} className="text-[var(--warn)]" />
              Not ready to send
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

        {/* Videos the system holds but cannot place in this period. Shown to
            the operator, never printed: dropping them silently is how the
            month's best video goes missing from a document. */}
        {report && report.sections.some((s) => s.unmeasurable.length > 0) && (
          <details className="card mb-5 p-4">
            <summary className="cursor-pointer text-sm font-medium">
              {report.sections.reduce((n, s) => n + s.unmeasurable.length, 0)} video(s) could not be
              measured for this period
            </summary>
            <div className="mt-2 space-y-2">
              {report.sections
                .filter((s) => s.unmeasurable.length > 0)
                .map((s) => (
                  <div key={s.platform}>
                    <div className="text-xs font-medium">{s.platformLabel}</div>
                    <ul className="mt-1 space-y-0.5">
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
                  </div>
                ))}
            </div>
          </details>
        )}
      </div>

      {!report ? (
        <Empty>Pick a client to generate a report.</Empty>
      ) : report.sections.length === 0 ? (
        <Empty>This client has no accounts set up, so there is nothing to report on.</Empty>
      ) : (
        <ReportDocument report={report} />
      )}
    </div>
  );
}
