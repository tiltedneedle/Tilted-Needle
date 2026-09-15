// What the works page claims, and the floors it will not go under.
//   node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/report-works-test.mjs
import {
  platformWorks, drawableWorks, worksPageShown, worksLead, lengthBucket, dayBucket, formatIndex, sentence,
  MIN_BUCKET, MIN_SPREAD, MIN_AXES_FOR_PAGE,
} from "../src/lib/reportWorks.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

const DAY = 86_400_000;
const T0 = Date.parse("2026-03-02T09:00:00Z"); // a Monday
/**
 * A post published `i` days after T0 with `views` at day 7, so every post
 * is mature and the value at maturity is exactly `views`. Weekend posts land
 * by choosing i so that the day is a Saturday or Sunday.
 */
const post = (i, views, lengthSeconds, extra = {}) => {
  const postedAt = new Date(T0 + i * DAY);
  return {
    postId: `p${i}`,
    title: `Video ${i}`,
    lengthSeconds,
    postedAt,
    postedDay: postedAt.toISOString().slice(0, 10),
    snapshots: [{ capturedAt: new Date(postedAt.getTime() + 7 * DAY), value: views }],
    ...extra,
  };
};
const NOW = new Date(T0 + 400 * DAY);

/* ---- Buckets --------------------------------------------------------------- */
{
  check("length buckets close at 30, 60 and 90 seconds",
    [lengthBucket(30), lengthBucket(31), lengthBucket(60), lengthBucket(61), lengthBucket(90), lengthBucket(91)].join(",") === "le30,le60,le60,le90,le90,gt90");
  check("no length, zero or nonsense is no bucket", lengthBucket(null) === null && lengthBucket(0) === null && lengthBucket(NaN) === null);
  check("Saturday and Sunday are the weekend, Monday and Friday are not",
    dayBucket("2026-03-07") === "weekend" && dayBucket("2026-03-08") === "weekend" && dayBucket("2026-03-02") === "weekday" && dayBucket("2026-03-06") === "weekday");
  check("a missing or malformed day is no bucket", dayBucket(null) === null && dayBucket("2026-3-2") === null);
  check("index formats to one decimal under ten and whole above", formatIndex(1.234) === "1.2×" && formatIndex(12.6) === "13×");
  check("sentence() capitalises a finding", sentence("videos under 30 seconds reached") === "Videos under 30 seconds reached");
}

/* ---- A real spread: short videos out-reach long ones ---------------------- */
{
  // Three warm-up posts give the account a baseline of 100. Then twelve short
  // videos at 200 and twelve long ones at 100, alternating, all on weekdays.
  const posts = [post(0, 100, 45), post(1, 100, 45), post(2, 100, 45)];
  let i = 3;
  for (let k = 0; k < 12; k++) {
    // weekday-only: skip Saturday/Sunday
    while ([0, 6].includes(new Date(T0 + i * DAY).getUTCDay())) i++;
    posts.push(post(i++, 200, 20));
    while ([0, 6].includes(new Date(T0 + i * DAY).getUTCDay())) i++;
    posts.push(post(i++, 100, 120));
  }
  const w = platformWorks({ platform: "tiktok", platformLabel: "TikTok", posts, windowDays: 7, now: NOW });
  const len = w.axes.find((a) => a.key === "length");
  const short = len.buckets.find((b) => b.key === "le30"), long = len.buckets.find((b) => b.key === "gt90");
  check("every post after the baseline forms is scored", w.scored === 24, String(w.scored));
  check("buckets count the scored videos", short.n === 12 && long.n === 12, `${short.n}/${long.n}`);
  check("the short bucket's median index is above the long one's", short.index > long.index, `${short.index?.toFixed(2)} vs ${long.index?.toFixed(2)}`);
  check("the length axis is shown with two buckets over the floor", len.shown === true);
  check("the finding names the best and the worst bucket", /under 30 seconds reached .*×.*over 90 seconds/.test(len.finding), len.finding);
  const day = w.axes.find((a) => a.key === "weekend");
  check("weekday-only history cannot read the posting-day axis", day.shown === false && day.finding === null,
    day.buckets.map((b) => `${b.key}:${b.n}`).join(","));
  check("the platform is drawable", drawableWorks([w]).length === 1);
  check(`one readable axis is not a page (${MIN_AXES_FOR_PAGE} needed)`, worksPageShown([w]) === false);
  check("two platforms with one readable axis each make a page", worksPageShown([w, { ...w, platform: "instagram" }]) === true);
  check("the lead names the platform and the finding", /^On TikTok, videos under 30 seconds reached/.test(worksLead([w])), worksLead([w]));
  check("the best bucket's strongest videos are cited, by index, highest first",
    len.examples.length === 3 && len.examples.every((e) => /^Video \d+$/.test(e.title)) && len.examples[0].index >= len.examples[2].index,
    JSON.stringify(len.examples));
}

/* ---- Under the floor: nothing is compared ---------------------------------- */
{
  const posts = [post(0, 100, 45), post(1, 100, 45), post(2, 100, 45)];
  for (let k = 0; k < MIN_BUCKET - 1; k++) posts.push(post(3 + k, 300, 20));       // 7 short
  for (let k = 0; k < MIN_BUCKET + 2; k++) posts.push(post(20 + k, 100, 120));     // 10 long
  const w = platformWorks({ platform: "instagram", platformLabel: "Instagram", posts, windowDays: 7, now: NOW });
  const len = w.axes.find((a) => a.key === "length");
  const short = len.buckets.find((b) => b.key === "le30");
  check(`a bucket with ${MIN_BUCKET - 1} videos has a count and no index`, short.n === MIN_BUCKET - 1 && short.index === null);
  check("one bucket over the floor is not an axis", len.shown === false);
  check("a platform with no readable axis is not drawn", drawableWorks([w]).length === 0);
  check("no drawable platform: the lead says so", /Not enough scored videos/.test(worksLead([w])), worksLead([w]));
}

/* ---- Flat: a readable axis with nothing to say says so -------------------- */
{
  const posts = [post(0, 100, 45), post(1, 100, 45), post(2, 100, 45)];
  for (let k = 0; k < 10; k++) { posts.push(post(3 + 2 * k, 105, 20)); posts.push(post(4 + 2 * k, 100, 120)); }
  const w = platformWorks({ platform: "youtube", platformLabel: "YouTube", posts, windowDays: 7, now: NOW });
  const len = w.axes.find((a) => a.key === "length");
  check("axis is shown", len.shown === true);
  check(`a spread under ${MIN_SPREAD} is reported as no clear difference`, len.spread < MIN_SPREAD && /no clear difference/.test(len.finding), `${len.spread.toFixed(2)} ${len.finding}`);
  check("the page lead is then the honest negative, naming only the axis that was read",
    /^Video length made no clear difference to reach on YouTube\.$/.test(worksLead([w])), worksLead([w]));
  check("the flat finding is a percentage, not a ratio", /within \d+% of the others/.test(len.finding), len.finding);
  check("a flat axis cites no examples", len.examples.length === 0);
}

/* ---- Posts without a length still score, and are just not bucketed -------- */
{
  const posts = [post(0, 100, null), post(1, 100, null), post(2, 100, null)];
  for (let k = 0; k < 20; k++) posts.push(post(3 + k, k % 2 ? 150 : 90, null));
  const w = platformWorks({ platform: "tiktok", platformLabel: "TikTok", posts, windowDays: 7, now: NOW });
  const len = w.axes.find((a) => a.key === "length");
  check("scored but unbucketed: scored count stays, every length bucket is empty", w.scored === 20 && len.buckets.every((b) => b.n === 0));
}

/* ---- Weekend axis reads when both sides clear the floor ------------------- */
{
  const posts = [post(0, 100, 45), post(1, 100, 45), post(2, 100, 45)];
  let wd = 0, we = 0, i = 3;
  while (wd < 10 || we < 10) {
    const isWe = [0, 6].includes(new Date(T0 + i * DAY).getUTCDay());
    if (isWe && we < 10) { posts.push(post(i, 250, 45)); we++; }
    else if (!isWe && wd < 10) { posts.push(post(i, 100, 45)); wd++; }
    i++;
  }
  const w = platformWorks({ platform: "instagram", platformLabel: "Instagram", posts, windowDays: 7, now: NOW });
  const day = w.axes.find((a) => a.key === "weekend");
  check("both day buckets over the floor: axis shown", day.shown === true, day.buckets.map((b) => `${b.key}:${b.n}`).join(","));
  check("weekend wins in the finding", /at the weekend reached/.test(day.finding), day.finding);
  const len = w.axes.find((a) => a.key === "length");
  check("all one length: length axis not shown, the platform is still drawable", len.shown === false && drawableWorks([w]).length === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
