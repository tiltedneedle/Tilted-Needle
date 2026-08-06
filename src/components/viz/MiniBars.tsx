"use client";

import { useState } from "react";

export type Bar = { label: string; value: number; hint?: string };

/**
 * A small magnitude-by-category bar chart: thin bars anchored to the
 * baseline with 4px rounded tops, 2px gaps, per-bar hover tooltip, and a
 * staggered grow-in on mount (CSS only; flattened under reduced motion).
 * Single series -- one accent color, no legend, the card title names it.
 */
export default function MiniBars({
  data,
  height = 96,
  color = "var(--accent)",
  valueSuffix = "",
}: {
  data: Bar[];
  height?: number;
  color?: string;
  /** Serializable formatting -- this renders from Server Components, and a
      format-function prop would crash at the client boundary at runtime. */
  valueSuffix?: string;
}) {
  const formatValue = (v: number) => `${v.toLocaleString()}${valueSuffix}`;
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.value), 1);
  const active = hover != null ? data[hover] : null;

  return (
    <div className="relative">
      {active && (
        <div className="pointer-events-none absolute -top-1 right-0 z-10 rounded-md bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] shadow-[var(--shadow-card)]">
          <span className="text-[var(--muted)]">{active.hint ?? active.label} </span>
          <span className="tabular font-medium">{formatValue(active.value)}</span>
        </div>
      )}
      <div className="flex items-end gap-[2px]" style={{ height }} role="img"
        aria-label={data.map((d) => `${d.label} ${formatValue(d.value)}`).join(", ")}>
        {data.map((d, i) => (
          <div
            key={d.label + i}
            className="group/bar flex h-full flex-1 cursor-default flex-col justify-end"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <div
              className="bar-grow w-full rounded-t-[4px] transition-opacity"
              style={{
                height: `${Math.max(d.value > 0 ? 4 : 1, (d.value / max) * 100)}%`,
                background: color,
                opacity: hover == null || hover === i ? 0.9 : 0.35,
                animationDelay: `${i * 45}ms`,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[2px]">
        {data.map((d, i) => (
          <span
            key={d.label + i}
            className={`flex-1 text-center text-[10px] ${
              hover === i ? "text-[var(--fg)]" : "text-[var(--muted)]"
            }`}
          >
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}
