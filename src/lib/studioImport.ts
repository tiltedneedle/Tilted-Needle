/**
 * Parse a YouTube Studio (or TikTok) analytics export.
 *
 * This is how the owner-only numbers reach the system now that credential
 * flows are retired for good (PRD-video-intelligence §2.1, Route A): the
 * client exports their own report and someone drops the file in. A person
 * downloading a CSV is not an OAuth integration, and the data it carries --
 * impressions, click-through rate, average percentage viewed -- is exactly
 * what no public API will ever serve.
 *
 * Pure and dependency-free so it can be tested against real export shapes
 * without a database or a browser.
 *
 * Robustness matters more here than anywhere else in the codebase, because
 * the input is a file a human exported from a UI that changes: column names
 * differ by Studio version and locale, the first column is sometimes the
 * video id and sometimes a title, numbers carry thousands separators and
 * percent signs, and every export leads with a "Total" row that is not a
 * video. A parser that throws on any of that would push the work back onto
 * the person least able to fix it.
 */

/* ---- CSV ------------------------------------------------------------------ */

/** RFC 4180 reader: handles quoted fields, escaped quotes, and CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  // A BOM is what Excel writes and what breaks a naive header match.
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/* ---- Value coercion ------------------------------------------------------- */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();

/** "1,234" -> 1234; "" -> null. Never NaN: a bad cell is an absent value. */
export function toNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  const cleaned = raw.replace(/[,\s%]/g, "").trim();
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** A percentage cell ("4.85" or "4.85%") as a 0..1 fraction. */
export function toFraction(raw: string | undefined): number | null {
  const n = toNumber(raw);
  if (n == null) return null;
  // Studio writes percentages as numbers out of 100. Values above 100 are a
  // sign the column was misread, so they are refused rather than stored.
  if (n < 0 || n > 100) return null;
  // Rounded at the boundary rather than left as raw float division: 4.85/100
  // is 0.048499999999999995 in IEEE 754, and storing that means the noise
  // turns up later in comparisons, CSV re-exports and anything that prints a
  // raw value. Six places is 0.0001% resolution -- far finer than any
  // analytics platform reports.
  return Math.round((n / 100) * 1e6) / 1e6;
}

/** "0:35", "1:23:45", or plain seconds -> seconds. */
export function toSeconds(raw: string | undefined): number | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (s === "" || s === "-") return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  const parts = s.split(":").map((p) => Number(p.trim()));
  if (parts.some((p) => !Number.isFinite(p))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

/* ---- Column mapping ------------------------------------------------------- */

/**
 * Header aliases, most-specific first. Studio renames these between versions
 * and translates them by locale; matching on a normalised substring is what
 * keeps a January export and a July export both readable.
 */
const COLUMNS = {
  videoId: ["video", "content", "video id"],
  title: ["video title", "content title", "title"],
  views: ["views"],
  impressions: ["impressions"],
  ctr: ["impressions click through rate", "click through rate", "ctr"],
  avgViewSeconds: ["average view duration", "avg view duration"],
  avgViewedPct: ["average percentage viewed", "avg percentage viewed", "average view percentage"],
  watchTimeHours: ["watch time hours", "watch time"],
  subscribers: ["subscribers"],
} as const;

type ColumnKey = keyof typeof COLUMNS;

export function mapColumns(header: string[]): Partial<Record<ColumnKey, number>> {
  const normalised = header.map(norm);
  const out: Partial<Record<ColumnKey, number>> = {};

  for (const [key, aliases] of Object.entries(COLUMNS) as [ColumnKey, readonly string[]][]) {
    // Exact match wins; a substring match is the fallback, so "views" cannot
    // steal the column that is really "average percentage viewed".
    let idx = normalised.findIndex((h) => aliases.some((a) => h === a));
    if (idx === -1) {
      idx = normalised.findIndex((h) => aliases.some((a) => h.includes(a)));
    }
    if (idx !== -1) out[key] = idx;
  }
  return out;
}

/* ---- The parse ------------------------------------------------------------ */

export type StudioRow = {
  /** The 11-character YouTube id, when the export carried one. */
  videoId: string | null;
  title: string | null;
  views: number | null;
  impressions: number | null;
  /** 0..1 */
  ctr: number | null;
  avgViewSeconds: number | null;
  /** 0..1 — the single best summary of "did it hold them". */
  avgViewedPct: number | null;
  subscribersGained: number | null;
};

export type StudioParse = {
  rows: StudioRow[];
  /** Which recognised columns were found, for the confirmation screen. */
  columns: ColumnKey[];
  /** Human-readable problems. Never thrown: the caller shows them. */
  problems: string[];
  /** The export's own Total line, kept out of rows but reported. */
  totalRow: StudioRow | null;
};

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function parseStudioExport(text: string): StudioParse {
  const problems: string[] = [];
  const table = parseCsv(text);
  if (table.length === 0) {
    return { rows: [], columns: [], problems: ["The file is empty."], totalRow: null };
  }

  const header = table[0];
  const cols = mapColumns(header);
  const found = Object.keys(cols) as ColumnKey[];

  if (cols.videoId == null && cols.title == null) {
    problems.push(
      "No video column found. Export from Studio > Analytics > Advanced mode, " +
        "with Video as the primary dimension.",
    );
    return { rows: [], columns: found, problems, totalRow: null };
  }
  if (cols.impressions == null && cols.ctr == null && cols.avgViewedPct == null) {
    problems.push(
      "This export has no owner-only columns (impressions, click-through rate, " +
        "or average percentage viewed) — the public numbers are already synced, " +
        "so importing it would add nothing.",
    );
  }

  const at = (row: string[], key: ColumnKey) =>
    cols[key] != null ? row[cols[key]!] : undefined;

  const rows: StudioRow[] = [];
  let totalRow: StudioRow | null = null;

  for (let i = 1; i < table.length; i++) {
    const raw = table[i];
    const idCell = (at(raw, "videoId") ?? "").trim();
    const titleCell = (at(raw, "title") ?? "").trim();

    const parsed: StudioRow = {
      videoId: VIDEO_ID.test(idCell) ? idCell : null,
      title: titleCell || null,
      views: toNumber(at(raw, "views")),
      impressions: toNumber(at(raw, "impressions")),
      ctr: toFraction(at(raw, "ctr")),
      avgViewSeconds: toSeconds(at(raw, "avgViewSeconds")),
      avgViewedPct: toFraction(at(raw, "avgViewedPct")),
      subscribersGained: toNumber(at(raw, "subscribers")),
    };

    // Every Studio export leads with a channel-wide Total. It is real data but
    // it is not a video, and importing it against some unlucky post would be
    // the single most misleading thing this parser could do.
    if (/^total$/i.test(idCell) || /^total$/i.test(titleCell)) {
      totalRow = parsed;
      continue;
    }

    if (!parsed.videoId) {
      // Rows without an id cannot be matched to a post. Reported, not dropped
      // silently -- a title-only export is a real thing people will try.
      continue;
    }
    rows.push(parsed);
  }

  const matchable = rows.length;
  if (matchable === 0 && problems.length === 0) {
    problems.push(
      "No rows carried an 11-character video id. In Studio's export, keep the " +
        "'Video' column — a title alone cannot be matched to a post.",
    );
  }

  const idless = table.length - 1 - matchable - (totalRow ? 1 : 0);
  if (idless > 0) {
    problems.push(`${idless} row${idless === 1 ? "" : "s"} had no usable video id and were skipped.`);
  }

  return { rows, columns: found, problems, totalRow };
}
