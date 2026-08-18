// Which day a post was published on — the one answer every surface must use.
//
// THE BUG THIS GUARDS. A post carries two date fields that disagree.
// posted_at_ts is the platform's real instant; posted_at is a UTC DATE SLICE
// of it, written by the providers as timestamp.slice(0, 10). Slicing in UTC
// answers "what day was it in Greenwich", which nobody asked — and on live
// data 103 of 443 posts fall on a different operating-timezone day than their
// own slice, five across a MONTH boundary.
//
// So a screen filtering on posted_at and a report selecting on posted_at_ts
// place the same video in different months, and both look right. No error, no
// empty state, two confident numbers. These tests are what stop that returning.
const P = await import("../src/lib/publishDate.ts");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const DUBAI = "Asia/Dubai";     // UTC+4, no DST
const KARACHI = "Asia/Karachi"; // UTC+5, no DST
const LONDON = "Europe/London"; // UTC+0 / +1, DST — the one that catches offsets

/* -- The instant wins, and it is resolved in the operating zone ------------- */

eq("a plain instant resolves to its operating-zone day",
  P.publishedDay({ postedAtTs: "2026-07-15T12:00:00.000Z" }, DUBAI), "2026-07-15");

// THE CASE THAT MOVES A VIDEO BETWEEN MONTHS. 22:30 UTC on 31 July is already
// 02:30 on 1 August in Dubai. The UTC slice says July; the truth says August.
{
  const post = { postedAtTs: "2026-07-31T22:30:00.000Z", postedAt: "2026-07-31" };
  eq("late-evening UTC on the last of the month rolls into the next",
    P.publishedDay(post, DUBAI), "2026-08-01");
  check("and that is exactly what the UTC slice would have got wrong",
    P.publishedDay(post, DUBAI) !== post.postedAt, "slice=2026-07-31");
}

// And the other direction: early UTC on the 1st is still the 1st in Dubai.
eq("early-morning UTC does not roll backwards in a +4 zone",
  P.publishedDay({ postedAtTs: "2026-08-01T01:00:00.000Z" }, DUBAI), "2026-08-01");

eq("a further-east zone rolls over earlier",
  P.publishedDay({ postedAtTs: "2026-07-31T19:30:00.000Z" }, KARACHI), "2026-08-01");
eq("the same instant is still July in Dubai",
  P.publishedDay({ postedAtTs: "2026-07-31T19:30:00.000Z" }, DUBAI), "2026-07-31");

// A zone WITH daylight saving, which a hardcoded offset would get wrong for
// half the year.
eq("summer time is accounted for, not assumed away",
  P.publishedDay({ postedAtTs: "2026-06-30T23:30:00.000Z" }, LONDON), "2026-07-01");
eq("and winter time is not shifted by it",
  P.publishedDay({ postedAtTs: "2026-12-31T23:30:00.000Z" }, LONDON), "2026-12-31");

eq("the instant is preferred over the slice even when both exist",
  P.publishedDay({ postedAtTs: "2026-07-31T22:30:00.000Z", postedAt: "2026-07-31" }, DUBAI),
  "2026-08-01");

/* -- The fallback, and its stated limit ------------------------------------- */

{
  // The fourteen live Instagram posts: a date, no instant.
  const r = P.publishedOn({ postedAt: "2026-08-12", postedAtTs: null }, DUBAI);
  eq("a post with only a date still gets a day", r.day, "2026-08-12");
  eq("and is marked as the weaker kind", r.precision, "date");
}

eq("a post with an instant is marked exact",
  P.publishedOn({ postedAtTs: "2026-07-15T12:00:00.000Z" }, DUBAI).precision, "instant");

{
  const r = P.publishedOn({}, DUBAI);
  eq("a post with nothing has no day", r.day, null);
  eq("and says so rather than guessing", r.precision, "none");
}

// A malformed timestamp must not become "Invalid Date" rendered as a day.
{
  const r = P.publishedOn({ postedAtTs: "not-a-date", postedAt: "2026-05-05" }, DUBAI);
  eq("a broken instant falls through to the date", r.day, "2026-05-05");
  eq("and is honest about which it used", r.precision, "date");
}
eq("a broken instant with nothing behind it yields null",
  P.publishedOn({ postedAtTs: "nonsense" }, DUBAI).day, null);

// A full timestamp in the date column is sliced, not passed through whole.
eq("a timestamp sitting in the date column is still reduced to a day",
  P.publishedDay({ postedAt: "2026-05-05T09:00:00Z" }, DUBAI), "2026-05-05");

/* -- Ranges ----------------------------------------------------------------- */

const JULY = { start: "2026-07-01", end: "2026-07-31" };

check("a mid-month post is inside the month",
  P.publishedWithin({ postedAtTs: "2026-07-15T12:00:00.000Z" }, JULY, DUBAI), "");
check("the first day is inside",
  P.publishedWithin({ postedAtTs: "2026-07-01T08:00:00.000Z" }, JULY, DUBAI), "");
check("the last day is inside",
  P.publishedWithin({ postedAtTs: "2026-07-31T08:00:00.000Z" }, JULY, DUBAI), "");

// The boundary that used to land in the wrong month.
check("22:30 UTC on the 31st is NOT in July, because locally it is August",
  !P.publishedWithin({ postedAtTs: "2026-07-31T22:30:00.000Z" }, JULY, DUBAI), "");
check("20:30 UTC on 30 June IS in July, because locally it is the 1st",
  P.publishedWithin({ postedAtTs: "2026-06-30T20:30:00.000Z" }, JULY, DUBAI), "");

// An undated post cannot be placed, and must not drift into whichever month is
// on screen.
check("a post with no date is in no range at all",
  !P.publishedWithin({}, JULY, DUBAI), "");

/* -- Items, which may have several posts ------------------------------------ */

eq("an item takes its day from its post, not its own column",
  P.itemPublishedDay(
    { producedAt: "2026-07-31" },
    [{ postedAtTs: "2026-07-31T22:30:00.000Z" }],
    DUBAI,
  ), "2026-08-01");

// A cross-post was published when it FIRST went out.
eq("the earliest post wins for a cross-posted video",
  P.itemPublishedDay(
    { producedAt: null },
    [{ postedAtTs: "2026-07-20T10:00:00.000Z" }, { postedAtTs: "2026-07-18T10:00:00.000Z" }],
    DUBAI,
  ), "2026-07-18");

eq("an item with no posts falls back to what a person typed",
  P.itemPublishedDay({ producedAt: "2026-03-04" }, [], DUBAI), "2026-03-04");

eq("an item with no posts and no date has none",
  P.itemPublishedDay({ producedAt: null }, [], DUBAI), null);

eq("a post carrying no date does not mask the item's own",
  P.itemPublishedDay({ producedAt: "2026-03-04" }, [{ postedAtTs: null, postedAt: null }], DUBAI),
  "2026-03-04");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
