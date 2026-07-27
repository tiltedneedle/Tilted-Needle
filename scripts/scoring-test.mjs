// Tests for the scoring math (PRD section 5).
//
// These numbers decide how people are ranked, so the properties that make the
// model fair are asserted directly -- especially that platforms never pool,
// that small samples stay near the mean, and that age and channel size are
// normalised away.
//
//   npm run test:scoring
// Loads the TypeScript source directly via Node's built-in type stripping,
// so the tests exercise the same file the app imports.
const S = await import("../src/lib/scoring.ts");

let pass = 0,
  fail = 0;

const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  if (ok) pass++;
  else fail++;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const day = (n) => new Date(2026, 0, 1 + n);

/* -- maturity window ----------------------------------------------------- */
{
  const posted = day(0);
  const snaps = [
    { capturedAt: day(1), value: 100 },
    { capturedAt: day(7), value: 500 },
    { capturedAt: day(30), value: 900 },
  ];
  const v = S.valueAtMaturity(snaps, posted, 7, day(60));
  check("reads the value at the maturity window, not lifetime",
    v.value === 500 && v.isMature, `got ${v.value}`);

  // The whole point: an old post must not win on accumulated views.
  const young = S.valueAtMaturity(
    [{ capturedAt: day(1), value: 100 }], posted, 7, day(2));
  check("flags a post that has not reached the window as immature",
    young.value === 100 && !young.isMature);

  check("returns null when there are no snapshots",
    S.valueAtMaturity([], posted, 7, day(60)) === null);

  // Window closed but nobody recorded inside it -- use the best evidence.
  const late = S.valueAtMaturity(
    [{ capturedAt: day(2), value: 300 }], posted, 7, day(40));
  check("uses latest reading once the window has closed",
    late.value === 300 && late.isMature);
}

/* -- baseline and index -------------------------------------------------- */
{
  check("median of an odd list", S.median([3, 1, 2]) === 2);
  check("median of an even list", S.median([1, 2, 3, 4]) === 2.5);
  check("baseline ignores zero-value posts",
    S.accountBaseline([0, 0, 10, 20, 30]) === 20);
  check("baseline is null without history",
    S.accountBaseline([]) === null);
  check("baseline uses only the trailing window",
    S.accountBaseline([1000, 1000, 1, 2, 3], 3) === 2);

  check("index is a ratio against the account's own norm",
    S.perfIndex(200, 100) === 2);
  check("index is null when the baseline is zero",
    S.perfIndex(200, 0) === null);
}

/* -- channel size normalisation ------------------------------------------ */
{
  // The core fairness property: a small channel doing 2x its norm must score
  // exactly the same as a huge channel doing 2x its norm.
  const small = S.logScore(S.perfIndex(50_000, 25_000));
  const huge = S.logScore(S.perfIndex(5_000_000, 2_500_000));
  check("channel size does not affect the score", near(small, huge),
    `${small} vs ${huge}`);
}

/* -- log transform and recency ------------------------------------------- */
{
  check("at baseline scores exactly zero", S.logScore(1) === 0);
  check("above baseline scores positive", S.logScore(2) > 0);
  check("below baseline scores negative", S.logScore(0.5) < 0);
  // Symmetry: 2x above and 2x below are equal and opposite.
  check("log makes over and under performance symmetric",
    near(S.logScore(2), -S.logScore(0.5)));

  check("recency weight is 1 for a post made now",
    near(S.recencyWeight(day(10), day(10)), 1));
  check("recency weight halves after one half-life",
    near(S.recencyWeight(day(0), day(90)), 0.5));
  check("recency weight quarters after two half-lives",
    near(S.recencyWeight(day(0), day(180)), 0.25));
}

/* -- shrinkage ----------------------------------------------------------- */
{
  const roleMean = 0;
  const lucky = 2.0; // one spectacular post

  const n1 = S.shrink(lucky, 1, roleMean);
  const n20 = S.shrink(lucky, 20, roleMean);
  check("a single lucky post is pulled hard toward the role mean",
    near(n1, (1 / 6) * 2), `got ${n1}`);
  check("a long record is trusted far more", n20 > n1 && near(n20, (20 / 25) * 2));
  check("shrinkage is monotonic in sample size",
    S.shrink(lucky, 3, 0) < S.shrink(lucky, 10, 0));
  check("zero posts falls back entirely to the role mean",
    S.shrink(lucky, 0, 0.42) === 0.42);
}

/* -- per-account scoring ------------------------------------------------- */
{
  const mk = (id, dayN, value) => ({
    postId: id,
    accountId: "a1",
    platform: "instagram",
    postedAt: day(dayN),
    snapshots: [{ capturedAt: day(dayN + 8), value }],
  });

  // Ten baseline posts at 1000, then one at 3000.
  const posts = [];
  for (let i = 0; i < 10; i++) posts.push(mk(`p${i}`, i * 10, 1000));
  posts.push(mk("star", 100, 3000));

  const scored = S.scoreAccountPosts(posts, 7, day(200));
  const star = scored.find((s) => s.postId === "star");
  check("a post is scored against the posts before it",
    star && near(star.index, 3), `index ${star?.index}`);
  check("the first post has no baseline and is skipped",
    !scored.some((s) => s.postId === "p0"));
}

/* -- platform independence (the cardinal rule) --------------------------- */
{
  // Same relative performance, wildly different raw counts. TikTok counts a
  // view on impression; Instagram does not. The scores must still match.
  const ig = [{ postId: "i", platform: "instagram", index: 2, score: Math.log(2), weight: 1, isMature: true }];
  const tt = [{ postId: "t", platform: "tiktok", index: 2, score: Math.log(2), weight: 1, isMature: true }];

  const igScore = S.platformScore("instagram", ig, 0);
  const ttScore = S.platformScore("tiktok", tt, 0);
  check("identical relative performance scores identically across platforms",
    near(igScore.score, ttScore.score));

  check("below the minimum post count a platform is not rankable",
    igScore.rankable === false && igScore.n === 1);

  const many = Array.from({ length: 5 }, (_, i) => ({
    postId: `p${i}`, platform: "tiktok", index: 2,
    score: Math.log(2), weight: 1, isMature: true,
  }));
  check("at or above the minimum a platform becomes rankable",
    S.platformScore("tiktok", many, 0).rankable === true);
}

/* -- overall = mean of platform scores ----------------------------------- */
{
  const platforms = [
    { platform: "instagram", score: 1.0, n: 50, rankable: true },
    { platform: "tiktok", score: 0.0, n: 2, rankable: false },
  ];
  const o = S.overallScore(platforms);
  check("overall is the unweighted mean of platform scores",
    near(o.overall, 0.5), `got ${o.overall}`);
  check("overall keeps the per-platform breakdown attached",
    o.platforms.length === 2);

  // The documented consequence of unweighted averaging, asserted so nobody
  // "fixes" it by accident: 2 TikToks carry the same weight as 50 IG posts.
  check("volume does not shift the overall under unweighted averaging",
    near(S.overallScore([
      { platform: "instagram", score: 1.0, n: 5000, rankable: true },
      { platform: "tiktok", score: 0.0, n: 2, rankable: false },
    ]).overall, 0.5));

  // Absence of evidence is not bad performance.
  const withEmpty = S.overallScore([
    { platform: "instagram", score: 1.0, n: 10, rankable: true },
    { platform: "facebook", score: 0, n: 0, rankable: false },
  ]);
  check("platforms with no posts are excluded, not counted as zero",
    near(withEmpty.overall, 1.0) && withEmpty.contributing === 1,
    `got ${withEmpty.overall}`);

  check("no data anywhere yields null, never zero",
    S.overallScore([{ platform: "x", score: 0, n: 0, rankable: false }]).overall === null);
}

/* -- presentation -------------------------------------------------------- */
{
  check("unrankable always reads as insufficient, never as a low score",
    S.tierFor(-5, false) === "insufficient");
  check("well above baseline tiers correctly", S.tierFor(Math.log(2), true) === "top");
  check("at baseline tiers correctly", S.tierFor(0, true) === "at");
  check("below baseline tiers correctly", S.tierFor(Math.log(0.5), true) === "below");
  check("multiplier form round-trips", near(S.asMultiplier(Math.log(2)), 2));
  check("boost detection uses the account's own baseline",
    S.isBoost(2.5) === true && S.isBoost(1.5) === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
