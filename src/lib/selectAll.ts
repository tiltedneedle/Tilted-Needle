/**
 * Paged reads, for the queries that load a whole table.
 *
 * PostgREST answers with at most 1000 rows per request and says nothing about
 * having truncated -- `data.length === 1000` is the only hint, and nothing in
 * the client surfaces it as an error. Every loader that reads an unbounded
 * table therefore has to page, or it silently computes on a prefix of the data.
 *
 * This is not hypothetical: content_assignments passed 1000 rows on the live
 * workspace, and the role rankings in performanceData were quietly scoring
 * against ~89% of the credits. Snapshots and time entries grow on a schedule
 * and will cross the same line without anything looking wrong.
 *
 * The caller passes a factory rather than a built query, because a builder
 * carries its own range state and re-awaiting one is relying on internals.
 *
 * IMPORTANT: the query must carry a stable, unique-enough order. LIMIT/OFFSET
 * over an unordered select has no guaranteed row order between requests, so
 * pages can overlap or skip rows. Order by a primary key, or by a column plus
 * a key tiebreaker.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const PAGE_SIZE = 1000;

export async function selectAll<T = any>(
  makeQuery: () => any,
  pageSize = PAGE_SIZE,
): Promise<{ data: T[]; error: any }> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    if (error) return { data: out, error };
    const rows = (data ?? []) as T[];
    out.push(...rows);
    // A short page is the last page. An exactly-full final page costs one
    // extra empty request, which is the cheap side of the trade.
    if (rows.length < pageSize) break;
  }
  return { data: out, error: null };
}
