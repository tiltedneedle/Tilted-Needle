// Tests for the two Home reach cards -- momentum and movers.
//   npm run test:reach
//
// These used to load themselves, each paging `post_snapshots` over its own
// window (30 days and 7) and each fetching the whole `platform_posts` table
// alongside. That was 12.9s of a 8.3s render measured on a production build.
// Both now read the workspace once through `cachedContentData` and filter the
// full history down to their window in memory.
//
// The refactor is only safe if filtering ALL history to a window yields
// exactly what the windowed query returned. That is the headline test below,
// and it is not as obvious as it looks: the delta arithmetic is order- and
// neighbour-sensitive, so an extra row surviving the filter at the boundary
// would silently change a total rather than throw.
const H = await import("../src/lib/homeData.ts");

let pass = 0,
  fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

const DAY = 86400000;
const NOW = Date.now();
const at = (daysAgo, hour = 12) =>
  new Date(NOW - daysAgo * DAY + (hour - 12) * 3600000).toISOString();

const posts = [
  { id: "p-tt", content_item_id: "v1", account: { platform_slug: "tiktok" } },
  { id: "p-yt", content_item_id: "v2", account: { platform_slug: "youtube" } },
  { id: "p-arch", content_item_id: "v-archived", account: { platform_slug: "tiktok" } },
];
const items = [
  { id: "v1", title: "First video", client: { name: "Acme" } },
  { id: "v2", title: "Second video", client: null },
  { id: "v-archived", title: "Old client work", client: { name: "Gone" } },
];

// Daily readings going back 40 days -- deliberately PAST the 30-day window,
// so anything that leaks across the boundary shows up as a wrong total.
const snaps = [];
for (let d = 40; d >= 0; d--) {
  snaps.push({ platform_post_id: "p-tt", captured_at: at(d), views: 1000 + (40 - d) * 100 });
  snaps.push({ platform_post_id: "p-yt", captured_at: at(d), views: 500 + (40 - d) * 50 });
  snaps.push({ platform_post_id: "p-arch", captured_at: at(d), views: 9000 + (40 - d) * 999 });
}
snaps.sort((a, b) => a.captured_at.localeCompare(b.captured_at));

/* ---- The headline guarantee: filtering == a windowed query --------------- */
{
  // What the old code received: only rows the database returned for the
  // window. What the new code receives: all history, filtered in memory.
  const windowed30 = snaps.filter((s) => new Date(s.captured_at).getTime() >= NOW - 30 * DAY);
  const windowed7 = snaps.filter((s) => new Date(s.captured_at).getTime() >= NOW - 7 * DAY);

  const fromAll = H.loadPlatformMomentum(posts, snaps, 30);
  const fromWindow = H.loadPlatformMomentum(posts, windowed30, 30);
  check(
    "momentum: full history filtered == the windowed query",
    JSON.stringify(fromAll) === JSON.stringify(fromWindow),
    `${JSON.stringify(fromAll.map((m) => [m.slug, m.total]))} vs ${JSON.stringify(fromWindow.map((m) => [m.slug, m.total]))}`,
  );

  const moversAll = H.loadWeekMovers(posts, snaps, items, 5);
  const moversWindow = H.loadWeekMovers(posts, windowed7, items, 5);
  check(
    "movers: full history filtered == the windowed query",
    JSON.stringify(moversAll) === JSON.stringify(moversWindow),
    `${JSON.stringify(moversAll.map((m) => [m.id, m.gained]))} vs ${JSON.stringify(moversWindow.map((m) => [m.id, m.gained]))}`,
  );
}

/* ---- The window is a real boundary, not decoration ---------------------- */
{
  // 40 days of readings, 30-day window. A reading has a predecessor inside
  // the window on 29 of the 30 days -- the oldest in-window reading is a
  // baseline and contributes nothing, which is the rule the old windowed
  // query enforced by simply not returning anything earlier.
  // Excluding the archived post, which shares the tiktok platform and would
  // otherwise fold its own 29 gains into the same total.
  const solo = new Set(["v-archived"]);
  const [tiktok] = H.loadPlatformMomentum(posts, snaps, 30, solo).filter((m) => m.slug === "tiktok");
  check(
    "momentum: 30-day window counts 29 daily gains, not 40",
    tiktok.total === 29 * 100,
    `total=${tiktok.total}, expected ${29 * 100}`,
  );

  const short = H.loadPlatformMomentum(posts, snaps, 10, solo).find((m) => m.slug === "tiktok");
  check(
    "momentum: a 10-day window counts 9",
    short.total === 9 * 100,
    `total=${short.total}, expected ${9 * 100}`,
  );
}

/* ---- Archived clients are excluded from both cards ---------------------- */
{
  const excluded = new Set(["v-archived"]);
  const withArchived = H.loadPlatformMomentum(posts, snaps, 30);
  const without = H.loadPlatformMomentum(posts, snaps, 30, excluded);
  const ttWith = withArchived.find((m) => m.slug === "tiktok").total;
  const ttWithout = without.find((m) => m.slug === "tiktok").total;
  check(
    "momentum: an archived client's back catalogue drops out",
    ttWithout === 29 * 100 && ttWith === 29 * 100 + 29 * 999,
    `with=${ttWith} without=${ttWithout}`,
  );

  const movers = H.loadWeekMovers(posts, snaps, items, 5, excluded);
  check(
    "movers: an archived client's video never ranks",
    !movers.some((m) => m.id === "v-archived"),
    movers.map((m) => m.id).join(","),
  );
}

/* ---- Movers still reads as it did --------------------------------------- */
{
  const movers = H.loadWeekMovers(posts, snaps, items, 5);
  const v1 = movers.find((m) => m.id === "v1");
  check("movers: titles come from the shared read", v1?.title === "First video", v1?.title);
  check("movers: client name rides along", v1?.clientName === "Acme", String(v1?.clientName));
  check(
    "movers: 7-day window counts 6 daily gains",
    v1?.gained === 6 * 100,
    `gained=${v1?.gained}, expected ${6 * 100}`,
  );
  check(
    "movers: ranked by gain, biggest first",
    movers.map((m) => m.id).join(",") === "v-archived,v1,v2",
    movers.map((m) => `${m.id}:${m.gained}`).join(" "),
  );
  check("movers: a video with no client says so", movers.find((m) => m.id === "v2")?.clientName === null);
}

/* ---- A long gap is never plotted as one day's gain ---------------------- */
{
  // The rule that exists because a resumed account arrives as one reading
  // holding months of accumulation, and plotting that as a single day makes
  // it indistinguishable from something going viral.
  const gapped = [
    { platform_post_id: "p-tt", captured_at: at(29), views: 1000 },
    { platform_post_id: "p-tt", captured_at: at(2), views: 900000 },
  ];
  const [m] = H.loadPlatformMomentum(posts, gapped, 30);
  check(
    "momentum: a 27-day gap is caught up, not charted",
    m.total === 0 && m.caughtUp === 899000,
    `total=${m.total} caughtUp=${m.caughtUp}`,
  );
}

/* ---- Empty and degenerate inputs ---------------------------------------- */
{
  check("momentum: no snapshots is an empty list, not a throw", H.loadPlatformMomentum(posts, [], 30).length === 0);
  check("movers: no snapshots is an empty list, not a throw", H.loadWeekMovers(posts, [], items, 5).length === 0);
  check(
    "movers: a snapshot for an unknown post is ignored",
    H.loadWeekMovers([], snaps, items, 5).length === 0,
  );
  // views can be null when a platform withholds the number.
  const nulls = [
    { platform_post_id: "p-tt", captured_at: at(3), views: null },
    { platform_post_id: "p-tt", captured_at: at(2), views: 500 },
    { platform_post_id: "p-tt", captured_at: at(1), views: 700 },
  ];
  const [n] = H.loadPlatformMomentum(posts, nulls, 30);
  check("momentum: a null reading is skipped, its neighbours still pair", n.total === 200, `total=${n.total}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
