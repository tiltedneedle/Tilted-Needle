// Tier 1 features, and the registry that consumes them.
//   npm run test:features
//
// THE FAILURE THIS GUARDS AGAINST
//
// Every number here feeds a statistical test whose entire job is to separate
// real effects from luck. A feature that is quietly wrong does not produce an
// error -- it produces a FINDING, with a confidence interval and a
// recommendation attached, and nothing downstream can tell it from a true one.
//
// The specific trap is null-versus-false. A video with no transcript has not
// "failed to ask a question"; nothing is known about its opening. Read that
// null as false and all 87 untranscribed videos silently join the "without"
// side of eleven of the sixteen hypotheses, biasing every one of them in the
// same direction at once.
const { extractFeatures, EXTRACTOR_VERSION } = await import("../src/lib/analysis/features.ts");
const { HYPOTHESES, activeFamily, canaries, isObserved, REGISTRY_VERSION } =
  await import("../src/lib/analysis/hypotheses.ts");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

const seg = (start, dur, text) => ({ start_ms: start, dur_ms: dur, text });
const withTranscript = (segments, extra = {}) => extractFeatures({
  transcript: { segments, fullText: segments.map((s) => s.text).join(" ") },
  title: null, lengthSeconds: 30, publishedAtMs: null, zoneOffsetMs: null,
  ...extra,
});

/* ---- Unobserved is not absent ------------------------------------------- */
{
  const f = extractFeatures({
    transcript: null, title: "How to fix it", lengthSeconds: 42,
    publishedAtMs: null, zoneOffsetMs: null,
  });
  check("no transcript is recorded as such", f.transcriptPresent === false);
  check("every transcript-derived field is null, NOT false",
    f.hookHasQuestion === null && f.hookIsGreeting === null && f.ctaPresent === null
    && f.loopMarker === null && f.hookWordCount === null && f.wordsPerSecond === null,
    "false here would put 87 videos on the 'without' side of eleven hypotheses");
  check("metadata features still compute without a transcript",
    f.titleHasQuestion === true && f.titleLength === 13 && f.lengthSeconds === 42);

  // The registry must refuse to run transcript hypotheses on this row.
  const transcriptH = HYPOTHESES.filter((h) => h.requires === "transcript");
  check("no transcript hypothesis counts an untranscribed video",
    transcriptH.every((h) => !isObserved(h, f)),
    `${transcriptH.length} transcript hypotheses all correctly abstain`);
  const metaH = HYPOTHESES.filter((h) => h.requires === "metadata" && h.id.startsWith("h_title"));
  check("metadata hypotheses still run on it", metaH.every((h) => isObserved(h, f)));
}

/* ---- A silent opening IS an observation --------------------------------- */
/* The other half of the same distinction, and the easier one to get wrong: a
   video WITH a transcript whose speech starts after 15s has been observed to
   have no hook. That is false, not null. */
{
  const f = withTranscript([seg(18_000, 3000, "And that is the whole story.")]);
  check("a transcript with nothing in the first 15s reports an empty hook",
    f.hookText15s === "" && f.hookWordCount === 0);
  check("its hook flags are false, not null",
    f.hookHasQuestion === false && f.hookIsGreeting === false && f.hookNumeral === false,
    "we looked and there was nothing, which is different from not looking");
}

/* ---- The hook ----------------------------------------------------------- */
{
  const f = withTranscript([
    seg(0, 4000, "What if I told you your morning routine is wrong?"),
    seg(4000, 5000, "You are going to want to see this."),
    seg(20_000, 4000, "Anyway, here is the rest of the video."),
  ]);
  check("the hook stops at 15 seconds",
    !f.hookText15s.includes("Anyway"), f.hookText15s.slice(-30));
  check("a question in the hook is detected", f.hookHasQuestion === true);
  check("second person is counted per 100 words",
    f.hookSecondPersonRate > 0, String(f.hookSecondPersonRate));
  check("a greeting is not falsely detected", f.hookIsGreeting === false);

  const greet = withTranscript([seg(0, 4000, "Hey guys, welcome back to the channel!")]);
  check("a channel greeting is detected", greet.hookIsGreeting === true);

  const imp = withTranscript([seg(0, 3000, "Stop scrolling. This changes everything.")]);
  check("an imperative opening is detected", imp.hookImperativeOpen === true);
  const notImp = withTranscript([seg(0, 3000, "Stopping by the office today.")]);
  check("a word that merely starts like a verb is not an imperative",
    notImp.hookImperativeOpen === false, "'Stopping' must not match 'stop'");

  const num = withTranscript([seg(0, 3000, "3 things nobody tells you.")]);
  check("a numeral in the hook is detected", num.hookNumeral === true);
}

/* ---- Pace is measured over SPEECH, not runtime -------------------------- */
/* A clip can end long after the talking stops. Dividing by the runtime would
   report a slow delivery that is really a silent outro, and pace is one of the
   ranked covariates -- a systematic bias here becomes a false finding. */
{
  const f = extractFeatures({
    transcript: {
      segments: [seg(0, 2000, "one two three four"), seg(2000, 2000, "five six seven eight")],
      fullText: "one two three four five six seven eight",
    },
    title: null, lengthSeconds: 300, publishedAtMs: null, zoneOffsetMs: null,
  });
  check("pace uses the spoken span, not the video length",
    f.wordsPerSecond === 2, `${f.wordsPerSecond} w/s over 4s of speech in a 300s video`);
}

/* ---- Time to the first content word ------------------------------------- */
{
  const slow = withTranscript([seg(0, 6000, "So um okay well I just really wanted to say hello")]);
  const fast = withTranscript([seg(0, 6000, "Revenue doubled in ninety days")]);
  check("a filler-heavy open measures later than a direct one",
    slow.timeToFirstNounMs > fast.timeToFirstNounMs,
    `${slow.timeToFirstNounMs}ms vs ${fast.timeToFirstNounMs}ms`);
  check("the first content word is interpolated within its segment, not snapped to 0",
    slow.timeToFirstNounMs > 0,
    "snapping to the segment start would make every slow open look instant");
}

/* ---- Loop marker -------------------------------------------------------- */
{
  const looped = withTranscript([
    seg(0, 4000, "The secret nobody mentions about cold email"),
    seg(4000, 6000, "Here is the part in the middle that is different"),
    seg(10_000, 4000, "and that is the secret nobody mentions about cold email"),
  ]);
  check("a repeated opening phrase at the end is a loop marker", looped.loopMarker === true);

  const notLooped = withTranscript([
    seg(0, 4000, "The secret nobody mentions about cold email"),
    seg(4000, 6000, "Here is the middle section of this particular video"),
    seg(10_000, 4000, "Thanks for reading and good luck with everything"),
  ]);
  check("ordinary filler at both ends is not a loop", notLooped.loopMarker === false,
    "'and then the' must not count as an echo");
}

/* ---- CTA ---------------------------------------------------------------- */
{
  const f = withTranscript([
    seg(0, 4000, "Here is how we did it."),
    seg(4000, 4000, "Book a call with us to find out more."),
  ]);
  check("a call to action is detected", f.ctaPresent === true);
  check("its first appearance is timed", f.ctaFirstMs === 4000, String(f.ctaFirstMs));

  const none = withTranscript([seg(0, 4000, "Here is how we did it.")]);
  check("no CTA reports false with no timestamp",
    none.ctaPresent === false && none.ctaFirstMs === null);
}

/* ---- Publish time uses the offset it is given --------------------------- */
/* The previous fixed-offset bug moved videos across the very hour boundary the
   finding was about, so a "before noon" result was partly arithmetic. The
   offset is now supplied per post, at the publish instant. */
{
  const at = Date.UTC(2026, 7, 22, 23, 30);         // 23:30 UTC on a Saturday
  const utc = extractFeatures({ transcript: null, title: null, lengthSeconds: null,
    publishedAtMs: at, zoneOffsetMs: 0 });
  const dubai = extractFeatures({ transcript: null, title: null, lengthSeconds: null,
    publishedAtMs: at, zoneOffsetMs: 4 * 3600_000 });
  check("the same instant lands on different days in different zones",
    utc.postedWeekday !== dubai.postedWeekday,
    `UTC weekday ${utc.postedWeekday} vs +04 weekday ${dubai.postedWeekday}`);
  check("the local hour reflects the offset",
    utc.postedHour === 23 && dubai.postedHour === 3,
    `${utc.postedHour} vs ${dubai.postedHour}`);
  check("no offset means no answer, rather than a guess",
    extractFeatures({ transcript: null, title: null, lengthSeconds: null,
      publishedAtMs: at, zoneOffsetMs: null }).postedHour === null);
}

/* ---- Degenerate input --------------------------------------------------- */
{
  const empty = extractFeatures({ transcript: { segments: [], fullText: "" },
    title: null, lengthSeconds: null, publishedAtMs: null, zoneOffsetMs: null });
  check("an empty transcript does not throw", empty.transcriptPresent === true);
  check("an empty transcript yields nulls rather than zeros",
    empty.hookWordCount === null && empty.wordsPerSecond === null,
    "a transcript row with no text is not evidence of a silent video");

  const blank = withTranscript([seg(0, 1000, "   ")]);
  check("whitespace-only segments are dropped", blank.hookWordCount === null);
}

/* ---- Reading level refuses to guess ------------------------------------- */
/* Flesch-Kincaid divides words by sentences, so a transcript with no full
   stops reads as ONE sentence and the grade explodes with its length. Measured
   on the live corpus before this guard: 328, 189 and 178, from rows with zero
   terminators between them -- meaningless numbers that a rank hypothesis would
   nonetheless have sorted against real ones. Unpunctuated ASR is most of this
   library, so this is the common case, not an edge. */
{
  // Well past the 60-words-per-sentence threshold, not sitting on it: the
  // first version of this fixture used exactly 60 and failed its own check.
  const unpunctuated = Array.from({ length: 100 }, (_, i) => `word${i}`).join(" ");
  const f = withTranscript([seg(0, 20_000, unpunctuated)]);
  check("an unpunctuated transcript gets no reading grade",
    f.fleschKincaid === null,
    "null is honest; 328 is not");

  // One full stop in four hundred words passes a has-punctuation check and is
  // just as unusable, which is why the test is words-per-sentence.
  const barelyPunctuated = withTranscript([
    seg(0, 60_000, Array.from({ length: 300 }, (_, i) => `word${i}`).join(" ") + "."),
  ]);
  check("a single full stop in hundreds of words does not rescue the grade",
    barelyPunctuated.fleschKincaid === null);

  const punctuated = withTranscript([
    seg(0, 5000, "This is a sentence. Here is another one. And a third for good measure."),
  ]);
  check("a punctuated transcript does get one",
    punctuated.fleschKincaid !== null && punctuated.fleschKincaid < 30,
    String(punctuated.fleschKincaid));

  // A short unpunctuated line is still scorable -- the failure is about long
  // text divided by one, not about punctuation as such.
  const shortLine = withTranscript([seg(0, 3000, "hello there how are you")]);
  check("a short unpunctuated line is still scored", shortLine.fleschKincaid !== null);
}

/* ---- Caption annotations are not speech --------------------------------- */
{
  const f = withTranscript([
    seg(0, 3000, "[Music] Stop scrolling right now"),
    seg(3000, 3000, "(laughs) and here is why"),
  ]);
  check("bracketed annotations are stripped from the hook",
    !/music|laughs/i.test(f.hookText15s), f.hookText15s);
  check("stripping reveals the real opening word",
    f.hookImperativeOpen === true,
    "'[Music] Stop' must read as an imperative open, not as the word 'music'");
  check("annotations do not count toward the word rate",
    f.hookWordCount === 8, String(f.hookWordCount));
}

/* ---- The registry itself ------------------------------------------------ */
{
  check("the registry is versioned", REGISTRY_VERSION >= 1);
  check("every id is unique",
    new Set(HYPOTHESES.map((h) => h.id)).size === HYPOTHESES.length);

  /* A covariate must appear as a split OR a rank, never both -- running both
     forms of the same question double-counts it into the family and inflates
     the correction it is supposed to be paying for. */
  const binaryStems = HYPOTHESES.filter((h) => h.kind === "binary").map((h) => h.id.slice(2));
  const rankStems = HYPOTHESES.filter((h) => h.kind === "rank").map((h) => h.id.slice(2));
  const both = binaryStems.filter((s) => rankStems.includes(s));
  check("no covariate is tested as both a split and a rank", both.length === 0, both.join(","));

  check("there are canaries", canaries().length >= 2,
    canaries().map((h) => h.id).join(", "));
  check("canaries are marked and would be noticed",
    canaries().every((h) => h.isCanary && h.label), "");

  check("the family excludes descriptor hypotheses until descriptors exist",
    activeFamily({ descriptors: false }).every((h) => h.requires !== "descriptor"));

  // Every entry must survive a completely empty feature row without throwing.
  const bare = extractFeatures({ transcript: null, title: null, lengthSeconds: null,
    publishedAtMs: null, zoneOffsetMs: null });
  let threw = null;
  for (const h of HYPOTHESES) {
    try { h.value(bare); } catch (e) { threw = `${h.id}: ${e.message}`; break; }
  }
  check("no hypothesis throws on a row with nothing in it", threw === null, threw ?? "");
  check("and none of them claims to be observed", HYPOTHESES.every((h) => !isObserved(h, bare)));

  check("the extractor is versioned so a threshold change is a re-run",
    EXTRACTOR_VERSION >= 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
