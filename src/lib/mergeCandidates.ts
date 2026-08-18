/**
 * Finding two rows that describe the same single post.
 *
 * The whole design problem here is that a wrong suggestion is expensive.
 * Merging folds two rows into one and moves posts, credits and tracked time
 * across; it is undoable, but only if someone notices. So this errs hard
 * toward silence: every rule below exists to refuse a pair rather than to
 * find one.
 *
 * WHAT CHANGED, and what it costs. This used to look for cross-posts -- the
 * same caption on TikTok and Instagram -- and it found 42 groups on live data.
 * Those groups are not duplicates. Two platforms carrying the same video are
 * two posts with two audiences and two reach curves, and merging them throws
 * one away. Restricted to a single platform, the same live data yields ZERO
 * suggestions, and no client currently runs two accounts on one platform, so
 * the only same-platform pair that exists is two rows on the SAME account --
 * which merge_content_items refuses by design, because one account posting
 * twice is two videos.
 *
 * So this finds nothing today, and that is the correct amount. It stays
 * because the case it looks for is real: a re-import or a hand-added row that
 * duplicates something the sync already had. When that happens it will be one
 * platform, and this will say so.
 */

export type MergeCandidateVideo = {
  id: string;
  title: string;
  clientId: string | null;
  clientName: string | null;
  producedAt: string | null;
  platforms: { platform: string }[];
  postCount: number;
  /** The accounts this video's posts sit on, one entry per post. */
  accountIds?: string[];
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

    // SAME PLATFORM ONLY. This rule was the exact opposite until now: a group
    // had to span platforms, on the theory that one video cross-posted to
    // TikTok and Instagram is one video. In practice that reading is wrong
    // often enough to be worse than useless. A TikTok and a YouTube Short with
    // the same caption are two posts, made at different times, to different
    // audiences, each with its own reach curve -- folding them into one row
    // hides one of them and produces a video whose "platforms" list implies a
    // cross-post that nobody actually performed. Matching captions is weak
    // evidence, and it was being asked to carry a strong conclusion.
    //
    // Merge is now what its name suggests: two rows describing ONE post on ONE
    // platform, collapsed back into one. That is the only case where the
    // second row is genuinely not a thing that exists.
    //
    // Zero platforms is allowed as well as one. A group where nothing has been
    // posted is two hand-added rows for the same video, which is a duplicate
    // with no posts to conflict -- and refusing it here while the bulk bar's
    // merge button offers exactly that case would leave the two halves of one
    // feature disagreeing about what a duplicate is.
    const platforms = [...new Set(list.flatMap((v) => v.platforms.map((p) => p.platform)))].sort();
    if (platforms.length > 1) continue;

    // Every row must still be a single post. More than one post under one row
    // means it has been merged before, and re-merging it risks folding a split
    // somebody made on purpose back together. Counting posts rather than
    // platforms is what catches this now: with the group pinned to one
    // platform, a previously merged row no longer stands out by its platform
    // list, only by carrying two posts.
    if (list.some((v) => (v.postCount ?? 1) > 1)) continue;

    /**
     * NO ACCOUNT MAY APPEAR TWICE. One account posting twice is two videos.
     *
     * This is merge_content_items' own rule, restated here because the finder
     * has to know it: without this, the panel proposes merges the database
     * will refuse, which is a worse offer than no offer.
     *
     * It became load-bearing the moment the platform rule inverted. Requiring
     * a group to span platforms used to make this impossible for free -- two
     * posts on one account cannot be on two platforms -- so a reused caption
     * was harmless. Pinned to one platform, the caption is the ONLY evidence
     * left, and a caption gets reused: "Email to inquire!" on @tiltedneedle
     * named two genuinely different TikToks a month apart, and the panel
     * offered to merge them.
     *
     * Rows with no posts carry no accounts and so are unaffected, which is
     * right: a hand-added duplicate has no account to clash on.
     */
    const accts = list.flatMap((v) => v.accountIds ?? []);
    if (new Set(accts).size !== accts.length) continue;

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
