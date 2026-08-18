/**
 * What a credit stack shows while the server catches up.
 *
 * Crediting is one INSERT, but the avatar used to wait on a full page refresh
 * behind it -- over a second, on a control people use dozens of times in a
 * sitting. So the circle now fills on the click and reconciles afterwards,
 * which means the stack is briefly showing three things at once: what the
 * server last said, what is on its way out, and what is on its way in.
 *
 * Getting that merge wrong is not a cosmetic matter. Draw an added credit
 * twice and it reads as two people; fail to hide a removed one and the click
 * looks ignored; keep an optimistic entry after the real row arrives and the
 * same person appears alongside themselves. Hence a plain function with tests
 * rather than an expression buried in JSX.
 */

export type OverlayCredit = {
  assignmentId: string;
  roleSlug: string;
  userId: string;
  userName: string;
};

/**
 * Server truth, minus what is being removed, plus what has just been added.
 *
 * Deduped by user within the role: the window where a real row has landed but
 * the optimistic twin has not yet been cleared is exactly one render, and
 * drawing the person twice in it is the most visible way this can fail.
 */
export function visibleCredits(
  credits: OverlayCredit[],
  roleSlug: string,
  added: OverlayCredit[],
  removing: Set<string>,
): OverlayCredit[] {
  const server = credits.filter((c) => c.roleSlug === roleSlug && !removing.has(c.assignmentId));
  const pending = added.filter(
    (a) => a.roleSlug === roleSlug && !server.some((c) => c.userId === a.userId),
  );
  return [...server, ...pending];
}

/**
 * A key that changes only when the server's credits actually change.
 *
 * The credits array is a fresh object on every parent render, so an effect
 * depending on it would clear the overlay immediately -- before the round trip
 * finished, reintroducing the exact flicker the overlay removes. Sorted
 * because order is not meaningful here and an order change is not a change.
 */
export function creditsKey(credits: OverlayCredit[]): string {
  return credits
    .map((c) => c.assignmentId)
    .sort()
    .join(",");
}
