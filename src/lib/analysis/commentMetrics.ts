/**
 * Tier 3: what an audience is DOING in the comments, counted rather than
 * interpreted.
 *
 * No model, no tokens, no network -- these are counters over text already
 * stored, which is why they can be recomputed for the whole corpus in
 * milliseconds and why a threshold change is a re-run rather than a migration.
 * The model-written themes live elsewhere (commentThemes.ts) and answer a
 * different question: themes say what people talked ABOUT, these say what they
 * were doing -- asking, objecting, tagging a friend, saying they were lost.
 *
 * TWO DECISIONS DO MOST OF THE WORK HERE.
 *
 * 1. THE SHORT-COMMENT FILTER. "first", "W", a bare fire emoji -- plausibly a
 *    fifth of any comment corpus. Left in, they drag every rate toward zero
 *    and, worse, they cluster: a density-based grouping run over them finds
 *    one enormous meaningless blob. They are filtered before anything is
 *    counted, and BOTH counts are reported, because a rate whose denominator
 *    is hidden is not a measurement.
 *
 * 2. THE MARKERS ARE BILINGUAL. Roughly half this corpus is German -- a
 *    clinic's audience asks "wie viel kostet das", not "how much is it". An
 *    English-only list would not merely miss those; it would report German
 *    clients as having systematically fewer questions and less purchase
 *    intent than English ones, and the inference engine compares clients to
 *    each other. A measurement instrument that varies by language is a
 *    confound wearing a metric's clothes.
 */

export const COMMENT_METRICS_VERSION = 1;

export type CommentInput = {
  id: string;
  text: string;
  likeCount?: number | null;
};

export type CommentMetrics = {
  extractorVersion: number;
  /** Comments long enough to carry meaning. */
  analysedCount: number;
  /** Comments dropped as too short to be evidence. */
  filteredCount: number;
  mentionCount: number;
  questionCount: number;
  confusionCount: number;
  intentCount: number;
  /** Characters, over the analysed set. */
  medianLength: number | null;
  /**
   * Null, always, and deliberately.
   *
   * post_comments has no parent or reply column -- neither the YouTube nor the
   * Apify path stores thread structure -- so a reply ratio cannot be computed
   * from what is held. Reporting 0 would be a lie in the shape of a number,
   * and this is the field most likely to be read as "nobody replies" rather
   * than "we do not know". It becomes real when thread ids are stored, not
   * before.
   */
  replyRatio: null;
};

/**
 * Below this a comment is a reaction, not a statement.
 *
 * Three tokens after stripping emoji and punctuation. "W", "first", "🔥🔥🔥"
 * and "so good" all fall out; "where can I buy this" does not.
 */
const MIN_TOKENS = 3;

/** Emoji, symbols and the punctuation that survives platform mangling. */
const EMOJI_AND_PUNCT =
  /[\p{Extended_Pictographic}\p{Emoji_Presentation}‍️\p{P}\p{S}]/gu;

export function meaningfulTokens(text: string): string[] {
  return (text ?? "")
    .replace(EMOJI_AND_PUNCT, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function isSubstantive(text: string): boolean {
  return meaningfulTokens(text).length >= MIN_TOKENS;
}

/* ---- The markers --------------------------------------------------------
   Kept deliberately short. A long list looks thorough and mostly adds ways to
   match by accident; every entry here is a phrase that actually appears in
   this corpus, in the language its audience wrote it in. */

/** A viewer tagging someone. Instagram ranks resharing as its top prediction
 *  and sends are invisible publicly, so a tag is the visible cousin of a DM. */
const MENTION = /@[\w.]{2,}/u;

/**
 * Question words, which only mean "question" IN OPENING POSITION.
 *
 * A first version matched them anywhere and reported 30% of all substantive
 * comments as questions. Sampling the matches showed why: "i WAS selling a
 * 2016 honda civic" (German `was`), "knowing HOW to drive", "WHICH is God",
 * "WHY I don't like it" -- every one a statement containing an interrogative
 * word. 147 of 256 matches in a 857-comment sample had no question mark, and
 * most of those were false.
 *
 * Position is the actual signal. "How much is it" opens with the word;
 * "knowing how to drive" buries it. So the word must appear within the first
 * few tokens of the comment or of a sentence inside it -- which is also why
 * this cannot be one flat regex.
 */
/* TWO CLASSES, because they behave differently and conflating them costs
   accuracy in both directions.

   A WH-word carries the question in itself and tolerates a short run-up:
   "Quick question, how much is it" is plainly a question. An AUXILIARY is
   interrogative only through subject-verb inversion, which happens at the
   very start -- "Is it working" asks, "this is a plain statement" does not,
   and the only difference is position 0 versus position 2. Allowing
   auxiliaries the same run-up as WH-words made "this is a plain statement
   about nothing" a question, which the test caught. */
const WH_WORD = new RegExp(
  "^(?:how|whats?|what's|why|when|where|which|whos?|who's"
  + "|wie|was|warum|wieso|weshalb|wann|wo|woher|wohin|welche[rs]?|wer)$",
  "iu",
);

/**
 * "What a fab life", "What an idiot" -- exclamatory, not interrogative, and
 * frequent enough in this corpus to be worth its own exception.
 */
const EXCLAMATORY = /^(?:what|wie|was)$/iu;

function looksLikeQuestion(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;

  // An explicit mark settles it, wherever it falls.
  if (t.includes("?")) return true;

  /* WITHOUT A MARK, ONLY A LEADING WH-WORD COUNTS -- and this is deliberately
     the narrow rule, arrived at by measuring two wider ones against the real
     corpus.
       any-position matching   -> 30% of comments "questions", and sampling
                                  showed "i WAS selling a honda", "knowing HOW
                                  to drive", "WHICH is God" -- all statements.
       + auxiliary inversion   -> 23%, still wrong: "CAN'T wait to own one",
                                  "WILL look to read", "HAS the highest spec".
                                  Inversion is real grammar, but comments open
                                  with those words for other reasons far more
                                  often than they invert.
     Telling a question from a statement without punctuation needs grammar this
     does not have, so the counter UNDERCOUNTS rather than inventing. An
     unmarked question missed is a smaller error than a statement reported as
     audience demand, because the whole point of this number is to say what an
     audience is asking for. */
  for (const sentence of t.split(/[.!\n]+/)) {
    const tokens = meaningfulTokens(sentence);
    if (!tokens.length) continue;
    if (!WH_WORD.test(tokens[0])) continue;
    // "What a ..." / "Was für ein ..." are exclamations.
    if (EXCLAMATORY.test(tokens[0]) && /^(?:a|an|ein|eine)$/iu.test(tokens[1] ?? "")) continue;
    return true;
  }
  return false;
}

/** A failed hook leaves a trace: people say they got lost. Genuinely
 *  ambiguous -- confusion also drives rewatches, which platforms reward -- so
 *  it is measured rather than assumed to be bad. */
const CONFUSION = new RegExp(
  [
    "\\b(wait what|i don'?t (get|understand)|what happened|confus(ed|ing)|lost me|rewatch|watched .{0,12}(twice|again)|makes no sense)\\b",
    "\\b(versteh(e)? ich nicht|was ist (da )?passiert|verwirr(t|end)|nochmal (ge)?schaut|ergibt keinen sinn)\\b",
  ].join("|"),
  "iu",
);

/** The one an agency can put in front of a client: someone trying to buy. */
const INTENT = new RegExp(
  [
    "\\b(where can i (buy|get)|how much|link\\??|price|pricing|cost|dm(ed)? you|book|appointment|sign me up|interested|available)\\b",
    "\\b(wie ?viel kostet|was kostet|wo (kann|kaufe) ich|preis|kosten|termin|buchen|interessiert|verf(ü|ue)gbar)\\b",
  ].join("|"),
  "iu",
);

export function computeCommentMetrics(comments: CommentInput[]): CommentMetrics {
  const all = comments ?? [];
  const substantive = all.filter((c) => isSubstantive(c.text));

  const lengths = substantive.map((c) => (c.text ?? "").trim().length).sort((a, b) => a - b);
  const medianLength = lengths.length
    ? (lengths.length % 2
        ? lengths[(lengths.length - 1) / 2]
        : Math.round((lengths[lengths.length / 2 - 1] + lengths[lengths.length / 2]) / 2))
    : null;

  /* Counted over the SUBSTANTIVE set only. Counting mentions over everything
     while reporting a rate against the filtered denominator is the classic
     way to manufacture a number above 100%. */
  const count = (re: RegExp) => substantive.filter((c) => re.test(c.text ?? "")).length;

  return {
    extractorVersion: COMMENT_METRICS_VERSION,
    analysedCount: substantive.length,
    filteredCount: all.length - substantive.length,
    mentionCount: count(MENTION),
    questionCount: substantive.filter((c) => looksLikeQuestion(c.text ?? "")).length,
    confusionCount: count(CONFUSION),
    intentCount: count(INTENT),
    medianLength,
    replyRatio: null,
  };
}
