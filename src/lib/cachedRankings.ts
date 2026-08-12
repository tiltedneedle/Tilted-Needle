import "server-only";
import { unstable_cache } from "next/cache";
import { computeRankings, type RankingsResult } from "@/lib/performanceData";
import { serviceClient } from "@/lib/syncRunner";
import type { ScoredPost } from "@/lib/scoring";

/**
 * computeRankings, cached per workspace until a scoring input changes.
 *
 * Uncached, this was the single biggest cost on the three busiest pages
 * (Content, People, Home) AND the reason every mutation felt slow: the
 * router.refresh() after e.g. assigning a role re-ran the whole model --
 * five queries including the ever-growing snapshots table, paged 1000 rows
 * per round trip -- before the click appeared to do anything.
 *
 * Design notes, deliberate:
 *
 * - unstable_cache rather than the newer "use cache" directive: that
 *   requires enabling Cache Components for the whole app, a global
 *   behavioural switch this close to handoff. unstable_cache is surgical
 *   -- one function, explicit tags -- and still fully supported in this
 *   Next version (its docs merely recommend the successor).
 *
 * - Computed with the service client, not the caller's: a cache entry is
 *   shared across users, so it must not depend on who warmed it. That is
 *   safe here because every input (posts, snapshots, assignments, roles,
 *   member names) is workspace-scoped data all staff can read under RLS
 *   anyway, and the only pages that consume rankings sit behind the staff
 *   guards -- client-role users never reach them.
 *
 * - Invalidated by tag ("rankings"), busted from revalidateTeam() in
 *   actions.ts and the sync cron. The tag is global rather than
 *   per-workspace ON PURPOSE: a missed invalidation shows someone stale
 *   scores silently, an over-broad one merely recomputes ~1s of work on
 *   the next view. With one real workspace the trade is entirely one-sided.
 *
 * - AND a time bound, because the note above turned out to be the actual
 *   failure and not a theoretical one. Caught on 2026-08-12: the boards were
 *   reading 27 assignments where the database held 47, and no amount of
 *   reloading fixed it. The tag only fires when a WRITE GOES THROUGH THE APP;
 *   21 credits had been inserted out of band, so nothing ever invalidated,
 *   and unstable_cache with no `revalidate` keeps an entry indefinitely. The
 *   result was every rankings-derived figure on /content silently describing
 *   a snapshot from before those credits existed -- exactly the "stale scores
 *   silently" case this comment already warned about.
 *
 *   A tag that only fires on in-app writes cannot be the ONLY defence for
 *   data that other processes also write: the worker, the sync cron, SQL and
 *   scripts all touch these tables. So staleness is now bounded to a minute.
 *   The tag still gives prompt invalidation on the common path; the window is
 *   the floor under it, and it costs one ~1s recompute per minute of active
 *   use. A wrong number on a performance board is worth far more than that.
 *
 * - The result carries Maps and a Set, which do not survive the cache's
 *   JSON round trip -- hence the freeze/thaw pair. Symptom if ever broken:
 *   scoredByContent.get is not a function on the second request.
 */

type FrozenRankings = Omit<
  RankingsResult,
  "scoredByPost" | "scoredByContent" | "postedContentIds"
> & {
  scoredByPost: [string, ScoredPost][];
  scoredByContent: [string, ScoredPost[]][];
  postedContentIds: string[];
};

function freeze(r: RankingsResult): FrozenRankings {
  return {
    ...r,
    scoredByPost: [...r.scoredByPost.entries()],
    scoredByContent: [...r.scoredByContent.entries()],
    postedContentIds: [...r.postedContentIds],
  };
}

function thaw(f: FrozenRankings): RankingsResult {
  return {
    ...f,
    scoredByPost: new Map(f.scoredByPost),
    scoredByContent: new Map(f.scoredByContent),
    postedContentIds: new Set(f.postedContentIds),
  };
}

const cached = unstable_cache(
  async (ws: string): Promise<FrozenRankings> =>
    freeze(await computeRankings(serviceClient(), ws)),
  // v2: computeRankings now excludes archived clients' work. Without the bump
  // the first request after deploy would serve a pre-filter entry -- correct
  // code returning the old wrong numbers, which is the hardest kind of stale
  // to diagnose because nothing in the diff looks responsible.
  ["rankings-v2"],
  // revalidate is in SECONDS and is the ceiling on how wrong these numbers
  // can be. Do not remove it in favour of "the tag handles it" -- the tag
  // does not fire for writes that bypass the app, which is how this went
  // stale in the first place.
  { tags: ["rankings"], revalidate: 60 },
);

export async function cachedRankings(ws: string): Promise<RankingsResult> {
  return thaw(await cached(ws));
}
