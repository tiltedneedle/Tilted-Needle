import type { ReactNode } from "react";

export type PillTone = "success" | "warning" | "danger" | "info" | "coral" | "neutral";

const DOT_COLOR: Record<PillTone, string> = {
  success: "var(--success-500)",
  warning: "var(--warning-500)",
  danger: "var(--danger-500)",
  info: "var(--info-500)",
  coral: "var(--coral-500)",
  neutral: "var(--muted)",
};

/**
 * Status always comes as the -500/-100 pair, and never as colour alone --
 * the label text carries the meaning; the dot is a reinforcing cue for a
 * quick visual scan down a column of rows.
 */
export default function Pill({
  tone = "neutral",
  dot = true,
  children,
}: {
  tone?: PillTone;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={`pill pill-${tone}`}>
      {dot && <span className="pill-dot" style={{ background: DOT_COLOR[tone] }} />}
      {children}
    </span>
  );
}
