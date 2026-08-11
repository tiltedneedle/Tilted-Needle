// Tests for video-length parsing.
//
// These exist because parseDuration -- a TIMESHEET parser, where "1:30" is an
// hour and a half -- was being used for video lengths, where the same string
// means ninety seconds. The bug was invisible: a 38-second clip stored as 38
// minutes still renders as a plausible "38:00", and nothing downstream
// objects. The ROUND TRIP assertions at the bottom are the ones that matter,
// because the edit form seeds this field from stored seconds and parses it
// back on save -- if those two disagree, opening a video and pressing save
// changes its length without anyone touching the field.
const F = await import("../src/lib/format.ts");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};
const eq = (name, got, want) => check(name, got === want, `got ${got}, want ${want}`);

/* -- Parsing --------------------------------------------------------------- */
eq("0:38 is thirty-eight seconds, not thirty-eight minutes", F.parseVideoLength("0:38"), 38);
eq("1:30 is ninety seconds", F.parseVideoLength("1:30"), 90);
eq("12:05", F.parseVideoLength("12:05"), 725);
eq("1:02:05 reads as h:mm:ss", F.parseVideoLength("1:02:05"), 3725);
eq("38s", F.parseVideoLength("38s"), 38);
eq("1m30s", F.parseVideoLength("1m30s"), 90);
eq("1m 30s with a space", F.parseVideoLength("1m 30s"), 90);
eq("2m", F.parseVideoLength("2m"), 120);
eq("1h2m3s", F.parseVideoLength("1h2m3s"), 3723);
eq("a bare number is seconds for a video", F.parseVideoLength("38"), 38);
eq("whitespace and case are ignored", F.parseVideoLength("  1M30S "), 90);

check("empty is null", F.parseVideoLength("") === null);
check("blank is null", F.parseVideoLength("   ") === null);
check("nonsense is null", F.parseVideoLength("about a minute") === null);
check("1:75 is refused rather than reinterpreted", F.parseVideoLength("1:75") === null);
check("1:02:75 is refused", F.parseVideoLength("1:02:75") === null);

/* -- The regression itself -------------------------------------------------
   Pinned as an explicit contrast so nobody 'simplifies' one into the other. */
eq("timesheet parser still reads 1:30 as an hour and a half", F.parseDuration("1:30"), 5400);
check("...and the video parser does not",
  F.parseVideoLength("1:30") === 90 && F.parseDuration("1:30") !== F.parseVideoLength("1:30"));
check("the formats the old error message advertised were rejected by it",
  F.parseDuration("38s") === null && F.parseDuration("1m30s") === null);
check("...and are accepted now",
  F.parseVideoLength("38s") === 38 && F.parseVideoLength("1m30s") === 90);

/* -- Formatting ------------------------------------------------------------ */
eq("38 seconds", F.formatVideoLength(38), "0:38");
eq("seconds are zero padded", F.formatVideoLength(65), "1:05");
eq("minutes are not padded below an hour", F.formatVideoLength(725), "12:05");
eq("an hour brings padded minutes", F.formatVideoLength(3725), "1:02:05");
eq("exactly one hour", F.formatVideoLength(3600), "1:00:00");
eq("zero", F.formatVideoLength(0), "0:00");

/* -- Round trip ------------------------------------------------------------
   The property the edit form depends on: seed from seconds, parse back, get
   the same number. This is what silently multiplied lengths by sixty. */
{
  let worst = null;
  for (const s of [0, 1, 38, 59, 60, 61, 90, 119, 599, 725, 3599, 3600, 3725, 7199, 86399]) {
    const back = F.parseVideoLength(F.formatVideoLength(s));
    if (back !== s) { worst = `${s} -> "${F.formatVideoLength(s)}" -> ${back}`; break; }
  }
  check("format then parse returns the original for every sampled length",
    worst === null, worst ?? "");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
