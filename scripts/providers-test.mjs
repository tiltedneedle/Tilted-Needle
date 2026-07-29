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
  // Facebook is the one platform left with no route at all. Instagram now has
  // a paid one; TikTok and YouTube are free.
  const p = P.PROVIDERS.facebook;
  check("facebook declares it cannot fetch publicly", p.capability.canFetchMetrics === false);
  check("facebook explains why", typeof p.capability.reason === "string" && p.capability.reason.length > 30);
  check("facebook offers a remedy", typeof p.capability.remedy === "string");
}
{
  // The critical guarantee: an unavailable provider must never hand back
  // numbers. Zeros would read as "this post got no views" and would drag
  // every score derived from them downward.
  const fb = P.PROVIDERS.facebook;
  const metrics = await fb.fetchMetrics(["anything"]);
  check("an unavailable provider errors rather than returning data", metrics.ok === false);
  const disc = await fb.discover("@someone");
  check("an unavailable provider discovers nothing", disc.ok === false);
}
{
  const IG = await import("../src/lib/providers/instagram.ts");
  const ig = P.PROVIDERS.instagram;
  check("instagram can fetch and discover via the paid actor",
    ig.capability.canFetchMetrics === true && ig.capability.canDiscover === true);

  const before = process.env.APIFY_TOKEN;
  delete process.env.APIFY_TOKEN;
  check("instagram reports unconfigured with no token", ig.isConfigured() === false);
  check("instagram names the missing variable", ig.missingEnv().includes("APIFY_TOKEN"));
  // Must refuse before spending: a call with no token would fail anyway, but
  // failing early keeps it out of the vendor's logs and our budget.
  const res = await ig.fetchMetrics(["abc"]);
  check("instagram errors instead of calling out with no token",
    res.ok === false && res.error.includes("APIFY_TOKEN"));
  if (before === undefined) delete process.env.APIFY_TOKEN;
  else process.env.APIFY_TOKEN = before;

  check("empty ids costs nothing and succeeds",
    (await ig.fetchMetrics([])).ok === true);

  check("handle parsed from a profile URL",
    IG.parseHandle("https://www.instagram.com/nasa/") === "nasa");
  check("handle parsed from @form", IG.parseHandle("@nasa") === "nasa");
  // /p/ is a post path, not a username -- treating it as one would create an
  // account pointing at nothing.
  check("a post URL is not mistaken for a handle",
    IG.parseHandle("https://www.instagram.com/p/C8Qq0YvOaKq/") === null);
  check("shortcode parsed from a post URL",
    IG.parseShortcode("https://www.instagram.com/p/C8Qq0YvOaKq/") === "C8Qq0YvOaKq");
  check("shortcode parsed from a reel URL",
    IG.parseShortcode("https://www.instagram.com/reel/C8Qq0YvOaKq/") === "C8Qq0YvOaKq");
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

/* -- Instagram: video-only filtering, at zero real cost -------------------
   fetch is mocked so this exercises the real discover() code path -- the
   billedCount arithmetic and the photo-drop -- without spending any actual
   Apify credit. */
{
  const IG = await import("../src/lib/providers/instagram.ts");

  check("isVideoType accepts Video", IG.isVideoType("Video") === true);
  check("isVideoType rejects Image", IG.isVideoType("Image") === false);
  check("isVideoType rejects Sidecar (mixed carousels)", IG.isVideoType("Sidecar") === false);
  check("isVideoType rejects undefined", IG.isVideoType(undefined) === false);

  const realFetch = globalThis.fetch;
  process.env.APIFY_TOKEN = "test-token";

  // Shaped exactly like the real actor response captured against @nasa,
  // with two more rows added so photos and videos are mixed together --
  // this is the case that matters, since a real profile is rarely all one
  // type.
  const mixedRows = [
    { type: "Image", shortCode: "photo1", url: "https://www.instagram.com/p/photo1/",
      caption: "a photo", timestamp: "2026-07-01T00:00:00.000Z", likesCount: 10, commentsCount: 1 },
    { type: "Video", shortCode: "vid1", url: "https://www.instagram.com/p/vid1/",
      caption: "a reel", timestamp: "2026-07-02T00:00:00.000Z", likesCount: 20, commentsCount: 2,
      videoPlayCount: 500, videoDuration: 30 },
    { type: "Sidecar", shortCode: "carousel1", url: "https://www.instagram.com/p/carousel1/",
      caption: "a carousel", timestamp: "2026-07-03T00:00:00.000Z", likesCount: 30, commentsCount: 3 },
    { type: "Video", shortCode: "vid2", url: "https://www.instagram.com/p/vid2/",
      caption: "another reel", timestamp: "2026-06-01T00:00:00.000Z", likesCount: 40, commentsCount: 4,
      videoPlayCount: 900, videoDuration: 45 },
  ];

  globalThis.fetch = async () =>
    new Response(JSON.stringify(mixedRows), { status: 201 });

  const disc = await IG.instagramProvider.discover("@nasa", { limit: 4 });
  check("discover succeeds against the mocked response", disc.ok === true);
  if (disc.ok) {
    check("photos and carousels are dropped, only videos remain",
      disc.data.length === 2 && disc.data.every((p) => p.externalId.startsWith("vid")),
      JSON.stringify(disc.data.map((p) => p.externalId)));
    check("billedCount reflects every row Apify actually returned, not the filtered count",
      disc.billedCount === 4, `got ${disc.billedCount}`);
    check("a video's duration and views survive the mapping",
      disc.data.find((p) => p.externalId === "vid1")?.lengthSeconds === 30);
  }

  // The since-cutoff must not affect what was billed, only what is kept.
  const discSince = await IG.instagramProvider.discover("@nasa", { limit: 4, since: "2026-07-01" });
  if (discSince.ok) {
    check("a since-date filter narrows results but not the billed count",
      discSince.data.length === 1 && discSince.billedCount === 4,
      `data=${discSince.data.length} billed=${discSince.billedCount}`);
  }

  // An all-photo profile must not read as an error -- it is a true, empty
  // result, and the caller (refund logic) needs billedCount === 4 even
  // though zero videos came back.
  globalThis.fetch = async () =>
    new Response(JSON.stringify(mixedRows.map((r) => ({ ...r, type: "Image" }))), { status: 201 });
  const allPhotos = await IG.instagramProvider.discover("@nasa", { limit: 4 });
  check("an all-photo account returns zero videos, not an error",
    allPhotos.ok === true && allPhotos.ok && allPhotos.data.length === 0);
  check("but still reports the full billed count, so nothing is refunded twice",
    allPhotos.ok && allPhotos.billedCount === 4);

  globalThis.fetch = realFetch;
  delete process.env.APIFY_TOKEN;
}

/* -- TikTok: optional discovery service, at zero real cost ----------------
   fetch is mocked, so this exercises the real capability-switching and
   discover() code path without ever hitting a real service. */
{
  const TT = await import("../src/lib/providers/tiktok.ts");

  const before = { url: process.env.TIKTOK_DISCOVER_URL, secret: process.env.TIKTOK_DISCOVER_SECRET };
  delete process.env.TIKTOK_DISCOVER_URL;
  delete process.env.TIKTOK_DISCOVER_SECRET;

  check("with no discovery service configured, canDiscover is honestly false",
    TT.tiktokProvider.capability.canDiscover === false);

  process.env.TIKTOK_DISCOVER_URL = "https://example.test/discover";
  // Only the URL set, not the secret -- must still report unavailable, since
  // an unauthenticated call to a real box would just 401.
  check("both URL and secret are required, not just one",
    TT.tiktokProvider.capability.canDiscover === false);

  process.env.TIKTOK_DISCOVER_SECRET = "test-secret";
  check("with both set, canDiscover flips to true",
    TT.tiktokProvider.capability.canDiscover === true);

  const realFetch = globalThis.fetch;

  // The success path: the box returns real-shaped videos.
  globalThis.fetch = async (url, opts) => {
    const u = new URL(url);
    if (u.searchParams.get("handle") !== "ameerhnaran") {
      return new Response(JSON.stringify({ error: "wrong handle" }), { status: 400 });
    }
    if (opts.headers.Authorization !== "Bearer test-secret") {
      return new Response(JSON.stringify({ error: "bad secret" }), { status: 401 });
    }
    return new Response(
      JSON.stringify({
        handle: "ameerhnaran",
        videos: [
          { externalId: "111", title: "Recent one", url: "https://tiktok.com/@x/video/111", postedAt: "2026-07-20", views: 500, likes: 40, comments: 2 },
          { externalId: "222", title: "Older one", url: "https://tiktok.com/@x/video/222", postedAt: "2026-05-01", views: 900, likes: 80, comments: 5 },
        ],
      }),
      { status: 200 },
    );
  };

  const disc = await TT.tiktokProvider.discover("@ameerhnaran", { limit: 12 });
  check("discover succeeds against the mocked discovery service", disc.ok === true);
  if (disc.ok) {
    check("both videos come back", disc.data.length === 2);
    check("the handle's leading @ is stripped before it reaches the service",
      disc.data.every((v) => !!v.externalId));
  }

  const discSince = await TT.tiktokProvider.discover("@ameerhnaran", { limit: 12, since: "2026-07-01" });
  check("a since-date filter narrows the results client-side",
    discSince.ok === true && discSince.ok && discSince.data.length === 1 && discSince.data[0].externalId === "111");

  // The service rejects the secret -- must surface as a clear error, not a crash.
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "no" }), { status: 401 });
  const discBadAuth = await TT.tiktokProvider.discover("@ameerhnaran");
  check("a rejected secret surfaces a clear error", discBadAuth.ok === false && discBadAuth.error.includes("secret"));

  // A private/nonexistent account: the service's own convention is a 200
  // with an error string and no videos. Must read as a true empty result,
  // not a failure -- otherwise a normal private account would look broken.
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "No such public account", videos: [] }), { status: 200 });
  const discPrivate = await TT.tiktokProvider.discover("@someprivateacct");
  check("a private/nonexistent account is a true empty result, not an error",
    discPrivate.ok === true && discPrivate.ok && discPrivate.data.length === 0);

  // The service is unreachable entirely.
  globalThis.fetch = async () => {
    throw new Error("fetch failed");
  };
  const discDown = await TT.tiktokProvider.discover("@ameerhnaran");
  check("an unreachable discovery service surfaces a clear error, not a crash",
    discDown.ok === false && discDown.error.includes("Could not reach"));

  globalThis.fetch = realFetch;
  if (before.url === undefined) delete process.env.TIKTOK_DISCOVER_URL;
  else process.env.TIKTOK_DISCOVER_URL = before.url;
  if (before.secret === undefined) delete process.env.TIKTOK_DISCOVER_SECRET;
  else process.env.TIKTOK_DISCOVER_SECRET = before.secret;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
