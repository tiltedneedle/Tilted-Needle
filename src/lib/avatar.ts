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

/**
 * Fixed palette. Every entry clears 4.5:1 against the white initials it
 * carries -- and that is now MEASURED rather than asserted.
 *
 * The line here used to claim the colours were "chosen to stay legible
 * against white text" and half of them were not: clay 3.93:1, green 4.02:1,
 * amber 3.28:1 and teal 4.13:1, all below the 4.5:1 floor the rest of this
 * app is held to. They escaped the composite contrast gate because that gate
 * tests TOKENS, and these are literals in a component file -- the same blind
 * spot that let text-emerald-500 sit at 2.47:1 in light mode.
 *
 * The four were walked down in lightness until they passed, so the hue each
 * person is recognised by is unchanged; they are a shade deeper. scripts/
 * avatar-contrast-test.mjs holds the floor from here on.
 */
export const AVATAR_COLORS = [
  "#c54e35", // clay
  "#2a845a", // green
  "#4a6fd8", // blue
  "#7c5cd6", // violet
  "#a26918", // amber
  "#c2447a", // pink
  "#0e818a", // teal
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
