import Link from "next/link";
import type { ComponentType, ReactNode } from "react";

type IconType = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;

/**
 * The headline figures at the top of each dashboard. A stat is allowed a hint
 * line because a bare number invites the wrong reading -- "5 videos" means
 * something different once you know 2 of them are unpublished.
 */
export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <div className="stagger mb-9 grid grid-cols-2 gap-3.5 sm:grid-cols-4">{children}</div>
  );
}

export function Stat({
  label,
  value,
  hint,
  emptyText,
  hintHref,
  accent = false,
  icon: Icon,
  hero = false,
}: {
  label: string;
  /** Usually a string; a node lets tiles animate (CountUp) without markup drift.
   *  null means THERE IS NO FIGURE YET -- see the render below. */
  value: ReactNode;
  hint?: string;
  /** Shown INSTEAD of the figure when value is null. Distinct from `hint`,
   *  which annotates a figure that exists and would read as nonsense in the
   *  empty case ("of 40h capacity" under nothing at all). */
  emptyText?: string;
  /** Makes the hint a link, for hints that name a subset worth acting on. */
  hintHref?: string;
  accent?: boolean;
  /** An optional glyph in the corner -- purely decorative, no new data. */
  icon?: IconType;
  /** The one dark, glowing tile per dashboard -- reserve for the headline number. */
  hero?: boolean;
}) {
  return (
    <div
      className={`animate-rise relative p-5 transition-colors ${
        hero ? "card-hero" : "card"
      } ${accent && !hero ? "border-[var(--accent)]/40" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className="text-[11px] font-medium uppercase tracking-wide"
          style={{ color: hero ? "var(--on-dark-muted)" : "var(--muted)" }}
        >
          {label}
        </div>
        {Icon && (
          <Icon
            size={16}
            strokeWidth={1.8}
            // Through the token, not text-white/50: the icon type accepts a
            // className but no style prop, so this is the only way in.
            className={hero ? "text-[var(--on-dark-muted)]" : "text-[var(--muted)]"}
          />
        )}
      </div>
      {/* The one place the display serif is allowed. Bigger than before
          (30px, up from 24) because a serif carries scale better than a bold
          sans does, and because the figure is the reason this card exists --
          everything else on it is a label for the number. */}
      {/* No figure is a STATE, not a character.
          These cards used to print an em dash when there was nothing to
          count, and at 30px in the display serif that is a heavy black bar
          sitting exactly where the number goes -- it reads as redacted, or
          as a value that failed to load, which is the opposite of the truth.
          A card with nothing to report should say so in words and give the
          space back, so the eye passes over it instead of stopping on a
          glyph it has to decode. */}
      {value == null ? (
        <div
          className="relative mt-2 text-[15px] leading-snug"
          style={{ color: hero ? "var(--on-dark-muted)" : "var(--muted)" }}
        >
          {emptyText ?? hint ?? "Nothing yet"}
        </div>
      ) : (
        <div
          className="numeral relative mt-2 text-[30px] leading-[1.05]"
          style={{ color: hero ? "var(--white)" : "var(--fg)" }}
        >
          {value}
        </div>
      )}
      {hint && value != null && (
        <div
          className="relative mt-1.5 text-xs"
          style={{ color: hero ? "var(--on-dark-muted)" : "var(--muted)" }}
        >
          {/* A hint that names a fixable subset should be able to reach it.
              "41 with no link" is the start of a job, and making it a dead
              label means finding those 41 by hand. Underlined rather than
              recoloured so it still reads as secondary text -- colour here
              would compete with the figure the card exists to show. */}
          {hintHref ? (
            <Link
              href={hintHref}
              className="underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--fg)]"
            >
              {hint}
            </Link>
          ) : (
            hint
          )}
        </div>
      )}
    </div>
  );
}

/** A muted "nothing here yet" panel, so empty states never read as broken. */
/**
 * Nothing to show.
 *
 * A dashed outline rather than a solid card, because an empty state is a gap
 * in the page and should read as one -- a fully rendered card containing a
 * sentence about absence looks like a component that failed rather than a
 * space waiting to be filled. Dashed is the oldest convention for "this is a
 * placeholder" and it still costs nothing to read.
 */
export function Empty({ children }: { children: ReactNode }) {
  // Deliberately thin: the appearance lives in the .empty class, so this
  // component and the eighteen files that hand-rolled the same thing before
  // it now render identically and change together.
  return <div className="empty">{children}</div>;
}

/**
 * A screen with nothing on it yet, told properly.
 *
 * `Empty` is a one-line strip and is right inside a populated page -- a filter
 * that matched nothing, a section with no rows. It is wrong as the WHOLE of a
 * screen: /tags rendered "No tags yet." in a thin bar and left 570px of a
 * 900px viewport blank, which is the "empty spaces with no design" complaint
 * exactly. Worse, it answered a question nobody asked. Somebody landing on an
 * empty Tags screen does not need to be told it is empty -- they can see that.
 * They need to know what a tag DOES here and why they would make one.
 *
 * So this states the thing, explains what it is for, and offers the action.
 * The `hint` is not decoration: a first-run screen is the only place a product
 * gets to explain itself, and the alternative is a person guessing.
 */
export function EmptyScreen({
  icon: Icon,
  title,
  hint,
  children,
}: {
  /** A lucide icon component, drawn quietly behind the title. */
  icon?: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  title: string;
  /** What this is for, in a sentence someone can act on. */
  hint?: ReactNode;
  /** The action, when there is one worth offering. */
  children?: ReactNode;
}) {
  return (
    <div className="empty-screen">
      {Icon && (
        <span className="empty-screen-icon" aria-hidden="true">
          <Icon size={22} strokeWidth={1.5} />
        </span>
      )}
      <h3 className="empty-screen-title">{title}</h3>
      {hint && <p className="empty-screen-hint">{hint}</p>}
      {children && <div className="empty-screen-action">{children}</div>}
    </div>
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
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-sm font-semibold tracking-[-0.006em]">{title}</h2>
      {note && <span className="text-xs text-[var(--muted)]">{note}</span>}
      {children}
    </div>
  );
}
