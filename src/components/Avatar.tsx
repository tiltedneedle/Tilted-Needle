/**
 * Initial-letter avatars, in the vein of Monday.com's assignee circles.
 *
 * The colour is derived from the user id rather than picked per call site, so
 * one person is the same colour on every tile in the app. That consistency is
 * the whole point: a row of circles becomes scannable without reading any of
 * the labels, which is what makes credits legible at a glance on a long list.
 *
 * Ids, not names, seed the hash -- two people called "Malik" would otherwise
 * collide into one colour and read as the same person.
 */

/** Fixed palette, chosen to stay legible against white text in both themes. */
const AVATAR_COLORS = [
  "#d9563a", // clay
  "#2e8f62", // green
  "#4a6fd8", // blue
  "#7c5cd6", // violet
  "#c47f1d", // amber
  "#c2447a", // pink
  "#0f8a94", // teal
  "#5c6b82", // slate
];

/** "Cimmie" -> "C"; "Malik Ahmed" -> "MA". */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0];
  if (words.length === 1) return first.toUpperCase();
  return (first + words[words.length - 1][0]).toUpperCase();
}

export function colorForSeed(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

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
