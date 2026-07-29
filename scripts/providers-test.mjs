// Tests for the public-metrics providers.
//
// The channel-reference parse is the highest-risk pure logic here: getting it
// wrong does not throw, it just makes a sync quietly return nothing, which is
// indistinguishable from "this channel posted nothing" until someone notices
// the numbers never move.
const Y = await import("../src/lib/providers/youtube.ts");
const P = await import("../src/lib/providers/index.ts");

let pass = 0,
  fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  if (ok) pass++;
  else fail++;
};

const ref = (s) => Y.parseChannelRef(s);

/* -- channel references -------------------------------------------------- */
{
  check("@handle", ref("@ameerhnaran")?.kind === "handle" && ref("@ameerhnaran").value === "ameerhnaran");
  check("bare handle", ref("ameerhnaran")?.kind === "handle" && ref("ameerhnaran").value === "ameerhnaran");
  check("whitespace is trimmed", ref("  @foo  ")?.value === "foo");
}
{
  const id = "UCBR8-60-B28hp2BmDPdntcQ";
  check("bare UC id is an id, not a handle", ref(id)?.kind === "id" && ref(id).value === id);
  check("channel URL yields the id", ref(`https://www.youtube.com/channel/${id}`)?.value === id);
  check("channel URL without www", ref(`https://youtube.com/channel/${id}`)?.kind === "id");
}
{
  check("handle URL", ref("https://www.youtube.com/@ameerhnaran")?.value === "ameerhnaran");
  check(
    "handle URL with a trailing path is not swallowed",
    ref("https://www.youtube.com/@ameerhnaran/videos")?.value === "ameerhnaran",
  );
  check(
    "query strings do not leak into the handle",
    ref("https://www.youtube.com/@foo?si=abc")?.value === "foo",
  );
}
{
  // Legacy custom URLs have no documented lookup parameter. Rejecting is the
  // honest outcome: guessing produces a sync that silently finds nothing.
  check("legacy /c/ URL is rejected rather than guessed", ref("https://www.youtube.com/c/Something") === null);
  check("legacy /user/ URL is rejected", ref("https://www.youtube.com/user/Something") === null);
  check("empty input is rejected", ref("") === null);
  check("whitespace-only input is rejected", ref("   ") === null);
}

/* -- ISO 8601 durations -------------------------------------------------- */
{
  check("minutes and seconds", Y.parseIsoDuration("PT1M30S") === 90);
  check("seconds only", Y.parseIsoDuration("PT45S") === 45);
  check("hours, minutes, seconds", Y.parseIsoDuration("PT1H2M3S") === 3723);
  check("minutes only", Y.parseIsoDuration("PT10M") === 600);
  check("a livestream running over a day", Y.parseIsoDuration("P1DT2H") === 93600);
  check("fractional seconds round", Y.parseIsoDuration("PT1.5S") === 2);
  check("malformed input returns null rather than 0", Y.parseIsoDuration("banana") === null);
  check("an empty duration returns null", Y.parseIsoDuration("") === null);
}

/* -- registry honesty ---------------------------------------------------- */
{
  const yt = P.PROVIDERS.youtube;
  check("youtube declares it can fetch without owner auth", yt.capability.canFetchMetrics === true);
  check("youtube declares it can discover", yt.capability.canDiscover === true);
}
{
  const tt = P.PROVIDERS.tiktok;
  check("tiktok can fetch metrics without owner auth", tt.capability.canFetchMetrics === true);
  // The honest half: TikTok blocks profile pages, so uploads cannot be listed.
  check("tiktok admits it cannot discover", tt.capability.canDiscover === false);
  check("tiktok needs no API key", tt.isConfigured() === true && tt.missingEnv().length === 0);
  const d = await tt.discover("@someone");
  check("tiktok discovery refuses with a reason, not a crash",
    d.ok === false && d.error.includes("profile pages"));
}
{
  const TT = await import("../src/lib/providers/tiktok.ts");
  const id = "7106594312292453675";
  check("parses a full video URL", TT.parseVideoId(`https://www.tiktok.com/@x/video/${id}`).ok);
  check("parses a photo-post URL", TT.parseVideoId(`https://www.tiktok.com/@x/photo/${id}`).ok);
  check("parses a bare id", TT.parseVideoId(id).ok);
  // Short links are redirects; guessing at one would file metrics against the
  // wrong video, so they are refused with instructions instead.
  const short = TT.parseVideoId("https://vm.tiktok.com/ZMabc/");
  check("short links are refused with guidance, not silently dropped",
    short.ok === false && short.error.includes("full tiktok.com"));
  check("a YouTube URL is rejected", TT.parseVideoId("https://youtube.com/watch?v=a").ok === false);
  check("empty input is rejected", TT.parseVideoId("").ok === false);
  check("handle parsed from a profile URL",
    TT.parseHandle("https://www.tiktok.com/@ameerhnaran") === "ameerhnaran");
  check("handle parsed from @form", TT.parseHandle("@ameerhnaran") === "ameerhnaran");
  check("empty ids is a no-op success",
    (await TT.tiktokProvider.fetchMetrics([])).ok === true);
}
{
  for (const slug of ["instagram", "facebook"]) {
    const p = P.PROVIDERS[slug];
    check(`${slug} declares it cannot fetch publicly`, p.capability.canFetchMetrics === false);
    check(`${slug} explains why`, typeof p.capability.reason === "string" && p.capability.reason.length > 30);
    check(`${slug} offers a remedy`, typeof p.capability.remedy === "string");
  }
}
{
  // The critical guarantee: an unavailable provider must never hand back
  // numbers. Zeros would read as "this post got no views" and would drag
  // every score derived from them downward.
  const ig = P.PROVIDERS.instagram;
  const metrics = await ig.fetchMetrics(["anything"]);
  check("an unavailable provider errors rather than returning data", metrics.ok === false);
  const disc = await ig.discover("@someone");
  check("an unavailable provider discovers nothing", disc.ok === false);
}
{
  const before = process.env.YOUTUBE_API_KEY;
  delete process.env.YOUTUBE_API_KEY;
  check("youtube reports unconfigured with no key", P.PROVIDERS.youtube.isConfigured() === false);
  check(
    "youtube names the missing variable",
    P.PROVIDERS.youtube.missingEnv().includes("YOUTUBE_API_KEY"),
  );
  const res = await P.PROVIDERS.youtube.fetchMetrics(["abc"]);
  check("youtube errors instead of calling out with no key", res.ok === false);
  process.env.YOUTUBE_API_KEY = "test-key";
  check("youtube reports configured once a key is present", P.PROVIDERS.youtube.isConfigured() === true);
  check("syncablePlatforms lists youtube when keyed", P.syncablePlatforms().includes("youtube"));
  check(
    "syncablePlatforms never lists a platform that cannot be read",
    !P.syncablePlatforms().some((s) => ["instagram", "facebook"].includes(s)),
  );
  if (before === undefined) delete process.env.YOUTUBE_API_KEY;
  else process.env.YOUTUBE_API_KEY = before;
}
{
  const empty = await P.PROVIDERS.youtube.fetchMetrics([]);
  check("no ids is a success with no rows, not an API call", empty.ok === true && empty.data.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
