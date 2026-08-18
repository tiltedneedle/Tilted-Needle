// Counting one post once, at the workspace level.
//
// An Instagram collab appears on both collaborators' feeds, so the sync makes
// a platform_posts row under each account -- same external_id, same view
// count, because Instagram counted it once. Per client that is correct: each
// client's reach genuinely includes the post. Rolled up across the workspace
// it is a double count, and on live data it overstated the Instagram row by
// 1,372,117 views, 101,256 likes and 3 posts -- 14.5% of a figure someone
// would reconcile against Instagram's own dashboard and find no reason for.
//
// The rule that matters most here is the LAST one: a row with no key is
// always kept. "We cannot tell" must never become "drop it", because
// understating reach is the worse of the two errors.
const R = await import("../src/lib/rollup.ts");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const row = (platform, views, postKey, likes = 0, comments = 0) => ({ platform, views, likes, comments, postKey });
const ig = (t) => t.find((x) => x.platform === "instagram");

/* -- The collab case ------------------------------------------------------- */

{
  const rows = [
    row("instagram", 318475, "instagram|DOpOUIniMMq", 19006),
    row("instagram", 318475, "instagram|DOpOUIniMMq", 19006), // the twin
  ];
  eq("the same post under two accounts counts once", ig(R.totalsByPlatformUnique(rows)).views, 318475);
  eq("and as one post", ig(R.totalsByPlatformUnique(rows)).posts, 1);
  eq("likes too", ig(R.totalsByPlatformUnique(rows)).likes, 19006);
  // The un-deduped function is unchanged and still used per client, where the
  // second copy is a real part of that client's reach.
  eq("totalsByPlatform still counts both, which is right per client",
    ig(R.totalsByPlatform(rows)).views, 636950);
}

{
  // The twins drifted because each was scraped independently. Whichever
  // survives, exactly one must.
  const rows = [row("instagram", 2092, "instagram|DbVMWizI9Dw"), row("instagram", 2111, "instagram|DbVMWizI9Dw")];
  const t = ig(R.totalsByPlatformUnique(rows));
  check("drifted twins collapse to one of them", t.views === 2092 || t.views === 2111, String(t.views));
  eq("and never to their sum", t.posts, 1);
}

/* -- What must NOT be collapsed -------------------------------------------- */

eq("two different posts on one platform both count",
  ig(R.totalsByPlatformUnique([row("instagram", 100, "instagram|A"), row("instagram", 50, "instagram|B")])).views, 150);

{
  // The same external id on two platforms is two different posts. The key is
  // platform-qualified precisely so this cannot collapse.
  const t = R.totalsByPlatformUnique([row("tiktok", 100, "tiktok|X"), row("instagram", 50, "instagram|X")]);
  eq("the same id on two platforms stays two posts", t.length, 2);
  eq("tiktok keeps its own", t.find((x) => x.platform === "tiktok").views, 100);
}

// THE SAFETY RULE. No key means no evidence of duplication.
eq("rows with no key are all kept",
  ig(R.totalsByPlatformUnique([row("instagram", 100, null), row("instagram", 50, null)])).views, 150);

eq("undefined key is treated the same as null",
  ig(R.totalsByPlatformUnique([
    { platform: "instagram", views: 100, likes: 0, comments: 0 },
    { platform: "instagram", views: 50, likes: 0, comments: 0 },
  ])).views, 150);

eq("a keyed row and an unkeyed row are not conflated",
  ig(R.totalsByPlatformUnique([row("instagram", 100, "instagram|A"), row("instagram", 50, null)])).views, 150);

/* -- Shape -------------------------------------------------------------- */

eq("an empty list is fine", R.totalsByPlatformUnique([]).length, 0);

{
  const t = R.totalsByPlatformUnique([
    row("youtube", 10, "youtube|A"),
    row("tiktok", 900, "tiktok|B"),
    row("instagram", 500, "instagram|C"),
  ]);
  eq("platforms stay separate and ordered by reach", t.map((x) => x.platform).join(","), "tiktok,instagram,youtube");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
