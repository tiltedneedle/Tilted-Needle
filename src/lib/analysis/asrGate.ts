/**
 * Decide whether an ASR result is speech or an artefact of silence.
 *
 * WHY A GATE IS NOT OPTIONAL
 *
 * Whisper-family models do not return empty text for a silent clip. Trained
 * on subtitled video, they emit the phrases that most often accompany silence
 * at the END of that training data: "Thanks for watching!", "Subscribe to my
 * channel", "♪♪♪". The output is fluent, confident, correctly punctuated, and
 * entirely invented.
 *
 * For this project that failure is worse than useless. A marketing corpus is
 * searched for what a client actually said, and 166 Instagram posts plus every
 * music-only clip would arrive carrying the same fabricated sentence. It would
 * then be embedded, retrieved, and quoted back as evidence in a client report.
 * "No speech" is a true and useful answer; a hallucinated caption is a lie
 * that survives every downstream check because it looks exactly like data.
 *
 * The gate is deliberately conservative in one direction: it would rather
 * reject a genuine three-word clip than admit a fabricated one, because a
 * missing transcript is visible in the coverage numbers and a false one is
 * not.
 */

/**
 * Phrases Whisper produces from silence, matched on the WHOLE output rather
 * than as substrings.
 *
 * Substring matching would be wrong in both directions here: a real video may
 * legitimately end "thanks for watching", and rejecting it would lose a real
 * transcript. What identifies a hallucination is that the phrase is
 * essentially the ENTIRE result -- a minute of audio yielding four words of
 * outro boilerplate.
 */
const SILENCE_ARTEFACTS = [
  "thanks for watching",
  "thank you for watching",
  "thanks for watching!",
  "subscribe",
  "please subscribe",
  "subscribe to my channel",
  "like and subscribe",
  "see you next time",
  "see you in the next video",
  "bye",
  "you",
  "thank you",
];

/**
 * Subtitle-credit lines, matched as SUBSTRINGS -- the one place where that is
 * the right rule.
 *
 * These come from the same training data as the outro phrases but behave
 * differently. "Subtitles by the Amara.org community" and "Transcription by
 * CastingWords" are appended to otherwise-real output, so a whole-string match
 * never fires; and unlike "thanks for watching", no marketing video says them
 * out loud, so there is no legitimate transcript to lose.
 *
 * They are stripped rather than used to reject, because the speech before the
 * credit is usually genuine. What is left is then re-judged by everything
 * below, so a clip whose ONLY content was the credit still lands as no_speech.
 */
/* Each runs to the end of its LINE rather than to the next full stop, because
   a credit is always trailing and often contains a dot of its own -- stopping
   at the first one leaves "org community" behind, which then reads as speech. */
const CREDIT_MARKS = [
  /subtitles?\s+by\b.*/gi,
  /subtitled\s+by\b.*/gi,
  /transcriptions?\s+by\b.*/gi,
  /\bamara\.org\b.*/gi,
  /www\.mooji\.org\b.*/gi,
];

/** Music and sound-effect markers, which are annotations rather than speech. */
const NON_SPEECH_MARKS = /^[\s♪♫🎵🎶*\[\]()<>_-]*$|^\[(music|applause|silence|laughter|sound|noise)[^\]]*\]$/i;

/**
 * The same annotations without their brackets. Caught in production by the
 * live-table assertion, not by the unit tests: Whisper emitted "🎵 Outro
 * Music 🎵" for a music-only clip, which is an annotation dressed in emoji
 * rather than square brackets, and it walked through a gate that only knew
 * the bracketed form. Matched on the WHOLE remaining text after music symbols
 * are stripped, so a real sentence that merely mentions music is untouched.
 */
const BARE_ANNOTATION = /^(intro\s+|outro\s+|background\s+)?(music|song|applause|laughter|silence|sound(\s+effects?)?)(\s+plays?|\s+playing)?$/i;

export type AsrVerdict =
  | { speech: true; text: string }
  | { speech: false; reason: string; raw: string };

/**
 * Remove subtitle-credit lines from a piece of ASR output.
 *
 * Exported because the SEGMENTS need the same treatment as the full text. A
 * credit stripped from `full_text` but left in `segments` would still be
 * indexed and still be quotable, and the two would disagree about what the
 * video says -- so both go through this one function rather than through two
 * implementations that drift.
 */
export function stripCredits(s: string): string {
  let out = s ?? "";
  for (const re of CREDIT_MARKS) out = out.replace(re, " ");
  return out.replace(/\s+/g, " ").trim();
}

/** Strip punctuation and case so "Thanks for watching!" matches its twin. */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.!?,;:"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function gateAsrResult(
  rawText: string,
  { durationSeconds }: { durationSeconds?: number } = {},
): AsrVerdict {
  const raw = (rawText ?? "").trim();

  if (!raw) return { speech: false, reason: "empty result", raw };

  if (NON_SPEECH_MARKS.test(raw)) {
    return { speech: false, reason: "music or sound-effect annotation only", raw };
  }
  // The unbracketed form: strip the music symbols and see whether an
  // annotation is all that remains.
  const deSymbolled = raw.replace(/[♪♫🎵🎶*\[\]()<>_-]/gu, " ").replace(/\s+/g, " ").trim();
  if (BARE_ANNOTATION.test(deSymbolled)) {
    return { speech: false, reason: "music or sound-effect annotation only", raw };
  }

  /* Credits come off first, and the stripped text is what gets STORED as well
     as judged. Keeping them would defeat the point: the credit is fabricated,
     and a fabricated line inside an otherwise-real transcript is exactly the
     thing that later gets embedded, retrieved and quoted as evidence. The raw
     output stays available on the verdict either way. */
  const body = stripCredits(raw);

  if (!body) {
    return { speech: false, reason: "the result is a subtitle credit and nothing else", raw };
  }

  const norm = normalise(body);

  if (SILENCE_ARTEFACTS.includes(norm)) {
    return {
      speech: false,
      reason: `the entire result is "${raw}", a phrase Whisper emits from silence`,
      raw,
    };
  }

  /* Repetition. A stuck decoder loops one phrase for the whole clip -- the
     other classic silence failure, and one no blocklist can enumerate because
     the looped phrase comes from the audio's own noise. Caught structurally
     instead: if a handful of distinct words fill a long result, it is a loop
     rather than speech. */
  const words = norm.split(" ").filter(Boolean);
  if (words.length >= 12) {
    const unique = new Set(words).size;
    if (unique / words.length < 0.25) {
      return {
        speech: false,
        reason: `only ${unique} distinct words across ${words.length} -- a repetition loop`,
        raw,
      };
    }
  }

  /* Too little speech for the runtime. Whisper given a minute of silence
     returns a sentence, not a minute of words; real speech runs about 2-3
     words per second, so under ~0.15 is far below any genuine delivery. The
     duration is optional because not every caller has it, and the check is
     skipped rather than guessed at. */
  if (durationSeconds && durationSeconds >= 20) {
    const perSecond = words.length / durationSeconds;
    if (perSecond < 0.15) {
      return {
        speech: false,
        reason: `${words.length} words across ${Math.round(durationSeconds)}s is too sparse to be speech`,
        raw,
      };
    }
  }

  return { speech: true, text: body };
}
