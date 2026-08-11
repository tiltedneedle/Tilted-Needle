// Tests for pasted-link parsing.
//
// The interesting assertions here are the REFUSALS. A parser that is merely
// permissive would happily invent an external_id from a channel link or a
// profile link, and the result is not a visible error -- it is a duplicate
// content item shadowing a video the sync already tracks, splitting its
// metrics across two rows that each look complete.
const U = await import("../src/lib/contentUrl.ts");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};
const ok = (s) => U.parseContentUrl(s);
const bad = (s) => { const r = U.parseContentUrl(s); return r.ok === false; };

/* -- YouTube --------------------------------------------------------------- */
{
  const want = "5tHGpWV9_9A";
  for (const [label, url] of [
    ["watch", `https://www.youtube.com/watch?v=${want}`],
    ["youtu.be", `https://youtu.be/${want}`],
    ["shorts", `https://www.youtube.com/shorts/${want}`],
    ["embed", `https://www.youtube.com/embed/${want}`],
    ["live", `https://www.youtube.com/live/${want}`],
    ["no scheme", `www.youtube.com/watch?v=${want}`],
    ["extra params", `https://www.youtube.com/watch?v=${want}&t=42s&si=xyz`],
    ["param after path", `https://www.youtube.com/shorts/${want}?feature=share`],
  ]) {
    const r = ok(url);
    check(`youtube ${label}`, r.ok && r.data.externalId === want,
      r.ok ? r.data.externalId : r.error);
  }

  const r = ok(`https://www.youtube.com/watch?v=${want}&t=42s`);
  check("youtube canonicalises away tracking params",
    r.ok && r.data.canonicalUrl === `https://www.youtube.com/watch?v=${want}`);
  check("youtube carries no handle", r.ok && r.data.handle === null);

  // An 11-char id sits next to text that also matches [\w-]; the boundary
  // guard is what stops a 12-char token being truncated into a wrong id.
  check("rejects an over-long id rather than truncating it",
    bad("https://www.youtube.com/watch?v=5tHGpWV9_9ABC"));

  check("a channel link is refused, not parsed",
    bad("https://www.youtube.com/@somechannel"));
  check("a /channel/ link is refused",
    bad("https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv"));
}

/* -- TikTok ---------------------------------------------------------------- */
{
  const id = "7106594312292453675";
  const r = ok(`https://www.tiktok.com/@someuser/video/${id}`);
  check("tiktok full url", r.ok && r.data.externalId === id);
  check("tiktok carries the handle from the path",
    r.ok && r.data.handle === "someuser");

  const p = ok(`https://www.tiktok.com/@someuser/photo/${id}`);
  check("tiktok photo url parses too", p.ok && p.data.externalId === id);

  const b = ok(`https://www.tiktok.com/embed/v2/${id}`);
  check("tiktok embed url, no handle available",
    b.ok && b.data.externalId === id && b.data.handle === null);

  check("short vm./vt. links are refused with the fix, not resolved",
    bad("https://vm.tiktok.com/ZMabcdefg/"));

  // Free, offline, exact: the id IS the timestamp.
  const ts = U.tiktokPostedAtTs(id);
  check("publish instant decodes from the id", typeof ts === "string" && ts.startsWith("2022-"), String(ts));
  check("a non-id decodes to null", U.tiktokPostedAtTs("nope") === null);
  check("an out-of-range value decodes to null", U.tiktokPostedAtTs("100000000000000000000") === null);
}

/* -- Instagram ------------------------------------------------------------- */
{
  const code = "C1a2b3c4D5e";
  for (const [label, url] of [
    ["reel", `https://www.instagram.com/reel/${code}/`],
    ["reels", `https://www.instagram.com/reels/${code}/`],
    ["p", `https://www.instagram.com/p/${code}/`],
    ["with params", `https://www.instagram.com/reel/${code}/?igsh=abc`],
  ]) {
    const r = ok(url);
    check(`instagram ${label}`, r.ok && r.data.externalId === code,
      r.ok ? r.data.externalId : r.error);
  }
  check("a profile link is refused, not parsed",
    bad("https://www.instagram.com/someuser/"));
}

/* -- Refusals -------------------------------------------------------------- */
{
  check("empty input", bad(""));
  check("whitespace only", bad("   "));
  check("a bare id is not accepted, being ambiguous", bad("5tHGpWV9_9A"));
  check("a plain sentence", bad("the youtube one from tuesday"));
  check("an unsupported platform", bad("https://vimeo.com/123456789"));
  check("facebook is not supported", bad("https://www.facebook.com/watch/?v=123"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
