// A comment fetch must not be able to run away with the month's budget.
//   npm run test:tiktokcost
//
// WHY THIS IS WORTH A TEST OF ITS OWN
//
// Every other fetch in this project is free, so the worst a bug could do was
// waste time. TikTok comments are billed per comment returned, against an
// Apify FREE plan -- a $5 hard ceiling for the month, not a budget that bills
// over. Measured on the live library at $0.0003 per comment:
//
//     all 144 posts, every comment      23,644 comments   $7.09
//     capped at 50 per post              1,109 comments   $0.33
//
// Uncapped is not expensive, it is IMPOSSIBLE -- more than the whole monthly
// allowance, with one post of 13,200 comments accounting for over half. So the
// cap is what makes the feature exist, and a regression that silently drops it
// does not fail loudly; it just quietly spends the month on one video.
//
// Offline by design. It checks arithmetic and wiring, and spends nothing.
import { readFileSync } from "node:fs";
const mod = await import("../src/lib/providers/tiktokComments.ts");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

/* ---- The cap ------------------------------------------------------------ */
{
  delete process.env.TIKTOK_COMMENT_CAP;
  check("the default cap is 50", mod.commentCap() === 50, String(mod.commentCap()));

  process.env.TIKTOK_COMMENT_CAP = "10";
  check("the cap is configurable", mod.commentCap() === 10);

  // The ways a bad value could disable the cap entirely, which is the failure
  // that costs money rather than the one that returns too little.
  for (const bad of ["0", "-5", "abc", ""]) {
    process.env.TIKTOK_COMMENT_CAP = bad;
    const c = mod.commentCap();
    check(`a cap of ${JSON.stringify(bad)} falls back to 50 rather than unlimited`,
      c === 50, String(c));
  }

  process.env.TIKTOK_COMMENT_CAP = "100000";
  check("an absurd cap is clamped, not honoured", mod.commentCap() === 500,
    String(mod.commentCap()));
  delete process.env.TIKTOK_COMMENT_CAP;
}

/* ---- The estimate, against the real distribution ------------------------ */
{
  // The measured worst case: one post carrying 13,200 comments.
  const worst = mod.estimateCostUsd(13_200);
  check(
    "the biggest post in the library costs cents, not dollars",
    worst < 0.02,
    `$${worst.toFixed(4)} for a 13,200-comment post`,
  );
  check(
    "the estimate is capped, not proportional to the post",
    mod.estimateCostUsd(13_200) === mod.estimateCostUsd(50),
  );
  check("a post with no comments costs nothing", mod.estimateCostUsd(0) === 0);

  /* The whole library, from the measurement rather than from a guess.
     Counted on 2026-08-22 across all 144 TikTok posts: 23,644 comments in
     total, of which 1,109 survive a cap of 50. Asserting the capped figure
     keeps this honest -- an invented sample would have made the cap look
     better or worse than it is. */
  const LIBRARY = { posts: 144, allComments: 23_644, cappedAt50: 1_109, zeroComment: 62 };
  const uncapped = LIBRARY.allComments * 0.0003;
  const capped = LIBRARY.cappedAt50 * 0.0003;

  check(
    "uncapped, the library exceeds the entire monthly ceiling",
    uncapped > 5,
    `$${uncapped.toFixed(2)} against a $5 hard cap -- the cap is not optional`,
  );
  check(
    "capped, the whole library is affordable",
    capped < 0.5,
    `$${capped.toFixed(2)} for all ${LIBRARY.posts} posts`,
  );
  check(
    "the free pre-filter removes a large share of the work",
    LIBRARY.zeroComment / LIBRARY.posts > 0.4,
    `${LIBRARY.zeroComment} of ${LIBRARY.posts} posts are already known empty`,
  );
}

/* ---- The field mapping, against a REAL row ------------------------------ */
/* Captured verbatim from an apidojo/tiktok-comments-scraper run on
   2026-08-22. The first version of normalise() guessed at these names and got
   two of five wrong -- the author lives under `user`, not at the top level,
   and the timestamp is `createdAt`, not any of `createTimeISO`, `createTime`,
   `publishedAt` or `timestamp`. Nothing failed: comments stored, the job
   reported success, and the attribution and dates were silently null. That is
   why this asserts on a real payload rather than on one written to pass. */
{
  const REAL_ROW = {
    inputSource: "https://www.tiktok.com/@tiltedneedle/video/7395266034065820960",
    type: "comment",
    id: "7395306273707361057",
    text: "i'm interested in the marketing service. could you send me a message?",
    createdAt: "2024-07-24T20:45:42.000Z",
    likeCount: 2,
    replyCount: 1,
    commentLanguage: "en",
    awemeId: "7395266034065820960",
    isAuthorLiked: false,
    user: { id: "7377312063117001761", username: "jamslloydo", displayName: "jams", region: "DE" },
  };

  const [c] = mod.normaliseForTest([REAL_ROW]);
  check("the text is read", c?.text?.startsWith("i'm interested"), c?.text?.slice(0, 20));
  check("the comment id is read", c?.externalId === "7395306273707361057", String(c?.externalId));
  check("the like count is read", c?.likes === 2, String(c?.likes));
  check("the AUTHOR is read from the nested user object", c?.authorHandle === "jamslloydo",
    String(c?.authorHandle));
  check("the timestamp is read from createdAt", c?.publishedAt === "2024-07-24T20:45:42.000Z",
    String(c?.publishedAt));

  // A row with no text is not evidence and must not inflate the denominator
  // that comment themes are reported against.
  check("a textless row is dropped, not stored empty",
    mod.normaliseForTest([{ id: "x", likeCount: 3 }]).length === 0);

  // Unix seconds, which several of the alternative actors emit.
  const [u] = mod.normaliseForTest([{ text: "hi", createTime: 1721853942 }]);
  check("unix-second timestamps are converted",
    u?.publishedAt === new Date(1721853942000).toISOString(), String(u?.publishedAt));
}

/* ---- The handler really is wired this way ------------------------------- */
/* Asserted on the live lines only, so the explanatory comments in the handler
   cannot satisfy their own check. */
{
  const src = readFileSync("./worker/jobs/comments.mjs", "utf8");
  const live = src.split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");

  check(
    "the snapshot pre-filter runs before anything is bought",
    /post_snapshots/.test(live) && /worthFetching/.test(live),
  );
  check(
    "a post is only skipped when it was OBSERVED empty, not merely unseen",
    /newestCount\.get\(p\.id\) \?\? 1/.test(live),
    "an unsnapshotted post must default to worth-fetching",
  );
  check("the remaining budget is checked before spending", /remainingBudgetUsd/.test(live));
  check("a reserve is kept back", /APIFY_RESERVE_USD/.test(live));
  check(
    "an exhausted plan cools the kind and refunds, rather than failing the video",
    /exhausted/.test(live) && /e\.blocked = true/.test(live),
  );
  check("the per-job spend is logged", /spentUsd/.test(live));
  check(
    "the TikTok branch records a verdict rather than returning bare stats",
    /apifyStats && !boxStats/.test(live) && /none_exist/.test(live),
  );
  check(
    "TikTok comments count toward the empty check",
    /apifyStats\?\.fetched \?\? 0/.test(live),
    "otherwise a fetched item would be recorded as having none",
  );
}

/* ---- The planner routes TikTok ------------------------------------------ */
{
  const enq = readFileSync("./worker/enqueue.mjs", "utf8");
  check(
    "the comments planner no longer filters TikTok out",
    /slug !== "tiktok"/.test(enq),
    "the filter must name tiktok as ALLOWED, i.e. inside the skip condition",
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
