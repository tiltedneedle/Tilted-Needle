// Tests for the operating-timezone helpers.
//
// The offset maths here replaced six hardcoded "Asia/Dubai" literals, and the
// old code could get away with writing +4 literally because Dubai has no DST.
// The moment the zone is configurable that stops being safe, so the cases that
// matter most below are the DST ones: a zone whose offset CHANGES is exactly
// what a fixed-offset assumption gets wrong, silently, for half the year.
//
// Karachi is the zone this was written for (UTC+5, no DST). London and New
// York are here because they are the plausible zones for a client-facing
// agency and they do shift.
const T = await import("../src/lib/tz.ts");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};
const eq = (name, got, want) => check(name, got === want, `got ${got}, want ${want}`);

const HOUR = 3600_000;

/* -- The bug this was written for ------------------------------------------ */
{
  // 19:30 UTC on the 12th is 00:30 on the 13th in Karachi, but still 23:30 on
  // the 12th in Dubai. That one hour is where a post lands on the wrong day.
  const instant = new Date("2026-08-12T19:30:00Z");
  eq("Karachi files a 00:30 post under the new day",
    T.operatingDate(instant, "Asia/Karachi"), "2026-08-13");
  eq("Dubai files the same instant under the previous day",
    T.operatingDate(instant, "Asia/Dubai"), "2026-08-12");
}

/* -- Offsets --------------------------------------------------------------- */
eq("Karachi is UTC+5",
  T.zoneOffsetMs(new Date("2026-08-13T12:00:00Z"), "Asia/Karachi"), 5 * HOUR);
eq("Dubai is UTC+4",
  T.zoneOffsetMs(new Date("2026-08-13T12:00:00Z"), "Asia/Dubai"), 4 * HOUR);
eq("UTC is zero",
  T.zoneOffsetMs(new Date("2026-08-13T12:00:00Z"), "UTC"), 0);

// The cases a hardcoded offset gets wrong.
eq("London in summer is UTC+1",
  T.zoneOffsetMs(new Date("2026-08-13T12:00:00Z"), "Europe/London"), 1 * HOUR);
eq("London in winter is UTC+0",
  T.zoneOffsetMs(new Date("2026-01-13T12:00:00Z"), "Europe/London"), 0);
eq("New York in summer is UTC-4",
  T.zoneOffsetMs(new Date("2026-08-13T12:00:00Z"), "America/New_York"), -4 * HOUR);
eq("New York in winter is UTC-5",
  T.zoneOffsetMs(new Date("2026-01-13T12:00:00Z"), "America/New_York"), -5 * HOUR);

// A zone that is not a whole number of hours off, because those exist and
// break anyone who stores offsets as integers.
eq("Kathmandu is UTC+5:45",
  T.zoneOffsetMs(new Date("2026-08-13T12:00:00Z"), "Asia/Kathmandu"), 5.75 * HOUR);

/* -- Day boundaries -------------------------------------------------------- */
{
  const start = T.startOfOperatingDay("2026-08-13", "Asia/Karachi");
  eq("midnight in Karachi is 19:00 UTC the day before",
    start.toISOString(), "2026-08-12T19:00:00.000Z");
  eq("and it reads back as the same local date",
    T.operatingDate(start, "Asia/Karachi"), "2026-08-13");
}
{
  const start = T.startOfOperatingDay("2026-08-13", "Asia/Dubai");
  eq("midnight in Dubai is 20:00 UTC the day before",
    start.toISOString(), "2026-08-12T20:00:00.000Z");
}
{
  // Round trip across every zone and both sides of a DST change: the instant
  // returned must always be the same local date it was asked for. This is the
  // assertion that catches an off-by-one-hour, whatever caused it.
  let bad = null;
  for (const tz of ["Asia/Karachi", "Asia/Dubai", "UTC", "Europe/London", "America/New_York", "Asia/Kathmandu"]) {
    for (const d of ["2026-01-01", "2026-03-29", "2026-06-15", "2026-08-13", "2026-10-25", "2026-12-31"]) {
      const back = T.operatingDate(T.startOfOperatingDay(d, tz), tz);
      if (back !== d) { bad = `${tz} ${d} -> ${back}`; break; }
    }
    if (bad) break;
  }
  check("start-of-day round-trips for every zone and date sampled", bad === null, bad ?? "");
}

/* -- Configuration --------------------------------------------------------- */
check("a resolved zone is exported", typeof T.OPERATING_TZ === "string" && T.OPERATING_TZ.length > 0,
  T.OPERATING_TZ);
check("the default is unchanged, so history is not reinterpreted",
  T.OPERATING_TZ === (process.env.OPERATING_TZ || process.env.NEXT_PUBLIC_OPERATING_TZ || "Asia/Dubai"),
  T.OPERATING_TZ);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
