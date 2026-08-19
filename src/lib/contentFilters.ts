import { OPERATING_TZ, operatingDate } from "@/lib/tz";
/**
 * The Content page's filter state, parsed from the URL -- pure and
 * dependency-free so Node's native loader can test it directly (the same
 * reasoning as todoParse.ts).
 *
 * PRD v0.5 §2.1: a filter state is a DECLARATIVE SET, never a sequence.
 * This function is where that promise is kept mechanically: it maps a bag
 * of query params to a canonical state object, so any two URLs carrying
 * the same constraints -- in any parameter order, any comma order, with
 * any junk mixed in -- parse to the identical state. Order-independence
 * is proven by permutation tests, not assumed.
 *
 * Malformed values degrade to "unset", never throw: a shared link with a
 * mangled date must open the page wide, not crash it.
 */

export type ContentFilterState = {
  clientIds: string[];
  personIds: string[];
  /**
   * Role SLUGS, not ids -- so a shared link keeps meaning something in a
   * workspace whose roles are different rows with the same names.
   */
  roleSlugs: string[];
  platform: string | null;
  status: string | null;
  q: string | null;
  /** Inclusive Dubai dates, YYYY-MM-DD. Either side may be open. */
  from: string | null;
  to: string | null;
  videoId: string | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;

function validDate(s: string | undefined | null): string | null {
  if (!s || !DATE_RE.test(s)) return null;
  // Reject impossible calendar dates ("2026-02-31") the regex lets through.
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

/** Comma-joined ids -> deduped, empties dropped, ORDER NORMALISED (sorted). */
function parseIdList(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))].sort();
}

const opDate = (d: Date): string => operatingDate(d);

/**
 * Every URL param that NARROWS the page, in one list.
 *
 * Exported so callers can ask "is this view filtered at all?" without
 * reimplementing the question and drifting from the parser. `video` is
 * deliberately absent: it opens one video's detail rather than narrowing the
 * list, and `period` is the legacy shim, which parseFilters translates into
 * `from` before anyone downstream sees it.
 */
export const FILTER_KEYS = [
  "client",
  "person",
  "role",
  "platform",
  "status",
  "q",
  "from",
  "to",
  "period",
] as const;

export function parseFilters(
  sp: Record<string, string | undefined>,
  now: Date = new Date(),
): ContentFilterState {
  let from = validDate(sp.from);
  let to = validDate(sp.to);
  // An inverted range is a typo, not a request for nothing: swap it.
  if (from && to && from > to) [from, to] = [to, from];

  // Legacy shim: pre-v0.5 links carried period=30|90|365 (days back from
  // today). They keep working, translated to an open-ended from.
  if (!from && !to && sp.period) {
    const days = Number(sp.period);
    if (Number.isFinite(days) && days > 0 && days <= 3650) {
      from = opDate(new Date(now.getTime() - days * DAY_MS));
    }
  }

  return {
    clientIds: parseIdList(sp.client),
    personIds: parseIdList(sp.person),
    // parseIdList, not a bespoke parse: it dedupes and SORTS, which is what
    // keeps the order-independence guarantee true for this dimension too.
    // Unknown slugs are left in and simply match nothing downstream -- this
    // module is dependency-free and cannot know a workspace's roles.
    roleSlugs: parseIdList(sp.role),
    platform: sp.platform?.trim() || null,
    status: ["published", "unpublished", "boosting"].includes(sp.status ?? "")
      ? sp.status!
      : null,
    q: sp.q?.trim() || null,
    from,
    to,
    videoId: sp.video?.trim() || null,
  };
}

export type RangePreset =
  | "today"
  | "7d"
  | "14d"
  | "week"
  | "month"
  | "lastmonth"
  | "all";

/**
 * Preset -> inclusive Dubai date range. Deterministic given `now`, which
 * is what makes it testable; the UI passes the real clock.
 */
export function rangeForPreset(
  preset: RangePreset,
  now: Date = new Date(),
): { from: string | null; to: string | null } {
  const today = opDate(now);
  const back = (days: number) => opDate(new Date(now.getTime() - days * DAY_MS));

  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "7d":
      return { from: back(6), to: today };
    case "14d":
      return { from: back(13), to: today };
    case "week": {
      // Monday 00:00 Dubai, same convention as startOfWeek/the To-dos sheet.
      const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
      return { from: back(dow), to: today };
    }
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "lastmonth": {
      const [y, m] = today.split("-").map(Number);
      const firstOfThis = new Date(Date.UTC(y, m - 1, 1));
      const lastOfPrev = new Date(firstOfThis.getTime() - DAY_MS);
      const first = `${lastOfPrev.toISOString().slice(0, 7)}-01`;
      return { from: first, to: lastOfPrev.toISOString().slice(0, 10) };
    }
    case "all":
      return { from: null, to: null };
  }
}

/** Which preset a from/to pair corresponds to, for showing the select's value. */
export function presetForRange(
  from: string | null,
  to: string | null,
  now: Date = new Date(),
): RangePreset | "custom" {
  if (!from && !to) return "all";
  for (const p of ["today", "7d", "14d", "week", "month", "lastmonth"] as const) {
    const r = rangeForPreset(p, now);
    if (r.from === from && r.to === to) return p;
  }
  return "custom";
}
