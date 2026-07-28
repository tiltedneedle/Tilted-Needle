/**
 * Client-side CSV export for whatever a dashboard is currently showing.
 *
 * Deliberately no server round-trip and no new API surface: the rows are
 * already in the browser, and the export must match what the user can see --
 * including every active filter -- rather than re-deriving it from parameters
 * and risking the two drifting apart.
 */

/** RFC 4180 quoting: wrap when the value could otherwise break the row. */
function cell(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}

export function downloadCsv(filename: string, csv: string) {
  // A BOM makes Excel read UTF-8 correctly; without it, accented names and
  // the multiplication sign in scores come out mangled.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** `content-2026-07-28.csv` — dated so successive exports do not overwrite. */
export function datedName(prefix: string): string {
  return `${prefix}-${new Date().toISOString().slice(0, 10)}.csv`;
}
