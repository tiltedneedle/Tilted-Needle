/**
 * Reads filtered by a long list of ids, in chunks that fit in a URL.
 *
 * The sibling hazard to selectAll. That one exists because PostgREST caps a
 * response at 1000 ROWS; this one exists because PostgREST takes its filters
 * in the QUERY STRING, and `.in("id", [...])` writes every id into it. A UUID
 * costs ~37 characters once encoded, so a few hundred ids build a URL of tens
 * of kilobytes and the gateway rejects it long before Postgres is consulted.
 *
 * Both failures found on this codebase were silent in the same way -- the
 * caller destructured `data` and never looked at `error`, so a dropped request
 * became an empty array and an empty array became a confident wrong answer:
 *
 *   - /clients/[id] handed all 443 workspace post ids to one .in() and then
 *     rendered every channel as "no recent change".
 *   - /api/v1/content advertises limit=500, and above ~330 ids answered 200
 *     with platforms: [] on every item.
 *
 * So this returns the error rather than swallowing it, and a caller that
 * ignores it is at least ignoring something that exists.
 *
 * 200 is well inside the limit for UUIDs (~7.4 KB of ids) and leaves room for
 * the select list, ordering and the rest of the query.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const CHUNK = 200;

export async function selectIn<T = any>(
  ids: string[],
  makeQuery: (chunk: string[]) => any,
  chunkSize = CHUNK,
): Promise<{ data: T[]; error: any }> {
  if (ids.length === 0) return { data: [], error: null };

  // Duplicates cost URL budget and buy nothing -- the filter is a set.
  const unique = [...new Set(ids)];
  const out: T[] = [];

  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const { data, error } = await makeQuery(chunk);
    // Partial data plus the error, so a caller can tell "nothing matched" from
    // "the third chunk failed" -- which the empty-array-on-failure shape could
    // not express, and which is exactly how both live bugs stayed invisible.
    if (error) return { data: out, error };
    out.push(...((data ?? []) as T[]));
  }

  return { data: out, error: null };
}
