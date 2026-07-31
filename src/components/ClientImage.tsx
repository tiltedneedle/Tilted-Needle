import { initialsOf, colorForSeed } from "@/components/Avatar";

/**
 * A client's face on the guidelines grid.
 *
 * Half the roster has no photo -- the info deck only pictured the clients who
 * had a success story written up -- so the monogram is not an error state, it
 * is the normal state for most cards and has to look deliberate. Same hashed
 * palette as the credit avatars, so a client keeps one colour everywhere.
 *
 * The gradient runs from the client's colour to a darkened copy of itself
 * rather than to a neutral, which keeps a wall of monogram cards from reading
 * as a wall of identical grey placeholders.
 */
export default function ClientImage({
  name,
  seed,
  src,
  size = 96,
  /** Stretch to the parent instead of a fixed box (the grid card's header). */
  fill = false,
  rounded = "rounded-[18px]",
  className = "",
}: {
  name: string;
  /** Stable id for the colour, so it matches across pages. */
  seed?: string;
  src?: string | null;
  size?: number;
  fill?: boolean;
  rounded?: string;
  className?: string;
}) {
  // Inline styles beat utility classes, so a fixed size must not be emitted at
  // all in fill mode -- a `width: 96px` here would quietly win over h-full.
  const box = fill
    ? { width: "100%", height: "100%" }
    : { width: size, height: size };

  if (src) {
    // Plain <img>: these are static files in /public plus whatever URL the team
    // pastes in later, and next/image would need every future host allow-listed
    // in next.config before a card would render at all.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        className={`shrink-0 object-cover ${rounded} ${className}`}
        style={{ ...box, background: "var(--bg-subtle)" }}
      />
    );
  }

  const base = colorForSeed(seed || name);
  return (
    <span
      className={`grid shrink-0 place-items-center font-semibold text-white ${rounded} ${className}`}
      style={{
        ...box,
        background: `linear-gradient(140deg, ${base}, ${shade(base, -28)})`,
        fontSize: fill ? 34 : Math.max(13, Math.round(size * 0.32)),
        letterSpacing: "0.02em",
      }}
      aria-label={name}
      title={name}
    >
      {initialsOf(name)}
    </span>
  );
}

/** Darken (or lighten) a #rrggbb by a per-channel amount. */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = clamp(((n >> 16) & 255) + amount);
  const g = clamp(((n >> 8) & 255) + amount);
  const b = clamp((n & 255) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
