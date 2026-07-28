import type { ReactNode } from "react";

/**
 * The headline figures at the top of each dashboard. A stat is allowed a hint
 * line because a bare number invites the wrong reading -- "5 videos" means
 * something different once you know 2 of them are unpublished.
 */
export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <div className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">{children}</div>
  );
}

export function Stat({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`card animate-rise p-3 transition-colors ${
        accent ? "border-[var(--accent)]/40" : ""
      }`}
    >
      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
        {label}
      </div>
      <div className="tabular mt-1 text-2xl font-semibold leading-none">{value}</div>
      {hint && <div className="mt-1.5 text-xs text-[var(--muted)]">{hint}</div>}
    </div>
  );
}

/** A muted "nothing here yet" panel, so empty states never read as broken. */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="card p-10 text-center text-sm text-[var(--muted)]">{children}</div>
  );
}

export function SectionHeading({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      {note && <span className="text-xs text-[var(--muted)]">{note}</span>}
      {children}
    </div>
  );
}
