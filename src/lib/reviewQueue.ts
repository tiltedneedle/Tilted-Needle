/**
 * Which videos the approval queue is asking about.
 *
 * Pure, and its own file for the reason clientReport.ts is: dashboards.ts
 * reaches next/cache through cachedContentData and therefore cannot be
 * imported by a plain Node test, while this rule decides what a person sees
 * above an "approve" button and is exactly the kind of thing that must be
 * pinned by tests rather than by reading it.
 *
 * TWO EXCLUSIONS, AND THEY ARE NOT THE SAME KIND OF THING.
 *
 * An archived client's videos are dropped because nobody is going to judge
 * work for a client we no longer have -- leaving them makes the queue
 * permanently non-empty. That rule is unconditional.
 *
 * The client FILTER is a scope the person chose on the page. It narrows the
 * queue with the rest of the page, because "150 awaiting review" sitting above
 * one client's videos is a number about the whole workspace, and the obvious
 * next action -- approve what is listed -- was then the wrong action on rows
 * that had scrolled out of view. Nothing else on the page narrows this queue:
 * approving decides whether a video is OURS, which a date range, a platform
 * or a credit has no bearing on, and a queue narrowed by them would report
 * itself empty while work sat in it.
 *
 * Content with no client is in scope when unfiltered -- it belongs to no
 * archived client, so it is still current work -- and out of scope under a
 * client filter, because it is not that client's.
 */

export type ReviewRow = {
  client_id: string | null;
  review_state: string;
};

/**
 * The rows this queue covers: archived clients gone, narrowed to the chosen
 * clients when there are any.
 */
export function inReviewScope<T extends ReviewRow>(
  rows: readonly T[],
  archivedClientIds: ReadonlySet<string>,
  clientIds: readonly string[] = [],
): T[] {
  const wanted = clientIds.length ? new Set(clientIds) : null;
  return rows.filter((r) => {
    if (r.client_id && archivedClientIds.has(r.client_id)) return false;
    if (wanted) return r.client_id != null && wanted.has(r.client_id);
    return true;
  });
}

/**
 * How many of the pending rows arrived on the most recent sync.
 *
 * Measured from when that sync RAN, not over a fixed window: syncs are
 * irregular, so "the last 24 hours" reports nothing whenever the cadence
 * happens not to match it. The hour of slack absorbs the gap between a sync
 * starting and the rows it writes landing.
 */
export const SYNC_SLACK_MS = 60 * 60 * 1000;

export function countNewSinceSync(
  pending: readonly { created_at: string }[],
  lastSyncedAt: string | null | undefined,
): number {
  if (!lastSyncedAt) return 0;
  const at = new Date(lastSyncedAt).getTime();
  if (!Number.isFinite(at)) return 0;
  const cutoff = at - SYNC_SLACK_MS;
  return pending.filter((r) => {
    const t = new Date(r.created_at).getTime();
    return Number.isFinite(t) && t >= cutoff;
  }).length;
}
