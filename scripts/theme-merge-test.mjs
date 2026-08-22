// Merging vocabularies must never invent a count.
//   npm run test:thememerge
//
// Comment themes are labelled per post, so every analysis invents its own
// vocabulary: "how much is it", "Pricing?" and "what's the cost" are one
// audience question wearing three labels with zero lexical overlap. Embeddings
// merge them -- but the merge sits directly upstream of the first client-level
// audience statement the system makes, so the property that matters most is
// not the clustering, it is that THE COUNTING DISCIPLINE SURVIVES: a merged
// count is a union of verified comment-id sets, and no model ever asserts a
// number.
//
// Offline: clustering and counting are pure functions, and the embeddings are
// stand-ins with known geometry, because what is under test is the machinery
// rather than the model.
import {
  mergeThemes, agglomerate, cosineDistance, MERGE_DISTANCE,
} from "../src/lib/analysis/themeMerge.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

/* Unit vectors at controlled angles: cos distance between v(0) and v(deg) is
   1 - cos(deg). 15 degrees ~ 0.034 (paraphrase-close), 90 degrees = 1. */
const v = (deg) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];

const theme = (label, ids, post = "p1", sentiment = null) => ({
  analysisId: "a1", postOrItemId: post, label, sentiment, commentIds: ids,
});

/* ---- Geometry ----------------------------------------------------------- */
{
  check("identical vectors are at distance 0", cosineDistance(v(0), v(0)) < 1e-12);
  check("orthogonal vectors are at distance 1", Math.abs(cosineDistance(v(0), v(90)) - 1) < 1e-12);
  const close = cosineDistance(v(0), v(10));
  check("paraphrase-close vectors sit inside the cut",
    close < MERGE_DISTANCE, close.toFixed(3));
  const far = cosineDistance(v(0), v(60));
  check("different-topic vectors sit outside it",
    far > MERGE_DISTANCE, far.toFixed(3));
}

/* ---- Clustering --------------------------------------------------------- */
{
  const clusters = agglomerate([v(0), v(8), v(80), v(85)], MERGE_DISTANCE);
  check("two tight pairs form two clusters", clusters.length === 2,
    JSON.stringify(clusters));

  check("an empty input yields no clusters", agglomerate([], MERGE_DISTANCE).length === 0);
  check("a single vector is its own cluster",
    agglomerate([v(0)], MERGE_DISTANCE).length === 1);

  // Determinism: the same input gives the same clusters, always. A client's
  // themes must not change because a seed moved -- there is no seed.
  const a = agglomerate([v(0), v(8), v(80), v(85), v(40)], MERGE_DISTANCE);
  const b = agglomerate([v(0), v(8), v(80), v(85), v(40)], MERGE_DISTANCE);
  check("clustering is deterministic", JSON.stringify(a) === JSON.stringify(b));

  /* Average linkage, not single: a chain of pairwise-close points must not
     drag two far-apart groups together through a middle point.

     The angles are chosen from the arithmetic, because the first version of
     this fixture used 0/25/50 and FAILED -- correctly. There, the average link
     from {0,25} to {50} is (0.357+0.094)/2 = 0.226, genuinely under the 0.35
     cut, so merging all three is the right answer, not chaining. At 0/32/64
     the average is (0.562+0.152)/2 = 0.357, just over the cut, while the
     single link (0.152) is well under it -- exactly the case where the two
     linkages disagree and average is the one we want. */
  const chain = agglomerate([v(0), v(32), v(64)], MERGE_DISTANCE);
  check("average linkage resists chaining through a middle point",
    chain.length === 2,
    `${chain.length} clusters from a 0/32/64-degree chain (single linkage would give 1)`);
}

/* ---- The counting discipline -------------------------------------------- */
{
  // Three labels for one question, plus one genuinely different topic.
  const themes = [
    theme("How much is it", ["c1", "c2"], "p1"),
    theme("Pricing?", ["c2", "c3"], "p2"),        // c2 appears under both
    theme("What's the cost", ["c4"], "p3"),
    theme("Where is this filmed", ["c9"], "p1"),
  ];
  const vecs = [v(0), v(6), v(12), v(90)];
  const merged = mergeThemes(themes, vecs);

  check("paraphrases merge and the different topic survives",
    merged.length === 2, `${merged.length} themes`);

  const price = merged.find((m) => m.sourceCount === 3);
  check("the merged count is a UNION of verified ids, deduplicated",
    price?.commentCount === 4,
    `c1..c4 with c2 shared -> ${price?.commentCount} (a sum would say 5)`);
  check("the union can never exceed the distinct comments",
    price.commentIds.length === new Set(price.commentIds).size);
  check("post coverage is counted across the merge",
    price.postCount === 3, String(price?.postCount));
  check("member labels are preserved for audit",
    price.memberLabels.length === 3, price?.memberLabels.join(" / "));
}

/* ---- The label and the sentiment ---------------------------------------- */
{
  const themes = [
    theme("Pricing questions", ["c1"], "p1", "neutral"),
    theme("Pricing questions", ["c2"], "p2", "neutral"),
    theme("Cost concerns", ["c3"], "p3", "negative"),
  ];
  const merged = mergeThemes(themes, [v(0), v(4), v(8)]);
  check("the most common label wins", merged[0]?.label === "Pricing questions",
    merged[0]?.label);
  check("a clear sentiment majority is kept", merged[0]?.sentiment === "neutral");

  const split = mergeThemes(
    [theme("Praise", ["c1"], "p1", "positive"), theme("Complaints", ["c2"], "p2", "negative")],
    [v(0), v(5)],
  );
  check("a merged theme with no sentiment majority reports none",
    split[0]?.sentiment === null,
    "praise plus complaints has no honest single sentiment");
}

/* ---- Guard rails --------------------------------------------------------- */
{
  let threw = false;
  try { mergeThemes([theme("x", ["c1"])], []); } catch { threw = true; }
  check("a theme/vector length mismatch throws rather than misaligning", threw,
    "silent misalignment would attach the wrong embedding to every label after the gap");

  check("no themes yields no merges", mergeThemes([], []).length === 0);

  const sorted = mergeThemes(
    [theme("Small", ["c1"], "p1"), theme("Big", ["c2", "c3", "c4"], "p2")],
    [v(0), v(90)],
  );
  check("results are ordered largest first",
    sorted[0].commentCount >= sorted[1].commentCount);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
