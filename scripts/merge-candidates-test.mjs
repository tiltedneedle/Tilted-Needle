// Tests for cross-platform merge suggestions.
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
    v({ id: "b", platforms: [{ platform: "instagram" }] }),
  ]);
  eq("the same caption on two platforms is a candidate", got.length, 1);
  eq("both platforms are reported", got[0]?.platforms.join("+"), "instagram+tiktok");
  eq("the client name travels for display", got[0]?.clientName, "Tilted Needle");
}

{
  const got = M.findMergeCandidates([
    v({ id: "a", title: "Michelin star chef rates our lunch 🍽", platforms: [{ platform: "tiktok" }] }),
    v({ id: "b", title: "michelin star chef rates our lunch", platforms: [{ platform: "instagram" }] }),
  ]);
  eq("captions matching only after normalising still group", got.length, 1);
}

/* -- Refusals: the ones that protect real data ----------------------------- */
{
  const untitled = Array.from({ length: 5 }, (_, i) =>
    v({ id: "u" + i, title: "Untitled", platforms: [{ platform: i % 2 ? "tiktok" : "instagram" }] }));
  eq("forty unrelated Untitled rows are never grouped",
    M.findMergeCandidates(untitled).length, 0);
}

eq("a short title is not evidence",
  M.findMergeCandidates([
    v({ id: "a", title: "car", platforms: [{ platform: "tiktok" }] }),
    v({ id: "b", title: "car", platforms: [{ platform: "instagram" }] }),
  ]).length, 0);

eq("generic one-word captions are refused even when long enough",
  M.findMergeCandidates([
    v({ id: "a", title: "shorts", platforms: [{ platform: "tiktok" }] }),
    v({ id: "b", title: "shorts", platforms: [{ platform: "instagram" }] }),
  ]).length, 0);

eq("two clients are never merged, however well the titles match",
  M.findMergeCandidates([
    v({ id: "a", clientId: "client-a", platforms: [{ platform: "tiktok" }] }),
    v({ id: "b", clientId: "client-b", platforms: [{ platform: "instagram" }] }),
  ]).length, 0);

eq("two rows on the SAME platform are a repost, not one video twice",
  M.findMergeCandidates([
    v({ id: "a", platforms: [{ platform: "instagram" }] }),
    v({ id: "b", platforms: [{ platform: "instagram" }] }),
  ]).length, 0);

eq("a row that already spans platforms is left alone",
  M.findMergeCandidates([
    v({ id: "a", platforms: [{ platform: "tiktok" }, { platform: "instagram" }] }),
    v({ id: "b", platforms: [{ platform: "instagram" }] }),
  ]).length, 0);

eq("a lone video is not a group", M.findMergeCandidates([v()]).length, 0);
eq("an empty list is fine", M.findMergeCandidates([]).length, 0);

{
  // A null client on both sides is still "the same client" -- both unassigned.
  // Refusing here would hide exactly the rows most in need of tidying.
  const got = M.findMergeCandidates([
    v({ id: "a", clientId: null, clientName: null, platforms: [{ platform: "tiktok" }] }),
    v({ id: "b", clientId: null, clientName: null, platforms: [{ platform: "instagram" }] }),
  ]);
  eq("two unassigned rows still group together", got.length, 1);
}

/* -- Survivor choice ------------------------------------------------------- */
{
  const group = M.findMergeCandidates([
    v({ id: "few", postCount: 1, platforms: [{ platform: "tiktok" }] }),
    v({ id: "many", postCount: 3, platforms: [{ platform: "instagram" }] }),
  ])[0];
  eq("the row carrying the most history survives", M.suggestSurvivor(group), "many");
}

{
  const group = M.findMergeCandidates([
    v({ id: "later", postCount: 1, producedAt: "2026-05-01", platforms: [{ platform: "tiktok" }] }),
    v({ id: "earlier", postCount: 1, producedAt: "2026-01-01", platforms: [{ platform: "instagram" }] }),
  ])[0];
  eq("ties break toward the original, not the cross-post",
    M.suggestSurvivor(group), "earlier");
}

{
  const group = M.findMergeCandidates([
    v({ id: "dated", postCount: 1, producedAt: "2026-01-01", platforms: [{ platform: "tiktok" }] }),
    v({ id: "undated", postCount: 1, producedAt: null, platforms: [{ platform: "instagram" }] }),
  ])[0];
  eq("a missing date sorts last rather than winning", M.suggestSurvivor(group), "dated");
}

/* -- Ordering is stable ---------------------------------------------------- */
{
  const input = [
    v({ id: "a1", title: "zebra crossing story time", platforms: [{ platform: "tiktok" }] }),
    v({ id: "a2", title: "zebra crossing story time", platforms: [{ platform: "instagram" }] }),
    v({ id: "b1", title: "apple orchard afternoon walk", platforms: [{ platform: "tiktok" }] }),
    v({ id: "b2", title: "apple orchard afternoon walk", platforms: [{ platform: "instagram" }] }),
  ];
  const first = M.findMergeCandidates(input).map((g) => g.key).join(",");
  const again = M.findMergeCandidates([...input].reverse()).map((g) => g.key).join(",");
  check("the same input in any order produces the same order out", first === again,
    `${first} vs ${again}`);
  eq("equal-sized groups are alphabetical", first.startsWith("apple"), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
