"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export type FilterDef = {
  /** Query-string key this select writes to. */
  key: string;
  label: string;
  /** Shown as the "no selection" option. */
  allLabel: string;
  value: string | null;
  options: { value: string; label: string }[];
  /** Keys to clear when this one changes -- e.g. picking a client drops a
      video that belonged to a different client. */
  clears?: string[];
};

/**
 * The navigation for both dashboards. Filters live in the query string rather
 * than component state so a filtered view is a URL: shareable, bookmarkable,
 * and survivable across a refresh.
 *
 * Only the first `primaryCount` filters show by default -- with seven
 * filters on Content and People alike, showing all of them permanently was
 * the single biggest source of visual clutter on either page, ahead of
 * anything actually on it. The rest sit behind a "More filters" toggle,
 * which opens automatically if one of the hidden ones already has a value
 * (from a shared link, or the back button) -- a filter that is doing
 * something must never be sitting invisibly collapsed.
 */
export default function FilterBar({
  basePath,
  filters,
  searchKey,
  searchValue,
  searchPlaceholder = "Search…",
  searchClears = [],
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
  /** How many filters stay visible before the rest collapse. */
  primaryCount?: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const primary = filters.slice(0, primaryCount);
  const rest = filters.slice(primaryCount);
  const [expanded, setExpanded] = useState(() => rest.some((f) => f.value));

  function set(key: string, value: string, clears: string[] = []) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    for (const c of clears) params.delete(c);
    const qs = params.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);
  }

  const activeFilters = filters.filter((f) => f.value);
  const active = activeFilters.length > 0 || !!searchValue;
  const hiddenActiveCount = rest.filter((f) => f.value).length;

  function renderSelect(f: FilterDef) {
    return (
      <label key={f.key} className="relative">
        <span className="sr-only">{f.label}</span>
        <select
          className={`input min-w-[150px] max-w-[230px] cursor-pointer py-1.5 pr-7 text-sm transition-colors ${
            f.value ? "border-[var(--accent)]/50 font-medium" : ""
          }`}
          value={f.value ?? ""}
          onChange={(e) => set(f.key, e.target.value, f.clears)}
          aria-label={f.label}
        >
          <option value="">{f.allLabel}</option>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div className="card mb-5 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
      {primary.map(renderSelect)}

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
          <ChevronIcon expanded={expanded} />
        </button>
      )}

      <div className="flex-1" />

      {active && (
        <button
          className="rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--fg)]"
          onClick={() => router.push(basePath)}
        >
          Clear all
        </button>
      )}
      </div>

      {expanded && rest.length > 0 && (
        <div className="animate-rise mt-2 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-2">
          {rest.map(renderSelect)}
        </div>
      )}

      {/* With this many filters, the selects alone stop being scannable --
          the chips say what is actually applied, and remove one at a time. */}
      {active && (
        <div className="animate-rise mt-2 flex flex-wrap items-center gap-1.5 border-t border-[var(--border)] pt-2">
          <span className="text-[11px] uppercase tracking-wide text-[var(--muted)]">
            Filtered by
          </span>
          {activeFilters.map((f) => {
            const label =
              f.options.find((o) => o.value === f.value)?.label ?? f.value;
            return (
              <button
                key={f.key}
                className="flex items-center gap-1 rounded bg-[var(--accent)]/10 px-2 py-0.5 text-xs text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/20"
                onClick={() => set(f.key, "", f.clears)}
                title={`Remove the ${f.label.toLowerCase()} filter`}
              >
                {label}
                <span aria-hidden>×</span>
                <span className="sr-only">Remove filter</span>
              </button>
            );
          })}
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

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width={11}
      height={11}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
