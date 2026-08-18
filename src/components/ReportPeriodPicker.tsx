"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarRange } from "lucide-react";

/**
 * Which stretch of time the report covers.
 *
 * Replaces a wall of sixteen month buttons, which was unreadable at a glance
 * and still could not express the window the agency's own reports actually
 * use: the live Entrée report measures 30 June to 30 July and prints that
 * range in its section headers. A month grid cannot say that.
 *
 * So: a month for the common case, and two dates for everything else. The
 * report itself has always stored an arbitrary inclusive range -- this is the
 * control finally catching up with the schema.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const pad = (n: number) => String(n).padStart(2, "0");

function monthEnd(year: number, month1: number): string {
  // Day 0 of the next month is the last day of this one, and doing it in UTC
  // keeps a machine in a negative offset from rolling back a day.
  const last = new Date(Date.UTC(year, month1, 0)).getUTCDate();
  return `${year}-${pad(month1)}-${pad(last)}`;
}

export default function ReportPeriodPicker({
  clientId,
  year,
  month,
  from,
  to,
}: {
  clientId: string;
  year: number;
  month: number;
  /** Set only when the current view is a custom range. */
  from?: string;
  to?: string;
}) {
  const router = useRouter();
  const custom = Boolean(from && to);
  const [open, setOpen] = useState(custom);
  const [start, setStart] = useState(from ?? `${year}-${pad(month)}-01`);
  const [end, setEnd] = useState(to ?? monthEnd(year, month));
  const [error, setError] = useState<string | null>(null);

  /**
   * The boxes follow the period, instead of freezing at whatever it was on
   * first render.
   *
   * useState only takes its argument once, so picking a month left the custom
   * inputs showing the ORIGINAL month -- and pressing Apply then navigated to
   * a range the user had not chosen and could see was wrong on screen. Reset
   * during render on a key rather than in an effect: an effect would paint the
   * stale values for a frame first, which is how the wrong dates get read and
   * believed.
   */
  const periodKey = `${from ?? ""}|${to ?? ""}|${year}-${month}`;
  const [lastKey, setLastKey] = useState(periodKey);
  if (periodKey !== lastKey) {
    setLastKey(periodKey);
    setStart(from ?? `${year}-${pad(month)}-01`);
    setEnd(to ?? monthEnd(year, month));
    setError(null);
  }

  const go = (params: Record<string, string>) =>
    router.push(`/reports/client?${new URLSearchParams({ client: clientId, ...params })}`);

  const now = new Date();
  // Twelve back and one forward. Reports are written for the month just gone,
  // occasionally reissued for an older one; the forward month exists so asking
  // for it returns an honest empty rather than being impossible to ask for.
  const recent = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1 - i, 1));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
  });

  function applyCustom() {
    if (!start || !end) return setError("Both dates are needed.");
    if (end < start) return setError("The end date is before the start date.");
    // The same ceiling the database enforces, so the refusal arrives here
    // rather than as a constraint violation after a round trip.
    const days = (Date.parse(end) - Date.parse(start)) / 86_400_000;
    if (days > 366) return setError("That range is longer than a year — check the years.");
    setError(null);
    go({ from: start, to: end });
  }

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
          Period
        </span>

        <select
          className="input max-w-[190px] py-1.5 text-sm"
          value={custom ? "" : `${year}-${month}`}
          onChange={(e) => {
            const [y, m] = e.target.value.split("-");
            go({ year: y, month: m });
          }}
          aria-label="Month"
        >
          {custom && <option value="">Custom range</option>}
          {recent.map(({ y, m }) => (
            <option key={`${y}-${m}`} value={`${y}-${m}`}>
              {MONTHS[m - 1]} {y}
            </option>
          ))}
        </select>

        <button
          type="button"
          className={`btn flex items-center gap-1.5 px-2.5 py-1 text-xs ${
            custom ? "border-[var(--accent)]/50 text-[var(--accent)]" : ""
          }`}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <CalendarRange size={12} />
          {custom ? `${from} → ${to}` : "Custom range"}
        </button>
      </div>

      {open && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">From</span>
            <input
              type="date"
              className="input py-1.5 text-sm"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">To</span>
            <input
              type="date"
              className="input py-1.5 text-sm"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          <button className="btn-primary px-2.5 py-1 text-xs" onClick={applyCustom}>
            Apply
          </button>
          {custom && (
            <button
              className="btn px-2.5 py-1 text-xs"
              onClick={() => go({ year: String(year), month: String(month) })}
            >
              Back to months
            </button>
          )}
          {/* Inclusive is stated, because a report covering "1 to 31" that
              silently excluded the 31st would be wrong in a way nobody checks. */}
          <span className="text-[11px] text-[var(--muted)]">
            Both dates included. The agency&apos;s own reports often run 30th to 30th.
          </span>
        </div>
      )}

      {error && (
        <p className="mt-1.5 text-xs text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
