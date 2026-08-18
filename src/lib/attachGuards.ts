/**
 * Whether a link may be attached to a video, and if not, why.
 *
 * A post carries its video's reach -- and the tracked hours that ride along
 * with it -- onto whichever client owns the account it hangs off. So "which
 * account" is not a filing decision, it is the decision that moves
 * money-shaped numbers between two sets of books. Both refusals below were
 * enforced by the pickers and by nothing else, which is no enforcement at all
 * for a server action whose arguments arrive over the wire.
 *
 * Separate from actions.ts so it can be tested without a session, a server, or
 * live rows to ruin.
 */

export type AttachTarget = {
  /** The account the caller chose. */
  account: { client_id: string | null; platform_slug: string; handle: string };
  /** The video being linked. */
  item: { client_id: string | null };
  /** The platform parsed out of the URL itself, not read from the account. */
  urlPlatform: string;
};

/**
 * Returns a sentence to show the person, or null when the attach may proceed.
 *
 * Written as prose rather than a code because every one of these reaches a
 * human who is midway through pasting links, and "ERR_CLIENT_MISMATCH" would
 * make them guess at which of the two things they picked was wrong.
 */
export function attachRefusal({ account, item, urlPlatform }: AttachTarget): string | null {
  /**
   * WRONG PLATFORM. external_id is parsed from the URL, but a post's platform
   * is read from its ACCOUNT -- so a TikTok link filed under a YouTube account
   * makes a row the YouTube provider will keep trying to refresh using an id
   * that means nothing to it. The post never gains a metric and never
   * obviously fails either.
   */
  if (account.platform_slug !== urlPlatform) {
    return `That link is a ${urlPlatform} post, but @${account.handle} is a ${account.platform_slug} account. Pick the ${urlPlatform} account instead.`;
  }

  /**
   * WRONG CLIENT. The expensive one, and silent: nothing downstream is in a
   * position to notice that a video's reach landed on someone else's numbers.
   *
   * A video with no client is exempt. There is no client whose books could be
   * wronged, and those rows are precisely the ones most in need of a link --
   * refusing every account would leave them unrepairable.
   */
  if (item.client_id !== null && account.client_id !== item.client_id) {
    return `@${account.handle} belongs to a different client. Attaching this video there would move its reach onto their numbers.`;
  }

  return null;
}
