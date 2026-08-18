// What the bulk bar decides about a selection.
//
// Two rules, both worth testing away from the browser.
//
// MERGE is the destructive action in this product: it folds rows together and
// carries posts, credits and tracked time across. It used to be offered for
// cross-posts -- one caption on TikTok and Instagram -- which are two posts,
// not one video seen twice. Most of the cases below assert that the button is
// NOT offered, because a merge that should not have been possible is the
// failure that costs something.
//
// THE MASTER ASSIGNER's counts are the other half. "Credited" and "credited on
// all of them" are different facts, and a strip that showed only the first
// would quietly imply the second.
const B = await import("../src/lib/bulkSelection.ts");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

/* -- Merge gate ------------------------------------------------------------ */

eq("one video alone is never a merge",
  B.mergePlatformFor(["a"], { a: ["tiktok"] }), null);

eq("nothing selected is never a merge",
  B.mergePlatformFor([], {}), null);

eq("two rows on the same platform may merge",
  B.mergePlatformFor(["a", "b"], { a: ["tiktok"], b: ["tiktok"] }), "tiktok");

eq("three rows on the same platform may merge",
  B.mergePlatformFor(["a", "b", "c"], { a: ["tiktok"], b: ["tiktok"], c: ["tiktok"] }), "tiktok");

// THE RULE THAT INVERTED. This was the feature's entire purpose and is now
// the thing it refuses.
eq("tiktok and instagram is a cross-post, not a duplicate",
  B.mergePlatformFor(["a", "b"], { a: ["tiktok"], b: ["instagram"] }), null);

eq("youtube and youtube shorts are still two platforms",
  B.mergePlatformFor(["a", "b"], { a: ["youtube"], b: ["youtube_shorts"] }), null);

eq("one row already spanning platforms blocks the merge",
  B.mergePlatformFor(["a", "b"], { a: ["tiktok", "instagram"], b: ["tiktok"] }), null);

eq("one odd row out of five is enough to refuse",
  B.mergePlatformFor(["a", "b", "c", "d", "e"], {
    a: ["tiktok"], b: ["tiktok"], c: ["tiktok"], d: ["tiktok"], e: ["youtube"],
  }), null);

// The 41 hand-added rows carrying no link. Two of those under one title are
// one video entered twice, and there are no posts that could conflict.
eq("two rows with no post at all may merge, reported as 'none'",
  B.mergePlatformFor(["a", "b"], { a: [], b: [] }), "none");

eq("a missing entry counts as no posts, not as a crash",
  B.mergePlatformFor(["a", "b"], {}), "none");

// A hand-added row plus the synced row it duplicates: the case that actually
// happens. The no-link row contributes no platform, so the platform is the
// synced one, and the database has no account clash to refuse.
eq("a no-link row merges into the synced row it duplicates",
  B.mergePlatformFor(["manual", "synced"], { manual: [], synced: ["tiktok"] }), "tiktok");

eq("a no-link row does NOT bridge two different platforms",
  B.mergePlatformFor(["manual", "tt", "ig"], { manual: [], tt: ["tiktok"], ig: ["instagram"] }), null);

/* -- Master assigner rollup ------------------------------------------------ */

const c = (roleSlug, userId, userName) => ({ roleSlug, userId, userName });

{
  const got = B.creditedByRoleFor(["v1", "v2"], {
    v1: [c("editor", "u1", "Ana")],
    v2: [c("editor", "u1", "Ana")],
  });
  eq("someone on every selected video counts the whole selection",
    got.get("editor")?.[0]?.count, 2);
}

{
  const got = B.creditedByRoleFor(["v1", "v2", "v3"], {
    v1: [c("editor", "u1", "Ana")],
    v2: [c("editor", "u1", "Ana")],
    v3: [],
  });
  // This is the number the strip's "partial" dot depends on. Reporting 3 here
  // would claim a credit that one video does not have.
  eq("a gap is counted as a gap", got.get("editor")?.[0]?.count, 2);
}

{
  const got = B.creditedByRoleFor(["v1", "v2", "v3"], {
    v1: [c("editor", "u1", "Ana"), c("editor", "u2", "Bo")],
    v2: [c("editor", "u2", "Bo")],
    v3: [c("editor", "u2", "Bo")],
  });
  const list = got.get("editor") ?? [];
  eq("the widest coverage leads, so the avatar describes the batch", list[0]?.name, "Bo");
  eq("and the runner-up keeps its own count", list[1]?.count, 1);
}

{
  const got = B.creditedByRoleFor(["v1"], {
    v1: [c("editor", "u2", "Zoe"), c("editor", "u1", "Abe")],
  });
  // Equal counts must not leave the order to insertion, or the strip's avatar
  // changes identity between renders for no reason a person can see.
  eq("equal counts fall back to name", (got.get("editor") ?? []).map((h) => h.name).join(","), "Abe,Zoe");
}

{
  const got = B.creditedByRoleFor(["v1", "v2"], {
    v1: [c("editor", "u1", "Ana"), c("idea", "u2", "Bo")],
    v2: [c("idea", "u2", "Bo")],
  });
  eq("roles are kept apart", got.get("editor")?.[0]?.count, 1);
  eq("and each keeps its own tally", got.get("idea")?.[0]?.count, 2);
}

{
  // Guards the "3/2" display: a count above the selection size is nonsense on
  // screen and would make the partial dot unreachable.
  const got = B.creditedByRoleFor(["v1", "v2"], {
    v1: [c("editor", "u1", "Ana"), c("editor", "u1", "Ana")],
    v2: [c("editor", "u1", "Ana")],
  });
  eq("a duplicated credit on one video cannot push the count past the selection",
    got.get("editor")?.[0]?.count, 2);
}

{
  const got = B.creditedByRoleFor(["v1", "v2"], { v1: [], v2: [] });
  eq("an uncredited selection reports nothing rather than zeros", got.size, 0);
}

eq("an empty selection is fine", B.creditedByRoleFor([], {}).size, 0);

{
  const got = B.creditedByRoleFor(["v1", "missing"], { v1: [c("qc", "u1", "Ana")] });
  eq("a video with no entry does not throw", got.get("qc")?.[0]?.count, 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
