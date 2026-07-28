"use client";

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
 */
export default function FilterBar({
  basePath,
  filters,
  searchKey,
  searchValue,
  searchPlaceholder = "Search…",
}: {
  basePath: string;
  filters: FilterDef[];
  /** When set, renders a free-text box writing to this query key. */
  searchKey?: string;
  searchValue?: string | null;
  searchPlaceholder?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

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

  return (
    <div className="card mb-5 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
      {filters.map((f) => (
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
      ))}

      {searchKey && (
        <input
          className="input max-w-[200px] py-1.5 text-sm"
          placeholder={searchPlaceholder}
          defaultValue={searchValue ?? ""}
          onKeyDown={(e) => {
            if (e.key === "Enter") set(searchKey, (e.target as HTMLInputElement).value);
          }}
          onBlur={(e) => {
            if (e.target.value !== (searchValue ?? "")) set(searchKey, e.target.value);
          }}
          aria-label={searchPlaceholder}
        />
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
