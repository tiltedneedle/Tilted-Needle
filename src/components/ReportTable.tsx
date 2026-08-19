"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Download } from "lucide-react";
import { PlatformChips } from "@/components/PlatformReach";
import { toCsv, downloadCsv, datedName } from "@/lib/exportCsv";
import { reportToCsv, type Report } from "@/lib/reports";

/**
 * One table that renders any Report (PRD v0.5 §5). It takes DATA, never
 * functions -- columns are `{key, label, kind}` and cells are
 * `{text, sort}` -- so a server component can hand it a finished report
 * across the RSC boundary without the runtime crash that function props
 * cause on session-gated pages (build and tsc never catch that one).
 *
 * Sorting happens here rather than in the URL: it changes nothing about
 * which rows exist, so it does not belong in the shareable filter state.
 */
/**
 * A row with nothing in it under the current filters.
 *
 * Derived rather than flagged upstream, because "empty" is a property of the
 * VIEW, not of the person: the same row is blank under one filter and full
 * under another, so a field on the data would be wrong half the time.
 *
 * Reads the numeric cells only. A text cell always has content -- the name --
 * so counting it would make every row non-blank.
 */
function isBlank(row: Report["rows"][number]): boolean {
  if (row.platforms.length > 0) return false;
  return Object.values(row.cells).every(
    (c) => c.sort === 0 || c.sort === "" || c.text === "—" || typeof c.sort === "string",
  );
}

export default function ReportTable({ report }: { report: Report }) {
  const [sort, setSort] = useState(report.defaultSort);

  const rows = [...report.rows].sort((a, b) => {
    const av = a.cells[sort.key]?.sort ?? 0;
    const bv = b.cells[sort.key]?.sort ?? 0;
    const cmp =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
    return sort.dir === "asc" ? cmp : -cmp;
  });

  function toggle(key: string) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : // A newly picked column starts on the reading that answers the
          // question people actually ask: biggest first for numbers, A–Z
          // for names.
          { key, dir: report.columns.find((c) => c.key === key)?.kind === "text" ? "asc" : "desc" },
    );
  }

  function exportCsv() {
    const { headers, rows: csvRows } = reportToCsv({ ...report, rows });
    downloadCsv(datedName(report.csvPrefix), toCsv(headers, csvRows));
  }

  if (report.rows.length === 0) {
    return (
      <div className="empty">{report.empty}</div>
    );
  }

  const sortable = report.columns.filter((c) => c.kind !== "platforms");

  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs text-[var(--muted)]">{report.note}</p>
        <button
          onClick={exportCsv}
          className="flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--fg)]"
          title="One row per entity per platform, matching what is on screen"
        >
          <Download size={13} />
          Export CSV
        </button>
      </div>

      <div className="card animate-rise overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                {report.columns.map((c) => {
                  const active = sort.key === c.key;
                  const alignRight = c.kind !== "text";
                  return (
                    <th
                      key={c.key}
                      className={`px-3 py-2 font-medium ${alignRight ? "text-right" : ""}`}
                      title={c.hint}
                      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                    >
                      {sortable.some((s) => s.key === c.key) ? (
                        <button
                          onClick={() => toggle(c.key)}
                          className={`inline-flex items-center gap-1 transition-colors hover:text-[var(--fg)] ${
                            active ? "text-[var(--accent)]" : ""
                          }`}
                        >
                          {c.label}
                          {active &&
                            (sort.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                        </button>
                      ) : (
                        c.label
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody className="divide-y divide-[var(--border)]">
              {rows.map((r) => (
                /**
                 * A person with nothing in the current filter recedes.
                 *
                 * Ten rows of em-dashes and "nothing published" were taking
                 * up most of the table and crowding out the four people who
                 * actually did something -- the eye has to work to find the
                 * data because the noise is the same weight as the signal.
                 *
                 * Dimmed rather than hidden, and it lifts to full on hover.
                 * Their absence from a filter is itself information ("nobody
                 * on the team touched TikTok in June"), so removing the rows
                 * would answer a different question than the one asked.
                 */
                <tr
                  key={r.id}
                  className={`transition-[background-color,opacity] hover:bg-[var(--bg-subtle)] ${
                    isBlank(r) ? "opacity-45 hover:opacity-100" : ""
                  }`}
                >
                  {report.columns.map((c) => {
                    /* A blank ROW drops its dashes; a blank CELL keeps one.
                       In a row that has data, a dash marks the one figure
                       that is missing, which is exactly what a dash is for.
                       In a row with nothing at all, six dashes just restate
                       "nothing published" six more times -- with ten
                       inactive people that was a sixty-dash wall under the
                       table, and the eye reads walls, not rows. The name and
                       the chip say everything the row has to say. */
                    if (c.kind === "platforms") {
                      return (
                        <td key={c.key} className="px-3 py-2.5">
                          <PlatformChips
                            platforms={r.platforms.map((p) => ({
                              platform: p.platform,
                              views: p.views,
                            }))}
                            emptyText="nothing published"
                          />
                        </td>
                      );
                    }
                    const cell = r.cells[c.key];
                    if (isBlank(r) && c.key !== "label") {
                      return <td key={c.key} className="px-3 py-2.5" />;
                    }
                    const isLabel = c.key === "label";
                    return (
                      <td
                        key={c.key}
                        className={`px-3 py-2.5 ${c.kind === "number" ? "tabular text-right" : ""} ${
                          cell?.tone === "muted" ? "text-[var(--muted)]" : ""
                        } ${cell?.tone === "up" ? "text-emerald-500" : ""}`}
                      >
                        {isLabel && r.href ? (
                          <Link
                            href={r.href}
                            className="font-medium transition-colors hover:text-[var(--accent)]"
                          >
                            {cell?.text}
                          </Link>
                        ) : (
                          (cell?.text ?? "—")
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>

            {report.totals && (
              <tfoot>
                <tr className="border-t-2 border-[var(--border)] bg-[var(--bg-subtle)] font-medium">
                  {report.columns.map((c) => {
                    if (c.kind === "platforms") {
                      return (
                        <td key={c.key} className="px-3 py-2.5">
                          <PlatformChips
                            platforms={report.totals!.platforms.map((p) => ({
                              platform: p.platform,
                              views: p.views,
                            }))}
                            emptyText="—"
                          />
                        </td>
                      );
                    }
                    if (c.key === "label") {
                      return (
                        <td key={c.key} className="px-3 py-2.5">
                          {report.totals!.label}
                        </td>
                      );
                    }
                    const cell = report.totals!.cells[c.key];
                    return (
                      <td
                        key={c.key}
                        className={`px-3 py-2.5 ${c.kind === "number" ? "tabular text-right" : ""} ${
                          cell?.tone === "muted" ? "text-[var(--muted)]" : ""
                        } ${cell?.tone === "up" ? "text-emerald-500" : ""}`}
                      >
                        {cell?.text ?? "—"}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </>
  );
}
