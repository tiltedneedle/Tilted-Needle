/**
 * Merge per-post comment themes into client-level ones.
 *
 * THE PROBLEM: every comment_themes analysis invents its own vocabulary.
 * "How much is it", "Pricing?" and "What's the cost" are the same audience
 * question wearing three labels with zero lexical overlap, so no SQL over the
 * labels can see that they agree -- tsvector and pg_trgm match words, and
 * there are no shared words. Embeddings are the only tool in the stack that
 * can, and this is the first of the three jobs the retrieval layer exists for.
 *
 * THE COUNTING DISCIPLINE SURVIVES THE MERGE, and this is the part that must
 * not be lost in the plumbing: tallyThemes counts comment ids the model
 * returned and the system verified -- hallucinated ids are dropped and
 * reported. A merged theme's count is therefore the UNION of verified id
 * sets, deduplicated. At no point does a model assert a number.
 *
 * The clustering is agglomerative, average-linkage, on cosine distance, with
 * a FIXED cut -- deterministic, no seed, so a client's themes do not change
 * because a random number moved. At a few hundred labels the O(n^3) of the
 * naive implementation is microseconds.
 */

export type SourceTheme = {
  /** ai_analyses row it came from, for audit. */
  analysisId: string;
  postOrItemId: string;
  label: string;
  sentiment: string | null;
  /** VERIFIED ids -- already filtered by tallyThemes. */
  commentIds: string[];
};

export type MergedTheme = {
  /** The most common label among members, pending a nicer model-written name. */
  label: string;
  sentiment: string | null;
  commentIds: string[];
  commentCount: number;
  sourceCount: number;
  postCount: number;
  memberLabels: string[];
};

/**
 * Cosine distance threshold for "the same theme".
 *
 * Tight on purpose. A loose cut merges "pricing questions" with "product
 * questions" and produces a mush that reads as insight while erasing the
 * distinction a marketer would act on. Labels that SHOULD merge -- paraphrases
 * of one question -- sit very close in embedding space; 0.35 keeps paraphrases
 * together and holds genuinely different topics apart. Wrong in the cautious
 * direction by design: an unmerged duplicate is visible and fixable, an
 * over-merged mush is neither.
 */
export const MERGE_DISTANCE = 0.35;

export function cosineDistance(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const den = Math.sqrt(na) * Math.sqrt(nb);
  return den > 0 ? 1 - dot / den : 1;
}

/**
 * Average-linkage agglomerative clustering with a fixed distance cut.
 * Returns cluster membership as index arrays over the input.
 */
export function agglomerate(vectors: number[][], cut: number): number[][] {
  const n = vectors.length;
  if (n === 0) return [];

  const clusters: number[][] = vectors.map((_, i) => [i]);
  // Pairwise distances between original points, computed once.
  const d: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      d[i][j] = d[j][i] = cosineDistance(vectors[i], vectors[j]);
    }
  }
  const avgLink = (a: number[], b: number[]) => {
    let s = 0;
    for (const i of a) for (const j of b) s += d[i][j];
    return s / (a.length * b.length);
  };

  for (;;) {
    let best = Infinity, bi = -1, bj = -1;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const link = avgLink(clusters[i], clusters[j]);
        if (link < best) { best = link; bi = i; bj = j; }
      }
    }
    if (bi < 0 || best > cut) break;
    clusters[bi] = [...clusters[bi], ...clusters[bj]];
    clusters.splice(bj, 1);
    if (clusters.length === 1) break;
  }
  return clusters;
}

/**
 * Merge one client's themes given embeddings for each label.
 * `vectors[i]` embeds `themes[i].label`.
 */
export function mergeThemes(themes: SourceTheme[], vectors: number[][]): MergedTheme[] {
  if (themes.length !== vectors.length) {
    throw new Error(`${themes.length} themes but ${vectors.length} vectors`);
  }
  if (!themes.length) return [];

  const clusters = agglomerate(vectors, MERGE_DISTANCE);

  return clusters.map((members) => {
    const mine = members.map((i) => themes[i]);

    /* Union of VERIFIED ids. A comment can legitimately appear under two
       source themes of the same post; the union counts it once, so the merged
       count can never exceed the number of distinct verified comments. */
    const ids = new Set<string>();
    for (const t of mine) for (const id of t.commentIds) ids.add(id);

    // The most common label, ties broken by which covers more comments --
    // stable and explainable, where "ask the model to name it" would not be.
    const byLabel = new Map<string, { n: number; comments: number }>();
    for (const t of mine) {
      const e = byLabel.get(t.label) ?? { n: 0, comments: 0 };
      e.n += 1;
      e.comments += t.commentIds.length;
      byLabel.set(t.label, e);
    }
    const label = [...byLabel.entries()].sort(
      (a, b) => b[1].n - a[1].n || b[1].comments - a[1].comments || a[0].localeCompare(b[0]),
    )[0][0];

    /* Majority sentiment, and null when there is no majority -- a merged
       theme spanning praise and complaints has no honest single sentiment,
       and picking one would misdescribe half its members. */
    const sentiments = mine.map((t) => t.sentiment).filter(Boolean) as string[];
    const counts = new Map<string, number>();
    for (const s of sentiments) counts.set(s, (counts.get(s) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const sentiment = top && top[1] > sentiments.length / 2 ? top[0] : null;

    return {
      label,
      sentiment,
      commentIds: [...ids].sort(),
      commentCount: ids.size,
      sourceCount: mine.length,
      postCount: new Set(mine.map((t) => t.postOrItemId)).size,
      memberLabels: [...new Set(mine.map((t) => t.label))].sort(),
    };
  }).sort((a, b) => b.commentCount - a.commentCount);
}
