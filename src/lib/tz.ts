/**
 * The one timezone every date in this system is bucketed by.
 *
 * "Asia/Dubai" was written literally into six places across four files, each
 * with a comment calling it "the company's operating timezone". That was fine
 * while everyone sat in one office and fatal the moment they did not: the
 * system is used from Pakistan (UTC+5), where a video posted at 00:30 is filed
 * under YESTERDAY, "today" starts an hour late, and the week begins at Monday
 * 01:00 rather than midnight.
 *
 * WHY ONE TIMEZONE AND NOT THE VIEWER'S
 *
 * Tempting, and wrong for this product. Hours, weekly totals and "this week"
 * are shared facts: two teammates looking at the same timesheet must see the
 * same numbers, and a manager in London approving a week must be approving the
 * same week the editor in Karachi submitted. Per-viewer day boundaries would
 * make the same data disagree with itself depending on who asked, which is a
 * far worse bug than a boundary in the wrong place.
 *
 * The aggregation also happens on the server, where the viewer's timezone is
 * not knowable without shipping it in a cookie on every request -- so a
 * per-viewer model would be both wrong and expensive.
 *
 * So: one operating timezone for the workspace, set deliberately.
 *
 * HOW TO CHANGE IT
 *
 * Set OPERATING_TZ (e.g. "Asia/Karachi") in the environment. It defaults to
 * Asia/Dubai, which is what every existing figure was computed against -- a
 * silent default change would quietly reinterpret months of history, moving
 * posts between days and hours between weeks with nothing to show for it.
 * Changing it is a decision, so it is an explicit one.
 */

const FALLBACK = "Asia/Dubai";

/** True when the runtime actually knows this zone, so a typo cannot go live. */
function isValidZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function resolve(): string {
  // NEXT_PUBLIC_ so the same value is available if a client component ever
  // needs to format a date the same way the server bucketed it.
  const raw =
    process.env.NEXT_PUBLIC_OPERATING_TZ?.trim() ||
    process.env.OPERATING_TZ?.trim() ||
    "";
  if (!raw) return FALLBACK;
  if (!isValidZone(raw)) {
    // Loud, but not fatal: a bad zone must not take the whole app down, and
    // falling back silently is how you end up debugging a one-hour offset for
    // an afternoon.
    console.warn(`OPERATING_TZ="${raw}" is not a valid IANA zone; using ${FALLBACK}.`);
    return FALLBACK;
  }
  return raw;
}

/** IANA zone every day/week boundary in the system is measured in. */
export const OPERATING_TZ = resolve();

/** YYYY-MM-DD for an instant, in the operating timezone. */
export function operatingDate(d: Date, tz: string = OPERATING_TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
}

/**
 * The UTC instant of 00:00 on an operating-timezone date.
 *
 * Built by measuring the zone's offset at that moment rather than assuming a
 * fixed one. The old code could write the offset literally because Dubai is
 * UTC+4 year round with no DST -- true of Karachi too, but NOT of most zones
 * someone might reasonably set, and a hardcoded offset would put every
 * boundary an hour out for half the year in any of them.
 */
export function startOfOperatingDay(dateISO: string, tz: string = OPERATING_TZ): Date {
  // Start from the naive UTC midnight, then correct by the zone's offset at
  // that instant. One correction is enough: an offset changes by at most a
  // couple of hours, so the corrected instant lands on the same local date.
  const naive = new Date(`${dateISO}T00:00:00Z`);
  const offsetMs = zoneOffsetMs(naive, tz);
  return new Date(naive.getTime() - offsetMs);
}

/** Milliseconds the operating zone is ahead of UTC at a given instant. */
export function zoneOffsetMs(at: Date, tz: string = OPERATING_TZ): number {
  // Formatting the same instant as if it were UTC, then reading it back as
  // UTC, yields the local wall-clock as an instant -- the difference is the
  // offset. Avoids a DST table and works for any zone.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  // Intl renders midnight as hour 24 in some runtimes; normalise it.
  const hour = get("hour") % 24;
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}
