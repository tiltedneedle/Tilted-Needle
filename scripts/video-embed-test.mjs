// Tests for the video embed URL logic. Verified live against real accounts
// for YouTube and Instagram (a real video ID and a real Instagram shortcode
// both returned HTTP 200 from their embed endpoints); TikTok has no real
// posts to verify against yet (no video has been registered), so its
// URL-fallback parsing is pinned here with synthetic input instead.
const E = await import("../src/lib/videoEmbed.ts");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

/* -- YouTube --------------------------------------------------------------- */
{
  const e = E.embedFor("youtube", null, "5tHGpWV9_9A");
  check("external_id is preferred over parsing the url",
    e?.src === "https://www.youtube-nocookie.com/embed/5tHGpWV9_9A");
  check("youtube embeds are horizontal", e?.vertical === false);

  check("falls back to a watch url when external_id is missing",
    E.embedFor("youtube", "https://www.youtube.com/watch?v=5tHGpWV9_9A", null)?.src
      === "https://www.youtube-nocookie.com/embed/5tHGpWV9_9A");
  check("falls back to a youtu.be short url",
    E.embedFor("youtube", "https://youtu.be/5tHGpWV9_9A", null)?.src
      === "https://www.youtube-nocookie.com/embed/5tHGpWV9_9A");
  check("falls back to a shorts url",
    E.embedFor("youtube", "https://www.youtube.com/shorts/5tHGpWV9_9A", null)?.src
      === "https://www.youtube-nocookie.com/embed/5tHGpWV9_9A");
  check("null when there is no id and no parseable url",
    E.embedFor("youtube", null, null) === null);
  check("null rather than a malformed embed when the url has no video id",
    E.embedFor("youtube", "https://www.youtube.com/@somechannel", null) === null);
}

/* -- TikTok ------------------------------------------------------------------
   No real registered video to verify this against yet -- pinned with
   synthetic input instead of asserted from nothing. */
{
  const e = E.embedFor("tiktok", null, "7106594312292453675");
  check("external_id is preferred over parsing the url",
    e?.src === "https://www.tiktok.com/embed/v2/7106594312292453675");
  check("tiktok embeds are vertical", e?.vertical === true);

  check("falls back to parsing a full video url",
    E.embedFor("tiktok", "https://www.tiktok.com/@user/video/7106594312292453675", null)?.src
      === "https://www.tiktok.com/embed/v2/7106594312292453675");
  check("null when the url has no /video/ path (e.g. a bare profile url)",
    E.embedFor("tiktok", "https://www.tiktok.com/@user", null) === null);
  check("null with neither an id nor a url", E.embedFor("tiktok", null, null) === null);
}

/* -- Instagram --------------------------------------------------------------
   Verified live: this exact transform on a real post ("...DZyWu6docyS/")
   returned HTTP 200 from Instagram's own embed endpoint. */
{
  const e = E.embedFor("instagram", "https://www.instagram.com/p/DZyWu6docyS/", "DZyWu6docyS");
  check("appends /embed/ to the stored url",
    e?.src === "https://www.instagram.com/p/DZyWu6docyS/embed/");
  check("instagram embeds are vertical", e?.vertical === true);

  check("a trailing query string is stripped before appending /embed/",
    E.embedFor("instagram", "https://www.instagram.com/p/ABC123/?igsh=xyz", null)?.src
      === "https://www.instagram.com/p/ABC123/embed/");
  check("works on a reel url the same way as a post url",
    E.embedFor("instagram", "https://www.instagram.com/reel/ABC123/", null)?.src
      === "https://www.instagram.com/reel/ABC123/embed/");
  check("null with no url at all -- external_id alone cannot build an instagram embed",
    E.embedFor("instagram", null, "ABC123") === null);
}

/* -- Unknown platform -------------------------------------------------------- */
{
  check("an unrecognised or unavailable platform (e.g. facebook) embeds nothing",
    E.embedFor("facebook", "https://facebook.com/x/videos/1", "1") === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
