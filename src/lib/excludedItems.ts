// No "server-only" marker, matching dashboards/homeData/performanceData: this
// takes its db client as a parameter and holds no credential of its own, so
// there is nothing here to leak into a client bundle. cachedRankings carries
// the marker because it BUILDS a service client internally. Staying importable
// from a plain Node script is also what makes it directly testable.
import { selectAll } from "@/lib/selectAll";

type Db = {
  from: (t: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (c: string) => any;
  };
};

/**
 * Content items that must not count toward any PERFORMANCE figure.
 *
 * One function, deliberately, because there is more than one reason to
 * exclude a video and they have to travel together. Today it is exactly one
 * rule -- the client is archived -- and the approval queue adds a second.
 * Two separate helpers would guarantee that some loader picks up one rule and
 * not the other, and the symptom of that is not a crash: it is a number that
 * is quietly wrong on one page and right on another, which is far harder to
 * notice and far worse to explain.
 *
 * WHAT THIS IS NOT. It is not a visibility rule and it is not deletion.
 *
 *   - Nothing is removed. Un-archiving a client restores every derived figure
 *     immediately, because every caller recomputes this set per request.
 *   - Deep links still work. /content?video=<id> must render an excluded
 *     video's full history, or the only way to fix a mistake becomes
 *     un-archiving the whole client.
 *   - Time tracking still sees it. /track and /import must keep offering the
 *     video, because hours get booked before anyone changes a client's
 *     status, and hiding it would strand that work with nowhere to go.
 *   - Operational counts still include it. The sync pipeline's coverage
 *     figures need the TRUE denominator; an operator asking "is the sync
 *     healthy" is not asking a performance question.
 *
 * Content with a NULL client_id is never excluded. It belongs to no archived
 * client, so it is still current work.
 */
/**
 * The rule itself, as a predicate, for callers that ALREADY hold the rows.
 *
 * loadContentOverview reads every content item anyway, so making it issue the
 * two extra queries below just to learn what it already knows would be waste.
 * But it must not therefore grow its own copy of the rule -- that is precisely
 * how one surface ends up counting a rejected video and another does not. So
 * the rule lives here once, in two shapes over the same definition:
 * `countsTowardPerformance` for callers with the row, `loadExcludedItemIds`
 * for callers with only an id.
 */
export function countsTowardPerformance(
  item: { review_state?: string | null; client_id?: string | null; clientId?: string | null },
  archivedClientIds: ReadonlySet<string>,
): boolean {
  // Approved is the ONLY state that counts. Written as an allow-list so a
  // state added later is excluded until someone decides otherwise, rather
  // than silently counted because nobody updated a deny-list.
  if ((item.review_state ?? "approved") !== "approved") return false;
  const clientId = item.client_id ?? item.clientId ?? null;
  // No client means it belongs to no archived client -- still current work.
  if (clientId && archivedClientIds.has(clientId)) return false;
  return true;
}

export async function loadExcludedItemIds(db: Db, ws: string): Promise<Set<string>> {
  const excluded = new Set<string>();

  /* RULE 1 -- not our work.
     Anything a human has not approved. `pending` means nobody has judged it
     yet and `rejected` means someone judged it as the client's own post; both
     stay out of our numbers, and both keep their rows and their metrics.
     Approved is the ONLY state that counts, so a state added later is
     excluded by default rather than silently counted. */
  const unapproved = await selectAll<{ id: string }>(() =>
    db
      .from("content_items")
      .select("id")
      .eq("workspace_id", ws)
      .neq("review_state", "approved")
      .order("id"),
  );
  for (const r of unapproved.data ?? []) excluded.add(r.id);

  /* RULE 2 -- not a current client. */
  const { data: archived } = await db
    .from("clients")
    .select("id").is("deleted_at", null)
    .eq("workspace_id", ws)
    .eq("is_archived", true);

  const clientIds = ((archived ?? []) as { id: string }[]).map((c) => c.id);
  if (clientIds.length > 0) {
    // Paged: a workspace with a long archived roster can exceed the 1000-row
    // cap, and a short read here would silently let excluded work back in.
    const rows = await selectAll<{ id: string }>(() =>
      db
        .from("content_items")
        .select("id")
        .eq("workspace_id", ws)
        .in("client_id", clientIds)
        .order("id"),
    );
    for (const r of rows.data ?? []) excluded.add(r.id);
  }

  return excluded;
}
