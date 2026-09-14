// The report's time axis: what each growth series claims, and what it refuses to.
//   node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/report-growth-test.mjs
import {
  trailingMonths, monthBounds, publishedByMonth, viewsGainedByMonth, commentsByMonth,
  seriesDelta, platformGrowth,
} from "../src/lib/reportGrowth.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

const period = { start: "2026-08-01", end: "2026-08-31" };

/* ---- Months ---------------------------------------------------------------- */
{
  const m = trailingMonths(period, 6);
  check("six trailing months end with the period's month", m.join(",") === "2026-03,2026-04,2026-05,2026-06,2026-07,2026-08", m.join(","));
  check("a January period crosses the year boundary correctly",
    trailingMonths({ start: "2026-01-01", end: "2026-01-31" }, 3).join(",") === "2025-11,2025-12,2026-01");
  check("month bounds know February", monthBounds("2028-02").end === "2028-02-29");
}

/* ---- Fixtures --------------------------------------------------------------- */
const post = (id, postedAt, snaps) => ({
  postId: id, contentItemId: "c" + id, platform: "instagram", title: id,
  postedAtTs: postedAt, likes: null, snapshots: snaps,
});
// Readings exist from late July only, like the real system.
const posts = [
  post("a", "2026-06-10T10:00:00Z", [{ capturedAt: "2026-07-30", views: 1000 }, { capturedAt: "2026-08-31", views: 1600 }]),
  post("b", "2026-08-05T10:00:00Z", [{ capturedAt: "2026-08-06", views: 0 }, { capturedAt: "2026-08-31", views: 900 }]),
  post("c", "2026-08-20T10:00:00Z", [{ capturedAt: "2026-08-21", views: 0 }, { capturedAt: "2026-08-31", views: 300 }]),
  post("d", "2026-05-01T10:00:00Z", []),
];
const months = trailingMonths(period, 6);

/* ---- Published: complete history ---------------------------------------- */
{
  const p = publishedByMonth(posts, months);
  check("published counts every month, including zeros",
    p.map((x) => x.value).join(",") === "0,0,1,1,0,2", p.map((x) => x.value).join(","));
}

/* ---- Views gained: null where nothing was measured ---------------------- */
{
  const v = viewsGainedByMonth(posts, months);
  const vals = v.map((x) => x.value);
  check("months before any reading are UNMEASURED, not zero",
    vals.slice(0, 4).every((x) => x === null), JSON.stringify(vals));
  check("August, with readings on both sides, carries a gain", typeof vals[5] === "number" && vals[5] > 0, String(vals[5]));
}

/* ---- Comments: absent route vs quiet audience --------------------------- */
{
  const ids = new Set(posts.map((p) => p.postId));
  const none = commentsByMonth([], ids, months);
  check("a platform with no stored comments is all-null, not all-zero", none.every((x) => x.value === null));
  const some = commentsByMonth(
    [{ postId: "a", publishedAt: "2026-07-03T00:00:00Z" }, { postId: "a", publishedAt: "2026-08-03T00:00:00Z" }, { postId: "zzz", publishedAt: "2026-08-03T00:00:00Z" }],
    ids, months,
  );
  check("comments are counted by their own month and only for this platform's posts",
    some.map((x) => x.value).join(",") === "0,0,0,0,1,1", some.map((x) => x.value).join(","));
}

/* ---- Delta ------------------------------------------------------------------ */
{
  check("delta is the last month against the one before",
    seriesDelta([{ month: "a", label: "", value: 100 }, { month: "b", label: "", value: 150 }]) === 50);
  check("no delta against an unmeasured month",
    seriesDelta([{ month: "a", label: "", value: null }, { month: "b", label: "", value: 150 }]) === null);
  check("no delta against a zero month (it would be infinite)",
    seriesDelta([{ month: "a", label: "", value: 0 }, { month: "b", label: "", value: 5 }]) === null);
}

/* ---- The assembled platform ---------------------------------------------- */
{
  const g = platformGrowth({ platform: "instagram", platformLabel: "Instagram", posts, comments: [], period });
  check("three series, in a fixed order", g.series.map((s) => s.key).join(",") === "published,viewsGained,comments");
  check("the views note names the first measured month", /Measured from Aug 2026/.test(g.series[1].note), g.series[1].note);
  check("the comments note says when there is no route", /No comment route/.test(g.series[2].note));
  const ig = platformGrowth({ platform: "instagram", platformLabel: "Instagram", posts, comments: [{ postId: "a", publishedAt: "2026-08-03T00:00:00Z" }], period });
  check("Instagram's comments note admits the first-page limit", /first page/.test(ig.series[2].note));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
