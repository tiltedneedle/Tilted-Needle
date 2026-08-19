"use client";

import { useId, useState } from "react";

export type LineChartPoint = { x: string; y: number };

/**
 * A single-series trend line, hand-rolled in SVG rather than a charting
 * dependency -- consistent with the rest of this app (inline icons, no UI
 * library). One series only: a channel dashboard is scoped to one account
 * already, so there is never a second line to reconcile onto the same axis,
 * and dual-axis is the mistake this shape avoids by construction.
 *
 * Follows the house dataviz procedure: thin 2px line, rounded data-end dot,
 * recessive grid/axis, a hover crosshair + tooltip. The table this chart
 * would otherwise need is the video list rendered beside it on the page.
 */
export default function LineChart({
  data,
  label,
  formatValue = (v) => v.toLocaleString(),
  height = 220,
}: {
  data: LineChartPoint[];
  label: string;
  formatValue?: (v: number) => string;
  height?: number;
}) {
  const gid = useId();
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div
        className="card grid place-items-center p-8 text-center text-sm text-[var(--muted)]"
        style={{ height }}
      >
        Not enough history yet — needs at least one recorded snapshot.
      </div>
    );
  }

  const W = 640;
  const H = height;
  const PAD_L = 44;
  const PAD_R = 12;
  const PAD_T = 16;
  const PAD_B = 28;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const maxY = Math.max(...data.map((d) => d.y), 1);
  const minY = Math.min(...data.map((d) => d.y), 0);
  const spanY = Math.max(1, maxY - minY);

  const xAt = (i: number) =>
    data.length === 1 ? PAD_L + innerW / 2 : PAD_L + (i / (data.length - 1)) * innerW;
  const yAt = (v: number) => PAD_T + innerH - ((v - minY) / spanY) * innerH;

  const linePath = data.map((d, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(d.y)}`).join(" ");
  const areaPath = `${linePath} L${xAt(data.length - 1)},${PAD_T + innerH} L${xAt(0)},${PAD_T + innerH} Z`;

  // Four gridlines: the recessive scale a reader can check a value against
  // without the chart competing with the line for attention.
  const ticks = 4;
  const gridValues = Array.from({ length: ticks + 1 }, (_, i) => minY + (spanY * i) / ticks);

  const active = hover != null ? data[hover] : null;

  return (
    <div className="card p-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`${label} over time, from ${formatValue(data[0].y)} to ${formatValue(data[data.length - 1].y)}`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`${gid}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {gridValues.map((v, i) => (
          <g key={i}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={yAt(v)}
              y2={yAt(v)}
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text x={PAD_L - 8} y={yAt(v)} dy={4} textAnchor="end" className="fill-[var(--muted)] text-[11px]">
              {formatValue(v)}
            </text>
          </g>
        ))}

        <path d={areaPath} fill={`url(#${gid}-fill)`} />
        <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />

        {/* Rounded end dot -- the last reading is always worth marking. */}
        <circle
          cx={xAt(data.length - 1)}
          cy={yAt(data[data.length - 1].y)}
          r={4}
          fill="var(--accent)"
        />

        {/* Hover targets: wider than the mark itself, per-point, not pixel-tracked. */}
        {data.map((d, i) => (
          <rect
            key={i}
            x={xAt(i) - innerW / data.length / 2}
            y={PAD_T}
            width={Math.max(4, innerW / data.length)}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}

        {active && (
          <>
            <line
              x1={xAt(hover!)}
              x2={xAt(hover!)}
              y1={PAD_T}
              y2={PAD_T + innerH}
              stroke="var(--muted)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle cx={xAt(hover!)} cy={yAt(active.y)} r={4} fill="var(--accent)" />
          </>
        )}
      </svg>

      {active ? (
        <div className="mt-1 flex items-baseline justify-between text-xs">
          <span className="text-[var(--muted)]">{active.x}</span>
          <span className="tabular font-medium">{formatValue(active.y)}</span>
        </div>
      ) : (
        <div className="mt-1 flex items-baseline justify-between text-xs text-[var(--muted)]">
          <span>{data[0].x}</span>
          <span>{data[data.length - 1].x}</span>
        </div>
      )}
    </div>
  );
}
