// Block-detection tests for the transcript fetcher.
//
// This file exists because of a specific bug. The first version matched a bare
// /captcha/i against the response body, and every YouTube watch page carries
// RECAPTCHA_V3_SITEKEY in its bootstrap config. A healthy HTTP 200 full of real
// caption tracks was classified as a block, which would have parked transcripts
// in a two-hour cooldown on every attempt, forever, while the logs blamed
// YouTube. Nothing else in the suite could have caught it: the failure was in a
// regex, against markup no unit test was feeding it.
//
//   node scripts/block-detect-test.mjs
import { looksBlocked } from "../worker/jobs/transcript.mjs";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

/* ---- The regression that started this ----------------------------------- */
{
  // Trimmed from the real page. The sitekey is present on every watch page.
  const healthy =
    '{"IS_WATCH_PAGE_COLD":true,"RECAPTCHA_V3_SITEKEY":"6LedoOcUAAAAAHA4CFG9zRpaCNjYj33SYjzQ9cTy",' +
    '"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=x","languageCode":"en","kind":"asr"}]}';

  check("a healthy page carrying RECAPTCHA_V3_SITEKEY is NOT a block",
    looksBlocked({ status: 200, finalUrl: "https://www.youtube.com/watch?v=x", body: healthy }) === false);

  check("the word 'captcha' alone never signals a block",
    looksBlocked({ status: 200, finalUrl: "https://www.youtube.com/watch?v=x",
      body: 'var config={"RECAPTCHA_V3_SITEKEY":"abc"};' }) === false);
}

/* ---- Real blocks must still be caught ----------------------------------- */
{
  check("HTTP 429 is a block",
    looksBlocked({ status: 429, finalUrl: "https://www.youtube.com/watch?v=x", body: "" }) === true);

  check("HTTP 403 is a block",
    looksBlocked({ status: 403, finalUrl: "https://www.youtube.com/watch?v=x", body: "" }) === true);

  check("a redirect to Google's interstitial is a block",
    looksBlocked({ status: 200, finalUrl: "https://www.google.com/sorry/index?continue=...", body: "" }) === true);

  check("the interstitial's own wording is a block",
    looksBlocked({ status: 200, finalUrl: "https://www.google.com/sorry/index",
      body: "Our systems have detected unusual traffic from your computer network." }) === true);
}

/* ---- The counter-signal wins -------------------------------------------- */
{
  // If real caption tracks came back, we were served -- whatever else the
  // megabyte of markup happens to contain.
  check("caption tracks present outrank any scary-looking substring",
    looksBlocked({
      status: 200,
      finalUrl: "https://www.youtube.com/watch?v=x",
      body: 'unusual traffic captcha /sorry/index "captionTracks":[{"baseUrl":"u"}]',
    }) === false);

  // ...but a genuine 429 still means refused even if a cached body lingers.
  check("a 429 outranks stale caption markup only when tracks are absent",
    looksBlocked({ status: 429, finalUrl: "", body: "no tracks here" }) === true);
}

/* ---- Ordinary non-block failures ---------------------------------------- */
{
  check("a 404 is not a block (the video is simply gone)",
    looksBlocked({ status: 404, finalUrl: "https://www.youtube.com/watch?v=x", body: "" }) === false);

  check("a 500 is not a block (transient, retry with backoff)",
    looksBlocked({ status: 500, finalUrl: "https://www.youtube.com/watch?v=x", body: "" }) === false);

  check("an empty response is not a block",
    looksBlocked({ status: 200, finalUrl: "", body: "" }) === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
