import type { ComponentType, ReactNode } from "react";

type IconType = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;

/**
 * The headline figures at the top of each dashboard. A stat is allowed a hint
 * line because a bare number invites the wrong reading -- "5 videos" means
 * something different once you know 2 of them are unpublished.
 */
export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <div className="stagger mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">{children}</div>
  );
}

export function Stat({
  label,
  value,
  hint,
  accent = false,
  icon: Icon,
  hero = false,
}: {
  label: string;
  /** Usually a string; a node lets tiles animate (CountUp) without markup drift. */
  value: ReactNode;
  hint?: string;
  accent?: boolean;
  /** An optional glyph in the corner -- purely decorative, no new data. */
  icon?: IconType;
  /** The one dark, glowing tile per dashboard -- reserve for the headline number. */
  hero?: boolean;
}) {
  return (
    <div
      className={`animate-rise relative p-4 transition-colors ${
        hero ? "card-hero" : "card"
      } ${accent && !hero ? "border-[var(--accent)]/40" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className="text-[11px] font-medium uppercase tracking-wide"
          style={{ color: hero ? "rgb(255 255 255 / 0.6)" : "var(--muted)" }}
        >
          {label}
        </div>
        {Icon && (
          <Icon
            size={16}
            strokeWidth={1.8}
            className={hero ? "text-white/50" : "text-[var(--muted)]"}
          />
        )}
      </div>
      {/* The one place the display serif is allowed. Bigger than before
          (30px, up from 24) because a serif carries scale better than a bold
          sans does, and because the figure is the reason this card exists --
          everything else on it is a label for the number. */}
      <div
        className="numeral relative mt-2 text-[30px] leading-[1.05]"
        style={{ color: hero ? "var(--white)" : "var(--fg)" }}
      >
        {value}
      </div>
      {hint && (
        <div
          className="relative mt-1.5 text-xs"
          style={{ color: hero ? "rgb(255 255 255 / 0.55)" : "var(--muted)" }}
        >
          {hint}
        </div>
      )}
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
