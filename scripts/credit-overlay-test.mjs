// What the credit stack shows while the server catches up.
//
// The stack briefly holds three things at once: what the server last said,
// what is on its way out, and what is on its way in. Every failure of that
// merge is visible and misleading -- a person drawn twice reads as two people,
// a removal that does not hide reads as an ignored click, and an optimistic
// entry left standing after the real row lands shows someone beside
// themselves. Cheap to test, expensive to notice in a screenshot.
const C = await import("../src/lib/creditOverlay.ts");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const c = (assignmentId, roleSlug, userId, userName) => ({ assignmentId, roleSlug, userId, userName });
const names = (list) => list.map((x) => x.userName).join(",");
const NONE = new Set();

/* -- The ordinary states --------------------------------------------------- */

eq("nothing credited shows nothing",
  names(C.visibleCredits([], "editor", [], NONE)), "");

eq("a server credit shows",
  names(C.visibleCredits([c("a1", "editor", "u1", "Ana")], "editor", [], NONE)), "Ana");

eq("another role's credit does not leak in",
  names(C.visibleCredits([c("a1", "idea", "u1", "Ana")], "editor", [], NONE)), "");

/* -- On its way in --------------------------------------------------------- */

eq("an optimistic credit shows before the server has it",
  names(C.visibleCredits([], "editor", [c("pending:editor:u1", "editor", "u1", "Ana")], NONE)),
  "Ana");

eq("it sits after the ones already there",
  names(C.visibleCredits(
    [c("a1", "editor", "u1", "Ana")], "editor",
    [c("pending:editor:u2", "editor", "u2", "Bo")], NONE)),
  "Ana,Bo");

// THE ONE-RENDER WINDOW. The real row has landed but the overlay has not been
// cleared yet. Drawing both is the most visible way this fails.
eq("a landed credit does not appear beside its own optimistic twin",
  names(C.visibleCredits(
    [c("a1", "editor", "u1", "Ana")], "editor",
    [c("pending:editor:u1", "editor", "u1", "Ana")], NONE)),
  "Ana");

eq("an optimistic credit for another role stays out",
  names(C.visibleCredits([], "editor", [c("pending:idea:u1", "idea", "u1", "Ana")], NONE)), "");

/* -- On its way out -------------------------------------------------------- */

eq("a credit being removed hides at once",
  names(C.visibleCredits([c("a1", "editor", "u1", "Ana")], "editor", [], new Set(["a1"]))), "");

eq("removing one leaves the others",
  names(C.visibleCredits(
    [c("a1", "editor", "u1", "Ana"), c("a2", "editor", "u2", "Bo")],
    "editor", [], new Set(["a1"]))),
  "Bo");

eq("removing by an id that is not here changes nothing",
  names(C.visibleCredits([c("a1", "editor", "u1", "Ana")], "editor", [], new Set(["nope"]))), "Ana");

// Remove then re-add the same person before the server answers. The removal is
// keyed by assignment id and the addition by user, so they must not cancel:
// the pending add has to win, or the circle empties after an explicit click
// that was meant to fill it.
eq("removing a credit then re-adding the same person shows them",
  names(C.visibleCredits(
    [c("a1", "editor", "u1", "Ana")], "editor",
    [c("pending:editor:u1", "editor", "u1", "Ana")], new Set(["a1"]))),
  "Ana");

/* -- The reconciliation key ------------------------------------------------ */

eq("an empty set has a stable key", C.creditsKey([]), "");

check("the key ignores order -- a reordered array is not a change",
  C.creditsKey([c("a2", "editor", "u2", "Bo"), c("a1", "editor", "u1", "Ana")]) ===
    C.creditsKey([c("a1", "editor", "u1", "Ana"), c("a2", "editor", "u2", "Bo")]),
  C.creditsKey([c("a2", "editor", "u2", "Bo"), c("a1", "editor", "u1", "Ana")]));

check("a new credit IS a change",
  C.creditsKey([c("a1", "editor", "u1", "Ana")]) !==
    C.creditsKey([c("a1", "editor", "u1", "Ana"), c("a2", "editor", "u2", "Bo")]),
  "differs");

check("a removed credit IS a change",
  C.creditsKey([c("a1", "editor", "u1", "Ana")]) !== C.creditsKey([]), "differs");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
