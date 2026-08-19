/**
 * Initial-letter avatars, in the vein of Monday.com's assignee circles.
 *
 * The palette and the seed hash live in @/lib/avatar because they are pure
 * data: a .tsx file cannot be imported by a plain node test (no JSX stripping),
 * and the palette's contrast floor needs to be TESTED rather than asserted in
 * a comment -- it was asserted, and it was wrong for half the colours.
 */
import { AVATAR_COLORS, colorForSeed, initialsOf } from "@/lib/avatar";

export { AVATAR_COLORS, colorForSeed, initialsOf };

export default function Avatar({
  name,
  seed,
  size = 26,
  title,
  className = "",
}: {
  name: string;
  /** Stable id for the colour. Falls back to the name when there is no id. */
  seed?: string;
  size?: number;
  title?: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${className}`}
      style={{
        width: size,
        height: size,
        background: colorForSeed(seed || name),
        // Two letters need to fit inside a 26px circle without touching it.
        fontSize: Math.max(9, Math.round(size * 0.38)),
        letterSpacing: "0.01em",
      }}
      title={title ?? name}
      aria-label={title ?? name}
    >
      {initialsOf(name)}
    </span>
  );
}
