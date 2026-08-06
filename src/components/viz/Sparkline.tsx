"use client";

import { useId, useState } from "react";

export type SparkPoint = { x: string; y: number };

/**
 * A compact single-series trend: 2px line, soft area fill, rounded end
 * dot, and the house crosshair+tooltip hover. One series by design -- a
 * platform's card owns its own sparkline, so different units never share
 * an axis. The line draws itself in on mount (pure CSS, flattened by the
 * global reduced-motion rule).
 */
export default function Sparkline({
  data,
  color = "var(--accent)",
  height = 56,
  valuePrefix = "",
  valueSuffix = "",
}: {
  data: SparkPoint[];
  color?: string;
  height?: number;
  /** Serializable formatting -- this renders from Server Components, and a
      format-function prop would crash at the client boundary at runtime. */
  valuePrefix?: string;
  valueSuffix?: string;
}) {
  const formatValue = (v: number) => `${valuePrefix}${v.toLocaleString()}${valueSuffix}`;
  const gid = useId();
  const [hover, setHover] = useState<number | null>(null);

  if (data.length < 2) {
    return (
      <div
        className="grid place-items-center text-xs text-[var(--muted)]"
        style={{ height }}
      >
        Not enough history yet
      </div>
    );
  }

  const W = 240;
  const H = height;
  const PAD = 6;
  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;
  const maxY = Math.max(...data.map((d) => d.y), 1);

  const xAt = (i: number) => PAD + (i / (data.length - 1)) * innerW;
  const yAt = (v: number) => PAD + innerH - (v / maxY) * innerH;
  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(d.y)}`).join(" ");
  const area = `${line} L${xAt(data.length - 1)},${H - PAD} L${PAD},${H - PAD} Z`;
  const active = hover != null ? data[hover] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`Trend, latest ${formatValue(data[data.length - 1].y)}`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`${gid}-a`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gid}-a)`} />
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          pathLength={1}
          className="spark-draw"
        />
        <circle cx={xAt(data.length - 1)} cy={yAt(data[data.length - 1].y)} r={3.5} fill={color} />
        {data.map((d, i) => (
          <rect
            key={i}
            x={xAt(i) - innerW / data.length / 2}
            y={0}
            width={Math.max(4, innerW / data.length)}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
        {active && (
          <>
            <line
              x1={xAt(hover!)}
              x2={xAt(hover!)}
              y1={PAD}
              y2={H - PAD}
              stroke="var(--muted)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle cx={xAt(hover!)} cy={yAt(active.y)} r={3.5} fill={color} />
          </>
        )}
      </svg>
      {/* Tooltip in ink tokens; the mark's color stays on the mark. */}
      {active && (
        <div className="pointer-events-none absolute -top-1 right-0 rounded-md bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] shadow-[var(--shadow-card)]">
          <span className="text-[var(--muted)]">{active.x} </span>
          <span className="tabular font-medium">{formatValue(active.y)}</span>
        </div>
      )}
    </div>
  );
}
