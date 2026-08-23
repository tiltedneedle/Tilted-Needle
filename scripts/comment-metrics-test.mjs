// Counting what an audience DOES, without inventing any of it.
//   npm run test:commentmetrics
//
// THE TWO FAILURES THIS GUARDS AGAINST
//
// A rate whose denominator moved. Short reactions -- "first", "W", a bare
// emoji -- are a fifth of any comment corpus, and counting a marker over ALL
// comments while dividing by the filtered set is how a rate quietly exceeds
// 100%. Both counts are reported and both are asserted here.
//
// A measurement instrument that varies by language. Half this corpus is
// German: a clinic's audience asks "wie viel kostet das", not "how much is
// it". An English-only marker list would report German clients as having
// fewer questions and less purchase intent than English ones -- and the
// inference engine compares clients to each other, so that is not a gap, it is
// a confound wearing a metric's clothes.
import {
  computeCommentMetrics, isSubstantive, meaningfulTokens, COMMENT_METRICS_VERSION,
} from "../src/lib/analysis/commentMetrics.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

const c = (text, id = String(Math.random())) => ({ id, text });

/* ---- The short-comment filter ------------------------------------------- */
{
  for (const t of ["first", "W", "🔥🔥🔥", "❤️", "so good", "  ", "👏"]) {
    check(`"${t}" is filtered as too short to be evidence`, !isSubstantive(t));
  }
  for (const t of ["where can I buy this", "wie viel kostet das", "this changed my mind"]) {
    check(`"${t.slice(0, 24)}" survives the filter`, isSubstantive(t));
  }

  check("emoji do not count as tokens",
    meaningfulTokens("🔥 amazing 🔥").length === 1,
    JSON.stringify(meaningfulTokens("🔥 amazing 🔥")));
}

/* ---- Both counts are reported ------------------------------------------- */
{
  const m = computeCommentMetrics([
    c("first"), c("W"), c("🔥"),
    c("where can I buy this please"),
    c("this is genuinely useful thank you"),
  ]);
  check("the analysed count excludes the reactions", m.analysedCount === 2, String(m.analysedCount));
  check("the filtered count is reported, not hidden", m.filteredCount === 3, String(m.filteredCount));
  check("the two account for every comment", m.analysedCount + m.filteredCount === 5);
}

/* ---- No counter can exceed its denominator ------------------------------ */
{
  // Every marker present, but only on filtered-out comments.
  const m = computeCommentMetrics([c("@bob"), c("how?"), c("link?"), c("what")]);
  check("markers on filtered comments are not counted",
    m.mentionCount === 0 && m.questionCount === 0 && m.intentCount === 0,
    `mentions ${m.mentionCount}, questions ${m.questionCount}, intent ${m.intentCount}`);

  const big = computeCommentMetrics([
    c("@someone you have to see this"),
    c("how much does this cost exactly"),
  ]);
  check("no counter exceeds the analysed count",
    [big.mentionCount, big.questionCount, big.confusionCount, big.intentCount]
      .every((n) => n <= big.analysedCount),
    `analysed ${big.analysedCount}`);
}

/* ---- English AND German, symmetrically ---------------------------------- */
{
  const english = computeCommentMetrics([
    c("how much does this cost"),
    c("where can I buy one"),
    c("wait what happened there"),
    c("@sarah look at this one"),
  ]);
  /* Genuine translations, line for line. The first version of this fixture
     paired "wait what happened there" with "das versteh ich nicht ganz" and
     failed -- correctly. Those are not the same sentence: the English one is
     phrased as a question and the German one is a statement, so an honest
     instrument SHOULD score them differently. A symmetry test only means
     something when the inputs are actually symmetric. */
  const german = computeCommentMetrics([
    c("wie viel kostet das denn"),
    c("wo kann ich das kaufen"),
    c("warte was ist da passiert"),
    c("@sarah schau dir das an"),
  ]);

  check("English questions are counted", english.questionCount >= 2, String(english.questionCount));
  check("German questions are counted TOO", german.questionCount >= 2, String(german.questionCount));
  check("English purchase intent is counted", english.intentCount >= 2, String(english.intentCount));
  check("German purchase intent is counted TOO", german.intentCount >= 2, String(german.intentCount));
  check("English confusion is counted", english.confusionCount >= 1, String(english.confusionCount));
  check("German confusion is counted TOO", german.confusionCount >= 1, String(german.confusionCount));
  check("mentions are language-independent",
    english.mentionCount === 1 && german.mentionCount === 1);

  /* The point of the whole bilingual exercise: two audiences saying the same
     things must not produce different numbers, because those numbers are
     compared BETWEEN clients. */
  check(
    "the same four intents score the same in either language",
    english.questionCount === german.questionCount
      && english.intentCount === german.intentCount
      && english.confusionCount === german.confusionCount,
    `en q${english.questionCount}/i${english.intentCount}/c${english.confusionCount} vs `
      + `de q${german.questionCount}/i${german.intentCount}/c${german.confusionCount}`,
  );
}

/* ---- Questions without a question mark ---------------------------------- */
{
  // Platforms strip punctuation and German questions often arrive without it.
  const m = computeCommentMetrics([
    c("how do you film these"),
    c("wo bekomme ich sowas her"),
    c("this is a plain statement about nothing"),
  ]);
  check("a question with no question mark is still a question",
    m.questionCount === 2, String(m.questionCount));
}

/* ---- Median length ------------------------------------------------------- */
{
  const m = computeCommentMetrics([
    c("aaaa bbbb cccc"), c("aaaa bbbb cccc dddd eeee"), c("aa bb cc"),
  ]);
  check("median length is over the ANALYSED set", m.medianLength === 14, String(m.medianLength));
  check("no comments means no median, not zero",
    computeCommentMetrics([]).medianLength === null);
}

/* ---- The field that must stay null -------------------------------------- */
{
  const m = computeCommentMetrics([c("a real comment here")]);
  check("reply ratio is null because thread structure is not stored",
    m.replyRatio === null,
    "0 would read as 'nobody replies' rather than 'we do not know'");
  check("the extractor is versioned so a marker change is a re-run",
    m.extractorVersion === COMMENT_METRICS_VERSION && COMMENT_METRICS_VERSION >= 1);
}

/* ---- Degenerate input ---------------------------------------------------- */
{
  check("no comments does not throw", computeCommentMetrics([]).analysedCount === 0);
  check("null text does not throw", computeCommentMetrics([{ id: "x", text: null }]).filteredCount === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
