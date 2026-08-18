/**
 * The two decisions the bulk bar makes about a selection, as plain functions.
 *
 * They live outside the component because both are rules rather than markup,
 * and rules are worth testing directly. Merge in particular is the destructive
 * action in this product -- it folds rows together and carries posts, credits
 * and tracked time across -- so what may be merged should be checkable without
 * driving a browser.
 */

/** One person credited in one role on one video. Mirrors TileCredit. */
export type SelectionCredit = {
  roleSlug: string;
  userId: string;
  userName: string;
};

/**
 * Which platform a merge would be within, or null if merging is not offered.
 *
 * SAME PLATFORM ONLY. This used to be the cross-platform tool: the TikTok and
 * the Instagram carrying one caption, folded into a single row. That is not a
 * duplicate -- two platforms are two posts, made to two audiences, each with
 * its own reach curve, and merging them hides one of them behind a record of
 * a cross-post nobody performed.
 *
 * Returns "none" when nothing selected carries a post at all. Those are the
 * hand-added rows, and two of them under one title really are one video
 * entered twice, with no posts that could conflict. It is a distinct answer
 * rather than a platform name because the button must not claim a platform
 * these rows do not have.
 *
 * Decided here rather than by letting the server refuse: "press it and read
 * the error" is a worse way to learn a rule than not being offered the button.
 */
export function mergePlatformFor(
  selected: string[],
  platformsById: Record<string, string[]>,
): string | null {
  if (selected.length < 2) return null;
  const all = selected.flatMap((id) => platformsById[id] ?? []);
  if (all.length === 0) return "none";
  const distinct = [...new Set(all)];
  return distinct.length === 1 ? distinct[0] : null;
}

/**
 * Who already holds each role across the selection, and on how many of them.
 *
 * Sorted by coverage so the avatar the strip shows is whoever is credited on
 * the most of the selection -- the person who best describes the batch --
 * with name as the tiebreak so the order does not wander between renders.
 *
 * The count is what makes the strip honest. "Credited" and "credited on all
 * of them" are different facts, and a strip that showed only the first would
 * imply the second.
 */
export function creditedByRoleFor(
  selected: string[],
  creditsById: Record<string, SelectionCredit[]>,
): Map<string, { userId: string; name: string; count: number }[]> {
  const out = new Map<string, { userId: string; name: string; count: number }[]>();
  for (const id of selected) {
    // A video contributing the same person twice in one role would inflate the
    // count past the selection size and make "3/2" reachable. Credits are
    // unique per (video, role, person) in the schema, but this reads a prop.
    const seen = new Set<string>();
    for (const c of creditsById[id] ?? []) {
      const dedupe = `${c.roleSlug}|${c.userId}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      const list = out.get(c.roleSlug) ?? [];
      const found = list.find((h) => h.userId === c.userId);
      if (found) found.count++;
      else list.push({ userId: c.userId, name: c.userName, count: 1 });
      out.set(c.roleSlug, list);
    }
  }
  for (const list of out.values()) {
    list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }
  return out;
}
