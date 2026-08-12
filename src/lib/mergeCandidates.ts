/**
 * Finding the same video posted to two platforms.
 *
 * Merging has existed since the cross-platform work, and on live data it had
 * been used exactly zero times while 26 pairs sat unmerged. The mechanism was
 * never the missing piece -- discovery was. Nobody scrolls 286 rows looking
 * for the Instagram twin of a TikTok they posted in March.
 *
 * The whole design problem here is that a wrong suggestion is expensive.
 * Merging folds two rows into one and moves posts, credits and tracked time
 * across; it is undoable, but only if someone notices. So this errs hard
 * toward silence: every rule below exists to refuse a pair rather than to
 * find one.
 */

export type MergeCandidateVideo = {
  id: string;
  title: string;
  clientId: string | null;
  clientName: string | null;
  producedAt: string | null;
  platforms: { platform: string }[];
  postCount: number;
};

export type MergeCandidate = {
  /** The normalised title the group agreed on, for display and for keys. */
  key: string;
  videos: MergeCandidateVideo[];
  /** Every platform across the group, in a stable order. */
  platforms: string[];
  clientName: string | null;
};

/**
 * Case, punctuation and emoji removed; runs of anything else become one space.
 *
 * The same caption cross-posted rarely survives byte-identical -- Instagram
 * keeps the emoji, TikTok drops them, one has a trailing hashtag -- so an
 * exact match finds almost nothing. Normalising is what makes this useful at
 * all, and is also why the length floor below has to exist.
 */
export function normaliseTitle(title: string): string {
  return String(title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Titles too short or too generic to mean anything on their own.
 *
 * "Untitled" is the important one: 41 rows carry it, and they are unrelated
 * videos whose platform gave us no caption. Grouping on it would propose
 * merging forty unrelated videos into one, which is the single worst thing
 * this feature could do.
 */
const GENERIC = new Set(["untitled", "reel", "video", "post", "shorts", "short", "clip"]);

/** Below this, a title is too weak to be evidence. Twelve characters is about
 *  three words -- enough to be a real caption rather than a label. */
const MIN_TITLE_LENGTH = 12;

export function findMergeCandidates(videos: MergeCandidateVideo[]): MergeCandidate[] {
  const groups = new Map<string, MergeCandidateVideo[]>();

  for (const v of videos) {
    const key = normaliseTitle(v.title);
    if (key.length < MIN_TITLE_LENGTH) continue;
    if (GENERIC.has(key)) continue;
    const list = groups.get(key) ?? [];
    list.push(v);
    groups.set(key, list);
  }

  const out: MergeCandidate[] = [];

  for (const [key, list] of groups) {
    if (list.length < 2) continue;

    // Same client only. Two clients can run the same campaign line, and
    // merging across them would silently move one client's video -- and its
    // tracked time -- onto another's books. That is a billing error, not a
    // tidy-up.
    const clients = new Set(list.map((v) => v.clientId));
    if (clients.size > 1) continue;

    // The pair has to actually span platforms. Two rows on the SAME platform
    // with the same caption are usually a genuine repost or a series entry,
    // not one video counted twice -- and merging them would destroy the
    // distinction between two real posts.
    const platforms = [...new Set(list.flatMap((v) => v.platforms.map((p) => p.platform)))].sort();
    if (platforms.length < 2) continue;

    // Every row must still be single-platform. A row already spanning two
    // platforms has been merged before; offering it again risks re-merging a
    // deliberate split back together.
    if (list.some((v) => new Set(v.platforms.map((p) => p.platform)).size > 1)) continue;

    out.push({
      key,
      videos: [...list].sort((a, b) => (b.postCount ?? 0) - (a.postCount ?? 0)),
      platforms,
      clientName: list[0]?.clientName ?? null,
    });
  }

  // Biggest groups first, then alphabetically so the order is stable between
  // renders rather than following whatever order the map happened to hold.
  return out.sort((a, b) => b.videos.length - a.videos.length || a.key.localeCompare(b.key));
}

/**
 * Which row should survive a merge.
 *
 * The one with the most posts, then the earliest produced date. Post count
 * first because that row already carries the most history; the earlier date
 * breaks ties toward the original rather than the cross-post, which is what
 * "the same video, also posted to X" means.
 */
export function suggestSurvivor(group: MergeCandidate): string {
  const ranked = [...group.videos].sort(
    (a, b) =>
      (b.postCount ?? 0) - (a.postCount ?? 0) ||
      String(a.producedAt ?? "9999").localeCompare(String(b.producedAt ?? "9999")),
  );
  return ranked[0]?.id ?? "";
}
