// Tests for merge suggestions -- SAME PLATFORM ONLY.
//
// The polarity of the platform rule inverted here, so most of these cases
// changed sides. It used to require a group to SPAN platforms, on the theory
// that one caption on TikTok and Instagram is one video cross-posted. It is
// not: those are two posts, two audiences, two reach curves, and folding them
// together hides one of them behind a record of a cross-post nobody made.
// A duplicate is two rows describing ONE post, which means one platform.
//
// Nearly all of these assert a REFUSAL, which is the point. Merging folds two
// rows into one and carries posts, credits and tracked time across; a wrong
// suggestion that someone accepts is expensive and quiet. The failure mode
// that matters is not "missed a pair", it is "confidently proposed a pair that
// was never the same video" -- so every rule here earns its keep by saying no.
//
// The "Untitled" case is the one that would have done real damage: 41 live
// rows carry that title, and grouping on it would have proposed folding forty
// unrelated videos into a single row.
const M = await import("../src/lib/mergeCandidates.ts");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};
const eq = (name, got, want) => check(name, got === want, `got ${got}, want ${want}`);

const v = (over = {}) => ({
  id: over.id ?? "id1",
  title: over.title ?? "a week in the life at tilted needle",
  clientId: over.clientId ?? "client-a",
  clientName: over.clientName ?? "Tilted Needle",
  producedAt: over.producedAt ?? "2026-03-01",
  platforms: over.platforms ?? [{ platform: "tiktok" }],
  postCount: over.postCount ?? 1,
  // One distinct account per row by default, so a fixture only exercises the
  // same-account rule when it deliberately says so.
  accountIds: over.accountIds ?? ["acct-" + (over.id ?? "id1")],
});

/* -- Normalising ----------------------------------------------------------- */
eq("case is ignored", M.normaliseTitle("Hello World Everyone"), "hello world everyone");
eq("emoji and punctuation collapse",
  M.normaliseTitle("Gen Z slang with our CFO 😂!!"), "gen z slang with our cfo");
eq("runs of separators become one space", M.normaliseTitle("a---b___c"), "a b c");
eq("leading and trailing noise is trimmed", M.normaliseTitle("  #hello!  "), "hello");
eq("null-ish input does not throw", M.normaliseTitle(undefined), "");

/* -- The happy path -------------------------------------------------------- */
{
  const got = M.findMergeCandidates([
    v({ id: "a", platforms: [{ platform: "tiktok" }] }),
    v({ id: "b", platforms: [{ platform: "tiktok" }] }),
  ]);
  eq("two rows for the same caption on ONE platform is a candidate", got.length, 1);
  eq("the single platform is reported", got[0]?.platforms.join("+"), "tiktok");
  eq("the client name travels for display", got[0]?.clientName, "Tilted Needle");
}

{
  const got = M.findMergeCandidates([
    v({ id: "a", title: "Michelin star chef rates our lunch 🍽", platforms: [{ platform: "tiktok" }] }),
    v({ id: "b", title: "michelin star chef rates our lunch", platforms: [{ platform: "tiktok" }] }),
  ]);
  eq("captions matching only after normalising still group", got.length, 1);
}

/* -- Refusals: the ones that protect real data ----------------------------- */
{
  const untitled = Array.from({ length: 5 }, (_, i) =>
    v({ id: "u" + i, title: "Untitled", platforms: [{ platform: "tiktok" }] }));
  eq("forty unrelated Untitled rows are never grouped",
    M.findMergeCandidates(untitled).length, 0);
}

eq("a short title is not evidence",
  M.findMergeCandidates([
    v({ id: "a", title: "car", platforms: [{ platform: "tiktok" }] }),
    v({ id: "b", title: "car", platforms: [{ platform: "tiktok" }] }),
  ]).length, 0);

eq("generic one-word captions are refused even when long enough",
  M.findMergeCandidates([
    v({ id: "a", title: "shorts", platforms: [{ platform: "tiktok" }] }),
    v({ id: "b", title: "shorts", platforms: [{ platform: "tiktok" }] }),
  ]).length, 0);

eq("two clients are never merged, however well the titles match",
  M.findMergeCandidates([
    v({ id: "a", clientId: "client-a", platforms: [{ platform: "tiktok" }] }),
    v({ id: "b", clientId: "client-b", platforms: [{ platform: "tiktok" }] }),
  ]).length, 0);

// THE RULE THAT INVERTED. A caption on TikTok and the same caption on
// Instagram is two posts, not one video seen twice, and this used to be the
// feature's entire happy path.
eq("the same caption on two platforms is two posts, not a duplicate",
  M.findMergeCandidates([
    v({ id: "a", platforms: [{ platform: "tiktok" }] }),
    v({ id: "b", platforms: [{ platform: "instagram" }] }),
  ]).length, 0);

// YouTube and YouTube Shorts count as separate platforms, and that is
// deliberate: a long-form upload and a Short are not the same post even when
// the caption is copied across.
eq("youtube and youtube shorts are still two platforms",
  M.findMergeCandidates([
    v({ id: "a", platforms: [{ platform: "youtube" }] }),
    v({ id: "b", platforms: [{ platform: "youtube_shorts" }] }),
  ]).length, 0);

eq("a row that already spans platforms is left alone",
  M.findMergeCandidates([
    v({ id: "a", platforms: [{ platform: "tiktok" }, { platform: "instagram" }] }),
    v({ id: "b", platforms: [{ platform: "instagram" }] }),
  ]).length, 0);

// Already merged: one platform, but two posts under it. Offering this again
// would fold a split somebody made on purpose back together.
eq("a row already carrying two posts is left alone",
  M.findMergeCandidates([
    v({ id: "a", postCount: 2, platforms: [{ platform: "tiktok" }] }),
    v({ id: "b", postCount: 1, platforms: [{ platform: "tiktok" }] }),
  ]).length, 0);

// THE ONE THAT ESCAPED. Two genuinely different TikToks, a month apart, on
// @tiltedneedle, both captioned "Email to inquire!". Requiring a group to span
// platforms used to make this impossible for free; pinned to one platform the
// caption is the only evidence left, and captions get reused.
eq("two posts on the SAME account are two videos, not one row twice",
  M.findMergeCandidates([
    v({ id: "a", title: "email to inquire please contact", accountIds: ["tiktok-tn"] }),
    v({ id: "b", title: "email to inquire please contact", accountIds: ["tiktok-tn"] }),
  ]).length, 0);

// The same platform via two DIFFERENT accounts is still a real duplicate --
// the database accepts it, so the finder must too.
eq("the same platform through two different accounts may still merge",
  M.findMergeCandidates([
    v({ id: "a", accountIds: ["tiktok-main"] }),
    v({ id: "b", accountIds: ["tiktok-backup"] }),
  ]).length, 1);

// A hand-added row has no post and so no account to clash on. This is the
// case the rule must not catch.
eq("a no-post row still pairs with the synced row it duplicates",
  M.findMergeCandidates([
    v({ id: "manual", platforms: [], postCount: 0, accountIds: [] }),
    v({ id: "synced", platforms: [{ platform: "tiktok" }], accountIds: ["tiktok-tn"] }),
  ]).length, 1);

eq("two rows with no posts at all still pair",
  M.findMergeCandidates([
    v({ id: "a", platforms: [], postCount: 0, accountIds: [] }),
    v({ id: "b", platforms: [], postCount: 0, accountIds: [] }),
  ]).length, 1);

eq("a lone video is not a group", M.findMergeCandidates([v()]).length, 0);
eq("an empty list is fine", M.findMergeCandidates([]).length, 0);

{
  // A null client on both sides is still "the same client" -- both unassigned.
  // Refusing here would hide exactly the rows most in need of tidying.
  const got = M.findMergeCandidates([
    v({ id: "a", clientId: null, clientName: null, platforms: [{ platform: "tiktok" }] }),
    v({ id: "b", clientId: null, clientName: null, platforms: [{ platform: "tiktok" }] }),
  ]);
  eq("two unassigned rows still group together", got.length, 1);
}

/* -- Survivor choice ------------------------------------------------------- */
{
  const group = M.findMergeCandidates([
    v({ id: "later", postCount: 1, producedAt: "2026-06-01", platforms: [{ platform: "tiktok" }] }),
    v({ id: "first", postCount: 1, producedAt: "2026-01-01", platforms: [{ platform: "tiktok" }] }),
  ])[0];
  // Post count can no longer differ within a group -- a row carrying two posts
  // is refused above -- so the produced date is what actually decides now.
  eq("the earliest row survives", M.suggestSurvivor(group), "first");
}

{
  const group = M.findMergeCandidates([
    v({ id: "later", postCount: 1, producedAt: "2026-05-01", platforms: [{ platform: "tiktok" }] }),
    v({ id: "earlier", postCount: 1, producedAt: "2026-01-01", platforms: [{ platform: "tiktok" }] }),
  ])[0];
  eq("ties break toward the original, not the cross-post",
    M.suggestSurvivor(group), "earlier");
}

{
  const group = M.findMergeCandidates([
    v({ id: "dated", postCount: 1, producedAt: "2026-01-01", platforms: [{ platform: "tiktok" }] }),
    v({ id: "undated", postCount: 1, producedAt: null, platforms: [{ platform: "tiktok" }] }),
  ])[0];
  eq("a missing date sorts last rather than winning", M.suggestSurvivor(group), "dated");
}

/* -- Ordering is stable ---------------------------------------------------- */
{
  const input = [
    v({ id: "a1", title: "zebra crossing story time", platforms: [{ platform: "tiktok" }] }),
    v({ id: "a2", title: "zebra crossing story time", platforms: [{ platform: "tiktok" }] }),
    v({ id: "b1", title: "apple orchard afternoon walk", platforms: [{ platform: "tiktok" }] }),
    v({ id: "b2", title: "apple orchard afternoon walk", platforms: [{ platform: "tiktok" }] }),
  ];
  const first = M.findMergeCandidates(input).map((g) => g.key).join(",");
  const again = M.findMergeCandidates([...input].reverse()).map((g) => g.key).join(",");
  check("the same input in any order produces the same order out", first === again,
    `${first} vs ${again}`);
  eq("equal-sized groups are alphabetical", first.startsWith("apple"), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
