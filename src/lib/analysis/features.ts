/**
 * Tier 1 features: everything computable from a transcript and a post's
 * metadata, with no model call and no tokens.
 *
 * TWO RULES GOVERN THIS FILE, AND BOTH COME FROM WHAT HAS GONE WRONG BEFORE.
 *
 * 1. UNOBSERVED IS NOT ABSENT. A video with no transcript has not "failed to
 *    ask a question" -- nothing is known about its opening at all. Every
 *    transcript-derived field is therefore null rather than false when there is
 *    no transcript, and `transcriptPresent` says which case a null is. Reading
 *    a missing transcript as a negative is the same fault that condemned 146
 *    videos in the enrichment layer, one level up.
 *
 * 2. NOTHING HERE IS TRUTH TO BE MIGRATED. This is pure arithmetic over data
 *    that already exists, so a full recompute of the corpus is milliseconds.
 *    Changing a threshold is a re-run, not a migration -- which is why
 *    `EXTRACTOR_VERSION` exists and why the table it writes to can be dropped
 *    and rebuilt without losing anything.
 */

export const EXTRACTOR_VERSION = 1;

export type Segment = { start_ms: number; dur_ms: number; text: string };

export type FeatureInput = {
  transcript: { segments: Segment[]; fullText: string } | null;
  title: string | null;
  lengthSeconds: number | null;
  /** Publish time as epoch ms, and the operating zone's offset AT that time. */
  publishedAtMs: number | null;
  zoneOffsetMs: number | null;
};

export type VideoFeatures = {
  extractorVersion: number;
  transcriptPresent: boolean;

  hookText15s: string | null;
  hookWordCount: number | null;
  hookHasQuestion: boolean | null;
  hookIsGreeting: boolean | null;
  hookSecondPersonRate: number | null;
  hookImperativeOpen: boolean | null;
  hookNumeral: boolean | null;

  wordsPerSecond: number | null;
  wordsPerSecond3s: number | null;
  timeToFirstNounMs: number | null;
  questionDensity: number | null;
  numeralDensity: number | null;
  typeTokenRatio: number | null;
  fleschKincaid: number | null;
  ctaPresent: boolean | null;
  ctaFirstMs: number | null;
  loopMarker: boolean | null;

  titleLength: number | null;
  titleHasQuestion: boolean | null;
  titleHasNumeral: boolean | null;

  lengthSeconds: number | null;
  postedHour: number | null;
  postedWeekday: number | null;
};

/* ---- Lexicons ------------------------------------------------------------
   Kept deliberately small. A long lexicon looks thorough and mostly adds ways
   to match by accident; every entry here is a phrase that opens or closes a
   short marketing video in practice. */

/** Question marks are unreliable in ASR output, so match the words too.
 *  Shared in spirit with clientEvidence.ts, which this will eventually feed. */
const QUESTION_OPEN = /(^|\s)(what|why|how|who|when|where|which|do you|did you|have you|ever)\b/i;
const GREETING_OPEN = /(welcome back|hey guys|what'?s up guys|hi everyone|welcome to (my|the) channel)/i;
const SECOND_PERSON = /\b(you|your|you're|youre|yours|yourself)\b/gi;
/** First-token imperatives. Small on purpose: an imperative opening is a
 *  distinctive move, and a broad verb list would match ordinary narration. */
const IMPERATIVE_VERBS = new Set([
  "stop", "listen", "look", "watch", "imagine", "think", "try", "check",
  "meet", "forget", "remember", "grab", "take", "see", "notice", "picture",
]);
const CTA = /\b(link in bio|swipe up|comment below|dm (me|us)|book (a|your)|sign up|subscribe|follow (me|us|for)|visit (us|our)|call (us|now)|get in touch|learn more|shop now|order now)\b/i;

/* ---- Entry point --------------------------------------------------------- */

export function extractFeatures(input: FeatureInput): VideoFeatures {
  const base: VideoFeatures = {
    extractorVersion: EXTRACTOR_VERSION,
    transcriptPresent: Boolean(input.transcript),
    hookText15s: null, hookWordCount: null, hookHasQuestion: null,
    hookIsGreeting: null, hookSecondPersonRate: null, hookImperativeOpen: null,
    hookNumeral: null, wordsPerSecond: null, wordsPerSecond3s: null,
    timeToFirstNounMs: null, questionDensity: null, numeralDensity: null,
    typeTokenRatio: null, fleschKincaid: null, ctaPresent: null,
    ctaFirstMs: null, loopMarker: null,
    titleLength: null, titleHasQuestion: null, titleHasNumeral: null,
    lengthSeconds: input.lengthSeconds ?? null,
    postedHour: null, postedWeekday: null,
  };

  /* ---- Title, which needs no transcript -------------------------------- */
  if (input.title != null) {
    const t = input.title.trim();
    base.titleLength = t.length;
    base.titleHasQuestion = t.includes("?") || QUESTION_OPEN.test(t);
    base.titleHasNumeral = /\d/.test(t);
  }

  /* ---- When it went out, in the operating zone -------------------------
     The offset is passed IN, at the publish instant, rather than assumed. A
     fixed offset is wrong across a DST boundary, and the previous
     fixed-offset bug moved videos across the very hour boundary the finding
     was about -- so a "posts before noon do better" result was partly an
     artefact of the arithmetic. */
  if (input.publishedAtMs != null && input.zoneOffsetMs != null) {
    const local = new Date(input.publishedAtMs + input.zoneOffsetMs);
    base.postedHour = local.getUTCHours();
    base.postedWeekday = local.getUTCDay();
  }

  if (!input.transcript) return base;

  /* Caption-track annotations come off first. A yt-dlp track legitimately
     carries "[Music]", "[Applause]" and "(laughs)" as bracketed markers, and
     they are not speech: left in, they inflate word counts, distort pace, and
     -- measured on this corpus -- make "music" one of the commonest opening
     words, which would then be read as the first content word of the video. */
  const clean = (t: string) =>
    (t ?? "").replace(/[\[(][^\])]{0,40}[\])]/g, " ").replace(/\s+/g, " ").trim();

  const segments = (input.transcript.segments ?? [])
    .map((s) => ({ ...s, text: clean(s.text) }))
    .filter((s) => s.text);
  const fullText = clean(input.transcript.fullText ?? "")
    || segments.map((s) => s.text).join(" ");
  if (!fullText) return base;

  /* ---- The hook -------------------------------------------------------- */
  /* 15 seconds, not 3. A 0-3s window is 7-8 words, which is below the length
     at which text carries stable meaning -- fine to show a human, useless to
     compare or embed. Kept as a display string elsewhere; the measured window
     is this one. */
  const hook = segments.filter((s) => (s.start_ms ?? 0) < 15_000)
    .map((s) => s.text.trim()).join(" ").trim();

  if (hook) {
    const hookWords = wordList(hook);
    base.hookText15s = hook;
    base.hookWordCount = hookWords.length;
    base.hookHasQuestion = hook.includes("?") || QUESTION_OPEN.test(hook);
    base.hookIsGreeting = GREETING_OPEN.test(hook);
    base.hookSecondPersonRate = hookWords.length
      ? round((hook.match(SECOND_PERSON)?.length ?? 0) * 100 / hookWords.length, 2)
      : 0;
    base.hookImperativeOpen = hookWords.length > 0
      && IMPERATIVE_VERBS.has(hookWords[0].toLowerCase().replace(/[^a-z]/g, ""));
    base.hookNumeral = /\d/.test(hook);
  } else {
    // Segments exist but none start inside 15s -- e.g. a long silent open.
    // That IS an observation about the video, so these are false, not null.
    base.hookText15s = "";
    base.hookWordCount = 0;
    base.hookHasQuestion = false;
    base.hookIsGreeting = false;
    base.hookSecondPersonRate = 0;
    base.hookImperativeOpen = false;
    base.hookNumeral = false;
  }

  /* ---- Pace ------------------------------------------------------------ */
  const allWords = wordList(fullText);
  const spokenMs = spanMs(segments);
  if (spokenMs > 0) {
    base.wordsPerSecond = round(allWords.length / (spokenMs / 1000), 3);
  }
  const first3s = segments.filter((s) => (s.start_ms ?? 0) < 3_000)
    .map((s) => s.text).join(" ");
  if (segments.length) base.wordsPerSecond3s = round(wordList(first3s).length / 3, 3);

  base.timeToFirstNounMs = firstContentWordMs(segments);

  /* ---- Whole-transcript densities -------------------------------------- */
  const per100 = (n: number) => (allWords.length ? round(n * 100 / allWords.length, 3) : 0);
  base.questionDensity = per100(countQuestions(fullText));
  base.numeralDensity = per100(allWords.filter((w) => /\d/.test(w)).length);
  base.typeTokenRatio = allWords.length
    ? round(new Set(allWords.map((w) => w.toLowerCase())).size / allWords.length, 4)
    : 0;
  base.fleschKincaid = fleschKincaidGrade(fullText, allWords);

  /* ---- Call to action -------------------------------------------------- */
  base.ctaPresent = CTA.test(fullText);
  base.ctaFirstMs = null;
  if (base.ctaPresent) {
    for (const s of segments) {
      if (CTA.test(s.text)) { base.ctaFirstMs = s.start_ms ?? 0; break; }
    }
  }

  base.loopMarker = hasLoopMarker(segments);

  return base;
}

/* ---- Helpers ------------------------------------------------------------- */

function wordList(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Spoken span, not the video's runtime: a clip can end long after the talking
 *  stops, and dividing by the runtime would report a slow delivery that is
 *  really just a silent outro. */
function spanMs(segments: Segment[]): number {
  if (!segments.length) return 0;
  const last = segments[segments.length - 1];
  const end = (last.start_ms ?? 0) + (last.dur_ms ?? 0);
  return Math.max(0, end - (segments[0].start_ms ?? 0));
}

/**
 * Sentences that end in a question mark, PLUS sentences that open with a
 * question word. ASR punctuation is unreliable enough that counting only the
 * marks would undercount badly on exactly the transcripts this project has
 * most of.
 */
function countQuestions(text: string): number {
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim());
  return sentences.filter((s) => s.includes("?") || QUESTION_OPEN.test(s.trim())).length;
}

/**
 * "Slow open", in a form that can be measured: when does the first word that
 * carries content arrive?
 *
 * Approximated by skipping a stop-word list rather than by tagging parts of
 * speech, which would need a dependency and a language model per language --
 * and half this corpus is German. The stop list is English; a German
 * transcript therefore reports its first word, which is honest for a measure
 * defined as "first non-filler token" and is why the field is compared WITHIN
 * a client rather than across the corpus.
 */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "so", "but", "or", "if", "then", "well", "okay",
  "ok", "um", "uh", "like", "just", "really", "very", "now", "today", "hey",
  "hi", "hello", "guys", "everyone", "welcome", "back", "to", "my", "our",
  "this", "that", "it", "is", "are", "was", "were", "i", "we", "you", "your",
]);

function firstContentWordMs(segments: Segment[]): number | null {
  for (const s of segments) {
    const words = wordList(s.text);
    for (let i = 0; i < words.length; i++) {
      /* Contractions are split back to their stem before the lookup. "I'm"
         would otherwise miss the stopword "i" and be scored as the first
         content word, putting time-to-first-noun at 0 for any video that opens
         "I'm going to..." -- which is a great many of them, and every one
         would look like the fastest possible open. */
      const w = words[i].toLowerCase().replace(/[^a-z0-9']/g, "").split("'")[0];
      if (!w || STOPWORDS.has(w)) continue;
      /* Interpolated across the segment rather than reported as the segment's
         start. A 6-second segment whose content word is the tenth of twelve is
         nowhere near its start, and rounding it there would make every slow
         open look fast. */
      const frac = words.length > 1 ? i / words.length : 0;
      return Math.round((s.start_ms ?? 0) + frac * (s.dur_ms ?? 0));
    }
  }
  return null;
}

/**
 * Loop bait: the closing words echo the opening, so the video reads as
 * continuous when it repeats. TikTok counts replays, so this is a real tactic
 * rather than a curiosity.
 *
 * Matched on a shared 3-word shingle between the first and last ~10 seconds,
 * ignoring stop words, so "and then the" does not count as a loop.
 */
function hasLoopMarker(segments: Segment[]): boolean {
  if (segments.length < 2) return false;
  const end = spanMs(segments) + (segments[0].start_ms ?? 0);
  if (end < 8_000) return false;                 // too short to loop meaningfully

  const openText = segments.filter((s) => (s.start_ms ?? 0) < 10_000)
    .map((s) => s.text).join(" ");
  const closeText = segments.filter((s) => (s.start_ms ?? 0) > end - 10_000)
    .map((s) => s.text).join(" ");

  const shingles = (t: string) => {
    const w = wordList(t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ""))
      .filter((x) => !STOPWORDS.has(x));
    const out = new Set<string>();
    for (let i = 0; i + 2 < w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
    return out;
  };

  const open = shingles(openText);
  if (!open.size) return false;
  for (const s of shingles(closeText)) if (open.has(s)) return true;
  return false;
}

/**
 * Flesch-Kincaid grade level. Syllables are counted by vowel groups, which is
 * the standard approximation and is wrong often enough on names and loanwords
 * that the number is only meaningful COMPARED WITH other videos from the same
 * client -- which is exactly how the engine uses it.
 */
function fleschKincaidGrade(text: string, words: string[]): number | null {
  if (!words.length) return null;

  /* UNPUNCTUATED TRANSCRIPTS GET NO SCORE, rather than a wrong one.
     Flesch-Kincaid divides words by sentences, so a transcript with no full
     stops is read as ONE sentence and the grade explodes with its length.
     Measured on this corpus before the guard: three of the worst rows had
     zero terminators between them and scored 328, 189 and 178 -- numbers with
     no meaning that would nonetheless have been ranked against real ones by
     r_-style hypotheses.

     Not a rare edge case either: a caption track written by ASR frequently
     carries no sentence punctuation at all, and those are most of the
     transcripts here. Null is the honest answer -- the reading level was not
     measurable, which the engine already knows how to handle. */
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim()).length || 1;

  /* The test is WORDS PER SENTENCE, not whether any punctuation exists at all.
     A first attempt only rejected transcripts with zero terminators and left a
     row at 164: four hundred words carrying a single full stop passes a
     has-punctuation check and is just as unusable. No human sentence runs to
     60 words, so beyond that the punctuation is not describing sentences and
     the grade is measuring transcript length. */
  if (words.length / sentences > 60) return null;
  const syllables = words.reduce((n, w) => n + syllableCount(w), 0);
  const grade = 0.39 * (words.length / sentences) + 11.8 * (syllables / words.length) - 15.59;
  return round(grade, 2);
}

function syllableCount(word: string): number {
  const w = word.toLowerCase().replace(/[^a-zäöüßé]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w
    .replace(/(?:[^laeiouyäöü])es$|ed$|[^laeiouyäöü]e$/, "")
    .match(/[aeiouyäöü]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}
