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
 * Set OPERATING_TZ in the environment. The default below is the fallback when
 * it is unset, and moving it reinterprets history -- so it is a decision, made
 * once, deliberately, rather than a value anyone edits in passing.
 */

/**
 * ASIA/KARACHI, and this changed from Asia/Dubai on 2026-08-19.
 *
 * The two layers disagreed about the same fact. Both workspaces declare
 * `timezone = 'Asia/Karachi'`, and the SQL side reads that column through
 * operating_today(ws) -- while the application, with OPERATING_TZ unset, fell
 * back to Asia/Dubai and bucketed every day, week and report period an hour
 * earlier. Nothing surfaced the conflict because each layer was internally
 * consistent; /data carried a banner about it that named the fix and waited.
 *
 * It was never academic: 56 of 443 posts fall on a different DAY under the two
 * zones and 9 fall in a different MONTH, including "The value of privacy." on
 * Ameerh Naran's TikTok, which sat in a July client report and belongs to
 * August.
 *
 * Karachi because it is the DECLARED value -- somebody set that column on both
 * workspaces on purpose, and the docstring above already noted the system is
 * used from Pakistan. Dubai was a default nobody chose.
 *
 * Changed here rather than by setting an env var: an env var fixes one
 * machine, and the deployed app would have gone on disagreeing with its own
 * database until somebody remembered Vercel. Setting OPERATING_TZ still works
 * and still wins.
 *
 * The stored dates were rebuilt to match -- see
 * scripts/backfill-publish-dates.mjs, which recomputes every publish day from
 * its instant.
 */
const FALLBACK = "Asia/Karachi";

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

/**
 * Render an instant in the VIEWER's zone.
 *
 * The hybrid rule in one function: a moment in time is shown where the person
 * reading it is, because "synced at 09:15" should mean 09:15 on their clock.
 * Falls back to the operating zone when we do not know yet -- a first visit,
 * or a browser that refused to say.
 *
 * Never use this to derive a DATE for grouping. A timestamp rendered in
 * London and the same timestamp rendered in Karachi are the same instant, but
 * `.slice(0, 10)` of the two would be different days, and that is precisely
 * the disagreement the workspace zone exists to prevent.
 */
export function formatInstant(
  iso: string | Date | null | undefined,
  viewerTz: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  const tz = viewerTz && isValidZone(viewerTz) ? viewerTz : OPERATING_TZ;
  return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: tz }).format(d);
}

/**
 * Short label naming the zone a shared figure was bucketed in, e.g. "Dubai".
 *
 * Shown next to weeks and periods. The point is not decoration: a UK manager
 * looking at "Week of 10-16 Aug" has no way to know whose Monday that is, and
 * silently showing them a Dubai week is how an approval covers hours the
 * submitter thought were in a different week.
 */
export function operatingZoneLabel(tz: string = OPERATING_TZ): string {
  const city = tz.split("/").pop() ?? tz;
  return city.replace(/_/g, " ");
}
