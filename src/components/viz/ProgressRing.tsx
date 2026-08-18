"use client";

import { useEffect, useState } from "react";

/**
 * A single-share radial: one value against its track, the number in the
 * middle in ink -- the "how much of today is done" glance. The arc sweeps
 * in on mount via a dashoffset transition (reduced motion flattens it).
 */
export default function ProgressRing({
  fraction,
  size = 76,
  stroke = 7,
  color = "var(--accent)",
  track = "var(--on-dark-track)",
  children,
}: {
  /** 0..1 */
  fraction: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, fraction));
  const [sweep, setSweep] = useState(0);

  useEffect(() => {
    // One frame at zero, then transition to the real arc.
    const raf = requestAnimationFrame(() => setSweep(clamped));
    return () => cancelAnimationFrame(raf);
  }, [clamped]);

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - sweep)}
          style={{ transition: "stroke-dashoffset 900ms cubic-bezier(0.16, 1, 0.3, 1)" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}
