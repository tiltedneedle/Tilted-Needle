"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Check } from "lucide-react";
import Select from "@/components/ui/Select";
import Popover from "@/components/ui/Popover";
import {
  presetForRange,
  rangeForPreset,
  type RangePreset,
} from "@/lib/contentFilters";

export type FilterDef = {
  /** Query-string key this control writes to. */
  key: string;
  label: string;
  /** Shown as the "no selection" option / the button's resting label. */
  allLabel: string;
  /** Single-select value (ignored when multi). */
  value?: string | null;
  /** Multi-select values (used when multi). */
  values?: string[];
  options: { value: string; label: string }[];
  /** True renders a chip multi-select; URL carries comma-joined ids. */
  multi?: boolean;
  /** Keys to clear when this one changes -- e.g. picking a client drops a
      video that belonged to a different client. */
  clears?: string[];
};

export type RangeValue = { from: string | null; to: string | null };

const PRESET_LABELS: { value: RangePreset; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "14d", label: "Last 2 weeks" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "lastmonth", label: "Last month" },
];

function rangeChipLabel(r: RangeValue): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    });
  if (r.from && r.to) return r.from === r.to ? fmt(r.from) : `${fmt(r.from)} – ${fmt(r.to)}`;
  if (r.from) return `from ${fmt(r.from)}`;
  if (r.to) return `until ${fmt(r.to)}`;
  return "All time";
}

/**
 * The navigation for the dashboards. Filters live in the query string
 * rather than component state so a filtered view is a URL: shareable,
 * bookmarkable, and survivable across a refresh -- and, per PRD v0.5,
 * a DECLARATIVE SET: the page renders f(population, constraints), so the
 * order controls were touched in cannot exist in the model at all.
 *
 * Multi-select dimensions (clients, people) write comma-joined ids; the
 * range control writes from/to (inclusive Dubai dates) and always clears
 * the legacy period= param it supersedes.
 *
 * Only the first `primaryCount` filters show by default; the rest sit
 * behind "More filters", which opens automatically if a hidden one
 * already has a value -- a filter that is doing something must never be
 * invisibly collapsed. A remainder of exactly one is never collapsed at
 * all: the button is as wide as the control it hides, so it saves no
 * space and costs a click.
 */
export default function FilterBar({
  basePath,
  filters,
  searchKey,
  searchValue,
  searchPlaceholder = "Search…",
  searchClears = [],
  range,
  rangeClears = [],
  preserveOnClear = [],
  primaryCount = 2,
}: {
  basePath: string;
  filters: FilterDef[];
  /** When set, renders a free-text box writing to this query key. */
  searchKey?: string;
  searchValue?: string | null;
  searchPlaceholder?: string;
  /** Keys a search clears -- e.g. a drill-down param the searched list view
      would otherwise sit invisibly beneath. */
  searchClears?: string[];
  /** When set, renders the time-range control bound to from/to params. */
  range?: RangeValue;
  rangeClears?: string[];
  /** Params "Clear all" keeps -- for state that is not a filter at all, like
      which report tab you are reading. Clearing filters must not navigate
      you off the thing you were looking at. */
  preserveOnClear?: string[];
  /** How many filters stay visible before the rest collapse. */
  primaryCount?: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  /**
   * Never collapse a single filter.
   *
   * "More filters" exists to keep a long row from crowding the page. Hiding
   * exactly one control does not do that -- it trades a visible filter for a
   * button of identical width, so the row is no shorter and there is now a
   * disclosure to learn, a click to spend, and a filter people do not know
   * exists. Content was doing precisely this: five filters, primaryCount 4.
   *
   * Two or more is a real saving and keeps the toggle. One is not, so it is
   * shown inline and the button drops out on its own (it already renders only
   * when something is hidden).
   */
  const effectivePrimary = filters.length - primaryCount === 1 ? filters.length : primaryCount;
  const primary = filters.slice(0, effectivePrimary);
  const rest = filters.slice(effectivePrimary);
  const hasValue = (f: FilterDef) => (f.multi ? (f.values?.length ?? 0) > 0 : !!f.value);
  const [expanded, setExpanded] = useState(() => rest.some(hasValue));
  const [customOpen, setCustomOpen] = useState(false);

  function setMany(pairs: [string, string][], clears: string[] = []) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of pairs) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    for (const c of clears) params.delete(c);
    const qs = params.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);
  }
  const set = (key: string, value: string, clears: string[] = []) =>
    setMany([[key, value]], clears);

  function toggleMulti(f: FilterDef, id: string) {
    const current = f.values ?? [];
    const next = current.includes(id)
      ? current.filter((v) => v !== id)
      : [...current, id];
    set(f.key, next.join(","), f.clears);
  }

  function setRange(r: RangeValue) {
    // from/to replace each other AND the legacy period param, always.
    setMany(
      [
        ["from", r.from ?? ""],
        ["to", r.to ?? ""],
      ],
      ["period", ...rangeClears],
    );
  }

  const activeFilters = filters.filter(hasValue);
  const rangeActive = !!(range && (range.from || range.to));
  const active = activeFilters.length > 0 || !!searchValue || rangeActive;
  const hiddenActiveCount = rest.filter(hasValue).length;

  function renderSingle(f: FilterDef) {
    // Was a native <select>, whose option list the OS renders and no
    // stylesheet can reach -- in dark mode that meant a white panel with
    // unreadable text over a dark app. Select renders the list in our own
    // surface tokens, and matches the multi-select sitting beside it.
    return (
      <Select
        key={f.key}
        className="min-w-[150px] max-w-[230px]"
        value={f.value ?? ""}
        onChange={(v) => set(f.key, v, f.clears)}
        options={f.options}
        placeholder={f.allLabel}
        ariaLabel={f.label}
      />
    );
  }

  const renderControl = (f: FilterDef) =>
    f.multi ? <MultiSelect key={f.key} def={f} onToggle={toggleMulti} /> : renderSingle(f);

  const preset = range ? presetForRange(range.from, range.to) : "all";

  return (
    <div className="card mb-5 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {primary.map(renderControl)}

        {range && (
          <>
            {/* The range picker is a styled Select too, so the row does not
                mix one OS-drawn list with two of ours. "All time" is the
                resting state rather than a clear row, so it is passed as a
                real option and the placeholder never shows. */}
            <Select
              className="min-w-[140px]"
              value={customOpen || preset === "custom" ? "custom" : preset}
              onChange={(v) => {
                if (!v || v === "custom") {
                  setCustomOpen(true);
                  return;
                }
                setCustomOpen(false);
                setRange(rangeForPreset(v as RangePreset));
              }}
              options={[
                ...PRESET_LABELS.map((p) => ({ value: p.value, label: p.label })),
                { value: "custom", label: "Custom…" },
              ]}
              placeholder="All time"
              ariaLabel="Time range"
            />
            {(customOpen || preset === "custom") && (
              <span className="animate-rise flex items-center gap-1.5 text-xs text-[var(--muted)]">
                <input
                  type="date"
                  className="input max-w-[150px] py-1 text-sm"
                  value={range.from ?? ""}
                  onChange={(e) => setRange({ from: e.target.value || null, to: range.to })}
                  aria-label="From date"
                />
                –
                <input
                  type="date"
                  className="input max-w-[150px] py-1 text-sm"
                  value={range.to ?? ""}
                  onChange={(e) => setRange({ from: range.from, to: e.target.value || null })}
                  aria-label="To date"
                />
              </span>
            )}
          </>
        )}

        {searchKey && (
          // A real form, so Enter submits natively rather than depending on a
          // keydown handler -- which is both the accessible default and one
          // less thing to get wrong.
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const input = e.currentTarget.elements.namedItem("q") as HTMLInputElement;
              set(searchKey, input.value, searchClears);
            }}
          >
            <input
              // Keyed on the committed value: the box is uncontrolled so typing
              // does not navigate on every keystroke, but it must still reset
              // when the URL changes underneath it -- clearing a chip, or
              // pressing Clear all, otherwise leaves stale text sitting there.
              key={searchValue ?? ""}
              name="q"
              type="search"
              className="input max-w-[200px] py-1.5 text-sm"
              placeholder={searchPlaceholder}
              defaultValue={searchValue ?? ""}
              onBlur={(e) => {
                if (e.target.value !== (searchValue ?? "")) {
                  set(searchKey, e.target.value, searchClears);
                }
              }}
              aria-label={searchPlaceholder}
            />
          </form>
        )}

        {rest.length > 0 && (
          <button
            className={`flex items-center gap-1 rounded px-2 py-1.5 text-xs transition-colors ${
              hiddenActiveCount > 0
                ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                : "text-[var(--muted)] hover:bg-[var(--border)] hover:text-[var(--fg)]"
            }`}
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded ? "Fewer filters" : "More filters"}
            {!expanded && hiddenActiveCount > 0 && (
              <span className="tabular rounded-full bg-[var(--accent)] px-1.5 text-[var(--accent-fg)]">
                {hiddenActiveCount}
              </span>
            )}
            <ChevronDown
              size={11}
              className={`shrink-0 transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
            />
          </button>
        )}

        <div className="flex-1" />

        {active && (
          <button
            className="rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--fg)]"
            onClick={() => {
              const kept = new URLSearchParams();
              for (const k of preserveOnClear) {
                const v = searchParams.get(k);
                if (v) kept.set(k, v);
              }
              const qs = kept.toString();
              router.push(qs ? `${basePath}?${qs}` : basePath);
            }}
          >
            Clear all
          </button>
        )}
      </div>

      {expanded && rest.length > 0 && (
        <div className="animate-rise mt-2 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-2">
          {rest.map(renderControl)}
        </div>
      )}

      {/* The chips say what is actually applied, and remove one at a time. */}
      {active && (
        <div className="animate-rise mt-2 flex flex-wrap items-center gap-1.5 border-t border-[var(--border)] pt-2">
          <span className="text-[11px] uppercase tracking-wide text-[var(--muted)]">
            Filtered by
          </span>
          {activeFilters.flatMap((f) => {
            const ids = f.multi ? (f.values ?? []) : f.value ? [f.value] : [];
            return ids.map((id) => {
              const label = f.options.find((o) => o.value === id)?.label ?? id;
              return (
                <button
                  key={`${f.key}:${id}`}
                  className="flex items-center gap-1 rounded bg-[var(--accent)]/10 px-2 py-0.5 text-xs text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/20"
                  onClick={() =>
                    f.multi
                      ? toggleMulti(f, id)
                      : set(f.key, "", f.clears)
                  }
                  title={`Remove the ${f.label.toLowerCase()} filter`}
                >
                  {label}
                  <span aria-hidden>×</span>
                  <span className="sr-only">Remove filter</span>
                </button>
              );
            });
          })}
          {rangeActive && range && (
            <button
              className="flex items-center gap-1 rounded bg-[var(--accent)]/10 px-2 py-0.5 text-xs text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/20"
              onClick={() => {
                setCustomOpen(false);
                setRange({ from: null, to: null });
              }}
              title="Clear the time range"
            >
              {rangeChipLabel(range)}
              <span aria-hidden>×</span>
              <span className="sr-only">Clear the time range</span>
            </button>
          )}
          {searchValue && searchKey && (
            <button
              className="flex items-center gap-1 rounded bg-[var(--accent)]/10 px-2 py-0.5 text-xs text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/20"
              onClick={() => set(searchKey, "")}
            >
              “{searchValue}”<span aria-hidden>×</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A dropdown that stays open for multiple picks -- checkbox rows, a count
 * badge on the button, outside-click and Escape to close. Selection writes
 * the URL immediately; the parent re-renders with the new values.
 */
function MultiSelect({
  def,
  onToggle,
}: {
  def: FilterDef;
  onToggle: (f: FilterDef, id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const count = def.values?.length ?? 0;

  // This panel must survive a click on one of its own options -- ticking a
  // box is not "done choosing". Popover owns outside-detection precisely so
  // that a portalled option click is not mistaken for a click outside.
  const close = useCallback(() => setOpen(false), []);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        className={`input flex min-w-[150px] max-w-[230px] cursor-pointer items-center gap-1.5 py-1.5 text-left text-sm transition-colors ${
          count > 0 ? "border-[var(--accent)]/50 font-medium" : ""
        }`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={def.label}
      >
        <span className="min-w-0 flex-1 truncate">
          {count === 0 ? def.allLabel : `${def.label.replace(/^Filter by /, "")} · ${count}`}
        </span>
        {count > 0 && (
          <span className="tabular shrink-0 rounded-full bg-[var(--accent)] px-1.5 text-[11px] text-[var(--accent-fg)]">
            {count}
          </span>
        )}
        <ChevronDown
          size={13}
          className={`shrink-0 text-[var(--muted)] transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <Popover
          anchorRef={wrapRef}
          onClose={close}
          ariaMultiselectable
          ariaLabel={def.label}
          width={240}
        >
          {def.options.length === 0 && (
            <div className="px-3 py-2 text-xs text-[var(--muted)]">Nothing to pick yet.</div>
          )}
          {def.options.map((o) => {
            const selected = def.values?.includes(o.value) ?? false;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={selected}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--bg-subtle)]"
                onClick={() => onToggle(def, o.value)}
              >
                <span
                  className="grid size-4 shrink-0 place-items-center rounded border transition-colors"
                  style={{
                    borderColor: selected ? "var(--accent)" : "var(--border-strong)",
                    background: selected ? "var(--accent)" : "transparent",
                    color: "var(--accent-fg)",
                  }}
                >
                  {selected && <Check size={11} strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
              </button>
            );
          })}
        </Popover>
      )}
    </div>
  );
}
