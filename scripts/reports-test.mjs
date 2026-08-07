// Report-builder tests: the pure half of PRD v0.5 §5, checked against
// hand-computed expectations. No database, no clock.
//
//   node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/reports-test.mjs
import {
  personStats,
  buildEmployeeReport,
  buildClientReport,
  buildPlatformReport,
  reportToCsv,
} from "../src/lib/reports.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

/* ---- Fixture ------------------------------------------------------------ */
// Three videos. v1 is on YouTube AND TikTok (the cross-platform trap),
// v2 YouTube only, v3 TikTok only and credited to nobody in view.
const video = (id, title, clientId, platforms, extra = {}) => ({
  id,
  title,
  clientId,
  clientName: clientId,
  producedAt: "2026-03-01",
  lengthSeconds: 300,
  platforms,
  trackedSeconds: 0,
  bestIndex: null,
  postCount: platforms.length,
  credits: [],
  recentGain: null,
  platformGains: [],
  ...extra,
});

const videos = [
  video("v1", "Launch film", "acme",
    [
      { platform: "youtube", views: 1000, likes: 100, comments: 10 },
      { platform: "tiktok", views: 5000, likes: 250, comments: 25 },
    ],
    { platformGains: [{ platform: "youtube", views: 40 }, { platform: "tiktok", views: 300 }] }),
  video("v2", "Founder interview", "acme",
    [{ platform: "youtube", views: 400, likes: 20, comments: 4 }],
    { platformGains: [{ platform: "youtube", views: 10 }] }),
  video("v3", "Street cut", "beta",
    [{ platform: "tiktok", views: 9000, likes: 900, comments: 90 }],
    { platformGains: [{ platform: "tiktok", views: 5 }] }),
];

const assignments = [
  { content_item_id: "v1", user_id: "u1", roleName: "Editor" },
  { content_item_id: "v1", user_id: "u1", roleName: "Videographer" },
  { content_item_id: "v2", user_id: "u1", roleName: "Editor" },
  { content_item_id: "v1", user_id: "u2", roleName: "Editor" },
  // Credit on a video that is NOT in the view -- must be ignored entirely.
  { content_item_id: "v9", user_id: "u1", roleName: "Editor" },
];
const scored = new Map([
  ["v1", [{ index: 1.5 }, { index: 2.5 }]],
  ["v2", [{ index: 1.0 }]],
]);
const people = [{ userId: "u1", name: "Usama" }, { userId: "u2", name: "Veliko" }];
const seconds = new Map([["u1", 7200], ["u2", 1800]]);

/* ---- personStats -------------------------------------------------------- */
{
  const stats = personStats(people, videos, assignments, scored, seconds);
  const u1 = stats.find((s) => s.userId === "u1");
  const u2 = stats.find((s) => s.userId === "u2");

  check("credits outside the view are ignored", u1.videosInView === 2,
    `got ${u1.videosInView}`);
  check("two roles on one video count as one video, not two",
    u1.roleCounts.find((r) => r.role === "Editor").videos === 2 &&
    u1.roleCounts.find((r) => r.role === "Videographer").videos === 1);
  check("reach stays split by platform, never pooled",
    JSON.stringify(u1.platforms) ===
      JSON.stringify([{ platform: "tiktok", views: 5000 }, { platform: "youtube", views: 1400 }]));
  check("avg boost is the mean over their in-view scored posts",
    Math.abs(u1.avgBoost - (1.5 + 2.5 + 1.0) / 3) < 1e-9, `got ${u1.avgBoost}`);
  check("tracked seconds come straight from the caller's map", u1.seconds === 7200);
  check("a person credited on one video reports one", u2.videosInView === 1);
  check("nobody inherits anybody else's boost",
    Math.abs(u2.avgBoost - 2.0) < 1e-9, `got ${u2.avgBoost}`);

  // The whole point of the merge: same person, narrowed view, smaller numbers.
  const narrowed = personStats(people, videos.filter((v) => v.id === "v2"), assignments, scored, seconds);
  check("narrowing the video set narrows the person's figures with it",
    narrowed.find((s) => s.userId === "u1").videosInView === 1 &&
    narrowed.find((s) => s.userId === "u2").videosInView === 0);

  // Order-independence: the people array order must not change any figure.
  const reversed = personStats([...people].reverse(), videos, assignments, scored, seconds);
  check("person order does not change any person's figures",
    JSON.stringify([...reversed].sort((a, b) => a.userId.localeCompare(b.userId))) ===
      JSON.stringify([...stats].sort((a, b) => a.userId.localeCompare(b.userId))));
}

/* ---- Employee report ---------------------------------------------------- */
{
  const stats = personStats(people, videos, assignments, scored, seconds);
  const r = buildEmployeeReport(stats, videos);

  check("employee report has one row per person", r.rows.length === 2);
  check("the boost prints as a plain multiplier, no tier words",
    r.rows.find((x) => x.id === "u1").cells.boost.text === "1.67×",
    r.rows.find((x) => x.id === "u1").cells.boost.text);
  check("no cell anywhere carries baseline/tier vocabulary",
    !JSON.stringify(r).match(/baseline|Insufficient/i));
  check("the totals row counts distinct videos, not summed credits",
    r.totals.cells.videos.text === "3",
    `${r.totals.cells.videos.text} (summing the column would give 3 from 2+1)`);
  check("totals hours are the real sum", r.totals.cells.hours.sort === 9000);
  check("totals reach is per platform, never one pooled number",
    r.totals.platforms.length === 2 &&
    r.totals.platforms.every((p) => typeof p.views === "number"));
  check("totals youtube reach adds only youtube",
    r.totals.platforms.find((p) => p.platform === "youtube").views === 1400);
  check("every row links into the merged surface, not the retired one",
    r.rows.every((x) => x.href.startsWith("/content?person=")));
  check("the report carries no functions across the boundary",
    JSON.parse(JSON.stringify(r)).rows.length === r.rows.length &&
    !JSON.stringify(r).includes("function"));
}

/* ---- Client report ------------------------------------------------------ */
{
  const clients = [
    {
      id: "acme", name: "Acme", videoCount: 2, postCount: 3,
      totals: [
        { platform: "youtube", views: 1400, likes: 120, comments: 14, posts: 2 },
        { platform: "tiktok", views: 5000, likes: 250, comments: 25, posts: 1 },
      ],
      trackedSeconds: 7200, recentGain: 350,
    },
    {
      id: "beta", name: "Beta", videoCount: 1, postCount: 1,
      totals: [{ platform: "tiktok", views: 9000, likes: 900, comments: 90, posts: 1 }],
      trackedSeconds: 0, recentGain: 5,
    },
  ];
  const r = buildClientReport(clients);

  check("client report has one row per client", r.rows.length === 2);
  check("engagement averages each platform's own rate, never a pooled one",
    // Acme: youtube (120+14)/1400 and tiktok (250+25)/5000, meaned.
    Math.abs(r.rows[0].cells.engagement.sort -
      ((134 / 1400) + (275 / 5000)) / 2) < 1e-9);
  check("hours per video divides by videos, not by pooled views",
    r.rows[0].cells.perVideo.sort === 3600);
  check("a client with no tracked time shows a dash, not a zero",
    r.rows[1].cells.hours.text === "—");
  check("no column anywhere pools views across platforms",
    !r.columns.some((c) => c.key === "views"));
  check("totals sum videos and hours", r.totals.cells.videos.text === "3" &&
    r.totals.cells.hours.sort === 7200);
  check("totals reach stays per platform",
    r.totals.platforms.find((p) => p.platform === "tiktok").views === 14000 &&
    r.totals.platforms.find((p) => p.platform === "youtube").views === 1400);
}

/* ---- Platform report ---------------------------------------------------- */
{
  const r = buildPlatformReport(videos, new Map([["youtube", "YouTube"], ["tiktok", "TikTok"]]));
  const yt = r.rows.find((x) => x.id === "youtube");
  const tt = r.rows.find((x) => x.id === "tiktok");

  check("platform report has one row per platform", r.rows.length === 2);
  check("a platform row counts only its own views", yt.cells.views.sort === 1400);
  check("gains are windowed per platform, not shared",
    yt.cells.gained.sort === 50 && tt.cells.gained.sort === 305);
  check("video counts are per platform, so a cross-posted video counts in both",
    yt.cells.videos.sort === 2 && tt.cells.videos.sort === 2);
  check("the top video is that platform's own best",
    yt.cells.top.text.startsWith("Launch film") && tt.cells.top.text.startsWith("Street cut"));
  check("display names are used, not slugs", yt.cells.label.text === "YouTube");
  check("there is deliberately NO totals row to pool platforms", r.totals === null);
}

/* ---- CSV ---------------------------------------------------------------- */
{
  const stats = personStats(people, videos, assignments, scored, seconds);
  const r = buildEmployeeReport(stats, videos);
  const { headers, rows } = reportToCsv(r);

  check("csv ends with the per-platform columns",
    headers.slice(-4).join(",") === "Platform,Views,Likes,Comments");
  check("csv has no pooled reach column", !headers.includes("Reach by platform"));
  // u1 reaches both platforms (v1 + v2); u2 only worked on v1, but v1 is
  // itself cross-posted, so u2 reaches both too. 2 + 2.
  check("csv emits one row per person PER PLATFORM",
    rows.length === 4, `got ${rows.length}`);
  check("each csv row repeats the person's scalars beside one platform",
    rows.filter((x) => x[0] === "Usama").length === 2 &&
    rows.filter((x) => x[0] === "Usama").every((x) => x[1] === "2"));
  check("csv figures match the screen",
    rows.some((x) => x[0] === "Usama" && x[5] === "youtube" && x[6] === 1400));

  // A person with nothing published still gets a row rather than vanishing.
  const lonely = buildEmployeeReport(
    personStats([{ userId: "u3", name: "Nobody" }], videos, assignments, scored, new Map()),
    videos,
  );
  check("an entity with no platforms still exports one row",
    reportToCsv(lonely).rows.length === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
