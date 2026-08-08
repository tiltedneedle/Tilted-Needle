// Comment-theme tests. The point of this file is the boundary between what
// the model is allowed to decide and what the system computes.
//
// The model groups text into themes -- a language task. It is never trusted
// with a count. Every number below is derived from ids that were actually
// sent, so a model that claims a theme of fifty while listing four gets four.
//
//   node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/comment-themes-test.mjs
import {
  buildEvidence, tallyThemes, summaryLine, MAX_COMMENTS,
} from "../src/lib/analysis/commentThemes.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

const c = (id, text, likeCount = 0) => ({ id, text, likeCount });

/* ---- Evidence ------------------------------------------------------------ */
{
  const comments = [c("uuid-a", "Great video", 2), c("uuid-b", "Where can I buy this?", 9)];
  const { prompt, idMap, sent } = buildEvidence(comments);

  check("most-liked comments come first", sent[0].id === "uuid-b");
  check("ids are short indices, not UUIDs", prompt.startsWith("c1: "), prompt.slice(0, 12));
  check("the map recovers the real id", idMap.get("c1") === "uuid-b");
  check("every comment is represented", idMap.size === 2);

  const long = buildEvidence([c("x", "y".repeat(1000))]);
  check("a very long comment is truncated", long.prompt.length < 500, `${long.prompt.length} chars`);

  const many = buildEvidence(Array.from({ length: 500 }, (_, i) => c(`id${i}`, `t${i}`, i)));
  check("the comment cap is enforced", many.idMap.size === MAX_COMMENTS, `${many.idMap.size}`);
  check("and the cap keeps the most-liked", many.sent[0].likeCount === 499);

  const collapsed = buildEvidence([c("x", "line one\n\nline   two")]);
  check("newlines are flattened so one comment stays one line",
    collapsed.prompt === "c1: line one line two", JSON.stringify(collapsed.prompt));
}

/* ---- The system counts, not the model ------------------------------------ */
{
  const { idMap } = buildEvidence([
    c("a", "price?"), c("b", "how much"), c("c", "love it"), c("d", "shipping?"),
  ]);

  const counted = tallyThemes({
    overallSentiment: "mixed",
    themes: [
      { label: "Pricing questions", sentiment: "neutral", commentIds: ["c1", "c2"] },
      { label: "Praise", sentiment: "positive", commentIds: ["c3"] },
    ],
  }, idMap);

  check("counts come from the ids", counted.themes[0].count === 2 && counted.themes[1].count === 1);
  check("themes are ordered biggest first", counted.themes[0].label === "Pricing questions");
  check("share is out of what was analysed", counted.themes[0].share === 0.5);
  check("comments in no theme are counted as unthemed", counted.unthemedCount === 1);
  check("real ids are returned, not the short ones",
    counted.themes[0].exampleIds.every((id) => ["a", "b", "c", "d"].includes(id)));
}

/* ---- Hallucination is contained ------------------------------------------ */
{
  const { idMap } = buildEvidence([c("a", "one"), c("b", "two")]);

  // The failure this whole design exists to survive: a model asserting a
  // count that its own evidence does not support.
  const inflated = tallyThemes({
    overallSentiment: "positive",
    themes: [{ label: "Huge theme", sentiment: "positive", commentIds: ["c1", "c99", "c100"] }],
  }, idMap);

  check("ids that were never sent are dropped", inflated.themes[0].count === 1, `${inflated.themes[0].count}`);
  check("and the discrepancy is reported, not hidden",
    inflated.problems.some((p) => p.includes("did not exist")));

  const dup = tallyThemes({
    overallSentiment: "mixed",
    themes: [
      { label: "First", sentiment: "neutral", commentIds: ["c1", "c2"] },
      { label: "Second", sentiment: "negative", commentIds: ["c2"] },
    ],
  }, idMap);
  check("a comment double-counted across themes is kept only once",
    dup.themes[0].count === 2 && dup.themes.every((t) => t.label !== "Second"));
  check("and that is reported too", dup.problems.some((p) => p.includes("more than one theme")));
  check("shares can never sum above 1",
    dup.themes.reduce((s, t) => s + t.share, 0) <= 1);

  const empty = tallyThemes({
    overallSentiment: "positive",
    themes: [{ label: "Nothing real", sentiment: "positive", commentIds: ["c50"] }],
  }, idMap);
  check("a theme with no real evidence is not a finding", empty.themes.length === 0);
}

/* ---- Degenerate input ---------------------------------------------------- */
{
  const none = tallyThemes({ overallSentiment: "mixed", themes: [] }, new Map());
  check("no comments yields no themes and no crash",
    none.themes.length === 0 && none.analysedCount === 0);
  check("share does not divide by zero", none.themes.every((t) => Number.isFinite(t.share)));
  check("the summary line still reads sensibly", summaryLine(none).includes("no clear themes"));
}

/* ---- Summary line -------------------------------------------------------- */
{
  const { idMap } = buildEvidence([c("a", "1"), c("b", "2"), c("c", "3")]);
  const a = tallyThemes({
    overallSentiment: "negative",
    themes: [
      { label: "Shipping delays", sentiment: "negative", commentIds: ["c1", "c2"] },
      { label: "Praise", sentiment: "positive", commentIds: ["c3"] },
    ],
  }, idMap);
  const line = summaryLine(a);
  check("the summary carries sentiment and counted themes",
    line.startsWith("negative") && line.includes("Shipping delays (2)"), line);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
