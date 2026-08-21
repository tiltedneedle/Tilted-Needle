// A hallucinated transcript must never reach the corpus.
//   npm run test:asr
//
// Whisper does not return empty text for silence. Trained on subtitled video,
// it emits whatever most often accompanies silence at the end of that
// training data -- "Thanks for watching!", "Subscribe", "♪♪♪" -- fluent,
// confident, and invented.
//
// That is the worst failure available to this system. 166 Instagram posts and
// every music-only clip would arrive carrying the same fabricated sentence,
// which would then be embedded, retrieved, and quoted back as evidence in a
// client report. A missing transcript shows up in the coverage numbers; a
// false one looks exactly like data.
const { gateAsrResult } = await import("../src/lib/analysis/asrGate.ts");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

/* ---- The documented hallucinations -------------------------------------- */
{
  const artefacts = [
    "Thanks for watching!",
    "Thank you for watching.",
    "Subscribe",
    "Please subscribe",
    "Like and subscribe",
    "See you next time",
    "Bye.",
    "you",
    "Thank you.",
    "Subtitles by the Amara.org community",
  ];
  const caught = artefacts.filter((t) => gateAsrResult(t).speech === false);
  check(
    "the known silence artefacts are all rejected",
    caught.length === artefacts.length,
    `${caught.length}/${artefacts.length}`,
  );
  const v = gateAsrResult("Thanks for watching!");
  check(
    "a rejection keeps the raw output for audit",
    v.speech === false && v.raw === "Thanks for watching!",
    v.speech === false ? v.reason : "",
  );
}

/* ---- Music markers ------------------------------------------------------ */
{
  for (const t of ["♪♪♪", "[Music]", "[music playing]", "[Applause]", "***", "   "]) {
    check(`rejects ${JSON.stringify(t)}`, gateAsrResult(t).speech === false);
  }
}

/* ---- Real speech survives ----------------------------------------------- */
/* The gate is worthless if it is merely strict. These are the cases that must
   get through, including the one that makes substring matching wrong. */
{
  const real =
    "It's super hot outside, I think 47 degrees today. All these stickers on " +
    "the glass have finally been removed and now you can see how beautiful " +
    "this showroom actually is.";
  const v = gateAsrResult(real, { durationSeconds: 12 });
  check("a genuine transcript passes", v.speech === true);

  // The reason matching is whole-string rather than substring: a real video
  // may legitimately END on the same words a hallucination consists of.
  const endsWithOutro =
    "So that is how we shot the whole campaign in a single afternoon, and if " +
    "you want the full breakdown it is linked below. Thanks for watching!";
  check(
    "a real transcript that ends 'thanks for watching' still passes",
    gateAsrResult(endsWithOutro, { durationSeconds: 15 }).speech === true,
  );

  check(
    "a short but genuine clip passes",
    gateAsrResult("Buy one, get one free this weekend only.", { durationSeconds: 4 }).speech === true,
  );
}

/* ---- Subtitle credits --------------------------------------------------- */
/* The one class matched as a SUBSTRING, because it is appended to otherwise
   real output and no marketing video says it out loud. Rejecting the whole
   result would lose a real transcript; keeping the credit would plant a
   fabricated sentence inside one. So it is stripped and the rest is judged. */
{
  const withCredit =
    "We opened the new showroom on Tuesday and the response has been " +
    "incredible, over four hundred people through the door. " +
    "Subtitles by the Amara.org community";
  const v = gateAsrResult(withCredit, { durationSeconds: 14 });
  check("a real transcript carrying a credit line still passes", v.speech === true);
  check(
    "the credit is stripped from what gets stored",
    v.speech === true && !/amara/i.test(v.text),
    v.speech === true ? JSON.stringify(v.text.slice(-40)) : "",
  );
  check(
    "the genuine speech is left intact",
    v.speech === true && v.text.includes("four hundred people through the door"),
  );

  // A clip whose ONLY content was the credit has to land as no-speech, which
  // is what makes stripping safe rather than a hole in the gate.
  const creditOnly = gateAsrResult("Subtitles by the Amara.org community");
  check("a credit and nothing else is rejected", creditOnly.speech === false,
    creditOnly.speech === false ? creditOnly.reason : "");
  check(
    "that rejection still carries the raw output",
    creditOnly.speech === false && creditOnly.raw.includes("Amara"),
  );
}

/* ---- Repetition loops --------------------------------------------------- */
/* The failure no blocklist can enumerate, because the looped phrase comes
   from the audio's own noise rather than from training data. */
{
  const loop = Array(20).fill("the sound of the music").join(" ");
  const v = gateAsrResult(loop, { durationSeconds: 60 });
  check("a repetition loop is rejected", v.speech === false, v.speech === false ? v.reason : "");

  // A real transcript naturally repeats some words; that must not trip it.
  const natural =
    "The car is fast and the car is red and it is the best car in the showroom " +
    "today because the engine is new and the price is right for anyone looking";
  check(
    "ordinary word repetition does not trip the loop check",
    gateAsrResult(natural, { durationSeconds: 12 }).speech === true,
  );
}

/* ---- Sparse output over a long clip ------------------------------------- */
{
  const v = gateAsrResult("Hello there everyone", { durationSeconds: 180 });
  check(
    "three words across three minutes is rejected as too sparse",
    v.speech === false,
    v.speech === false ? v.reason : "",
  );
  check(
    "the same four words with no duration given is not judged on rate",
    gateAsrResult("Hello there everyone").speech === true,
  );
  check(
    "a short clip is never judged on rate",
    gateAsrResult("Hello there everyone", { durationSeconds: 8 }).speech === true,
  );
}

/* ---- Degenerate input --------------------------------------------------- */
{
  check("empty is rejected", gateAsrResult("").speech === false);
  check("whitespace is rejected", gateAsrResult("\n\t  ").speech === false);
  check("null does not throw", gateAsrResult(null).speech === false);
  check("undefined does not throw", gateAsrResult(undefined).speech === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
