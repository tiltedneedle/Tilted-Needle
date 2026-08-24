// Per-video attribution: comparison, never causation.
//   node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/video-attribution-test.mjs
import {
  attributeVideo, attributesOf, lengthBand, isNotable, MIN_SIDE,
} from "../src/lib/analysis/videoAttribution.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};
const near = (a, b, eps = 1e-9) => a != null && Math.abs(a - b) < eps;

const A = (key) => ({ key, label: key, family: "F" });
/** n videos carrying `keys`, each scored `index`. */
const make = (n, keys, index) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${keys.join("+")}-${i}`, index, attributes: keys.map(A),
  }));

/* ---- The core comparison -------------------------------------------------- */
{
  const withIt = make(10, ["x"], 2);
  const without = make(10, ["y"], 1);
  const r = attributeVideo(withIt[0], [...withIt, ...without]);
  const row = r.rows.find((x) => x.key === "x");
  check("compares videos WITH the attribute against those without",
    row.nWith === 10 && row.nWithout === 10);
  check("the ratio is median-with over median-without", near(row.ratio, 2));
  check("client median is over the whole cohort, not one side",
    near(r.clientMedian, 1.5));
  check("vsClient places this video against its own stablemates",
    near(r.vsClient, 2 / 1.5));
  check("cohort counts only scored videos", r.cohort === 20);
}

{
  // The subject stays in its own "with" side: removing it would compare the
  // video against a cohort defined partly by its absence.
  const cohort = [...make(8, ["x"], 3), ...make(8, ["y"], 1)];
  const r = attributeVideo(cohort[0], cohort);
  check("the subject video is counted in its own side",
    r.rows.find((x) => x.key === "x").nWith === 8);
}

/* ---- Floors --------------------------------------------------------------- */
{
  const cohort = [...make(MIN_SIDE - 1, ["rare"], 9), ...make(20, ["common"], 1)];
  const r = attributeVideo(cohort[0], cohort);
  const rare = r.rows.find((x) => x.key === "rare");
  check("a thin side is flagged underpowered", rare.underpowered === true);
  check("a 9x ratio on a thin side is never notable", isNotable(rare) === false);
  check("an underpowered row still appears, rather than vanishing",
    r.rows.some((x) => x.key === "rare"));
}

{
  const cohort = [...make(MIN_SIDE, ["x"], 2), ...make(MIN_SIDE, ["y"], 1)];
  const r = attributeVideo(cohort[0], cohort);
  check("exactly at the floor is powered",
    r.rows.find((x) => x.key === "x").underpowered === false);
}

/* ---- "Nothing comparable" is a statement, not an empty list --------------- */
{
  const cohort = [...make(3, ["x"], 2), ...make(3, ["y"], 1)];
  const r = attributeVideo(cohort[0], cohort);
  check("a scored video with no powered row says so explicitly",
    r.nothingComparable === true);

  const good = [...make(10, ["x"], 2), ...make(10, ["y"], 1)];
  check("and does not say so when a comparison exists",
    attributeVideo(good[0], good).nothingComparable === false);

  const unscored = { id: "u", index: null, attributes: [A("x")] };
  const r2 = attributeVideo(unscored, [...good, unscored]);
  check("an unscored video is not accused of being unexplained",
    r2.index === null && r2.nothingComparable === false);
}

/* ---- An attribute everything shares cannot be compared -------------------- */
{
  const cohort = make(20, ["x"], 2);
  const r = attributeVideo(cohort[0], cohort);
  check("an attribute with no 'without' side yields no row", r.rows.length === 0);
}

/* ---- Sorting -------------------------------------------------------------- */
{
  // 0.5x is exactly as interesting as 2x and must not sort below it.
  const cohort = [
    ...make(10, ["half", "big"], 0.5),
    ...make(10, ["big"], 1),
    ...make(10, ["double"], 2),
    ...make(10, [], 1),
  ];
  const subject = { id: "s", index: 0.5, attributes: [A("half"), A("double")] };
  const r = attributeVideo(subject, [...cohort, subject]);
  const half = r.rows.find((x) => x.key === "half");
  check("an attribute associated with HALF is notable, not ignored",
    isNotable(half) === true && half.ratio < 1);
  check("rows sort by distance from parity, either direction",
    Math.abs(Math.log(r.rows[0].ratio)) >= Math.abs(Math.log(r.rows[r.rows.length - 1].ratio)));
}

{
  // MIN_SIDE - 2, not - 1: the subject counts in its own side (asserted
  // above), so seven others plus this video would reach the floor exactly.
  const cohort = [
    ...make(MIN_SIDE - 2, ["thin"], 20),
    ...make(12, ["thick"], 1.5),
    ...make(12, ["other"], 1),
  ];
  const subject = { id: "s", index: 2, attributes: [A("thin"), A("thick")] };
  const r = attributeVideo(subject, [...cohort, subject]);
  check("a powered row always sorts above an underpowered one",
    r.rows[0].key === "thick" && r.rows.at(-1).key === "thin");
}

/* ---- Parity is not a finding ---------------------------------------------- */
{
  const cohort = [...make(10, ["x"], 1.05), ...make(10, ["y"], 1)];
  const r = attributeVideo(cohort[0], cohort);
  check("a 1.05x difference is inside the band and not notable",
    isNotable(r.rows.find((x) => x.key === "x")) === false);
}

/* ---- Attribute extraction -------------------------------------------------- */
{
  check("length bands are coarse enough to keep cells populated",
    lengthBand(10).key === "length:under_15s"
    && lengthBand(20).key === "length:15_30s"
    && lengthBand(45).key === "length:30_60s"
    && lengthBand(120).key === "length:1_3m"
    && lengthBand(600).key === "length:over_3m");
  check("band boundaries do not overlap",
    lengthBand(15).key === "length:15_30s" && lengthBand(30).key === "length:30_60s");

  const attrs = attributesOf({
    hookType: "question", hookTypeLabel: "Question",
    lengthSeconds: 24, topicLabels: ["Health", " Lifestyle "],
    postedAt: new Date("2026-08-22T09:00:00Z"),   // a Saturday, morning
  });
  const keys = attrs.map((a) => a.key);
  check("hook, length, topics and timing all become attributes",
    keys.includes("hook:question") && keys.includes("length:15_30s")
    && keys.includes("topic:Health") && keys.includes("topic:Lifestyle")
    && keys.includes("posted:weekend") && keys.includes("posted:am"));
  check("topic labels are trimmed", keys.includes("topic:Lifestyle"));

  check("an untagged hook contributes no hook attribute",
    !attributesOf({ lengthSeconds: 20 }).some((a) => a.family === "Hook"));
  check("a missing length contributes no length attribute",
    !attributesOf({ hookType: "story" }).some((a) => a.family === "Length"));
  check("a zero length is not a band",
    !attributesOf({ lengthSeconds: 0 }).some((a) => a.family === "Length"));
  check("no posted date means no timing attributes",
    !attributesOf({ lengthSeconds: 20 }).some((a) => a.family === "Timing"));
  check("a weekday afternoon reads as such",
    attributesOf({ postedAt: new Date("2026-08-19T15:00:00Z") })
      .map((a) => a.key).sort().join(",") === "posted:pm,posted:weekday");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
