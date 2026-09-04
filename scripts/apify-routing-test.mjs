// Which Apify account pays, and why.
//   node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/apify-routing-test.mjs
import { chooseAccount, headroomPerDay } from "../src/lib/apifyRouting.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

/** A readable account. */
const acct = (tokenName, spare, days, extra = {}) => ({
  tokenName, account: tokenName.toLowerCase(), plan: "FREE",
  maxMonthlyUsd: 5, usedUsd: 5 - spare, cycleStart: null, cycleEnd: null,
  daysElapsed: 10, daysRemaining: days, burnPerDayUsd: 0.1,
  projectedUsd: 5 - spare, spareNowUsd: spare, spareAfterBaselineUsd: spare,
  error: null, ...extra,
});

/* ---- The metric is spare PER DAY, not spare -----------------------------
   The real observation this was built from: two accounts with similar
   balances in completely different positions, because unused credit expires
   at the cycle boundary rather than rolling over. */
{
  const tilted   = acct("APIFY_TOKEN", 3.33, 24.5);        // $0.136/day
  const palatial = acct("APIFY_TIKTOK_TOKEN", 4.16, 7.5);  // $0.555/day

  check("headroom is spare divided by days left",
    Math.abs(headroomPerDay(palatial) - 4.16 / 7.5) < 1e-9);
  check("the account with a nearer reset wins despite a similar balance",
    chooseAccount([tilted, palatial], "APIFY_TOKEN").tokenEnv === "APIFY_TIKTOK_TOKEN");
  check("and the reason names the expiry",
    /expires in 7\.5d/.test(chooseAccount([tilted, palatial], "APIFY_TOKEN").reason));
  // Sanity: on BALANCE alone tilted and palatial look 20% apart. On rate they
  // are 4x apart. Routing on balance would have been close to a coin flip.
  check("balance alone would not have separated them",
    Math.abs(4.16 - 3.33) / 3.33 < 0.3 && headroomPerDay(palatial) / headroomPerDay(tilted) > 3);
}

/* ---- Stability: no ping-ponging between near-equal accounts -------------- */
{
  const a = acct("APIFY_TOKEN", 3.0, 10);          // 0.300/day
  const b = acct("APIFY_TIKTOK_TOKEN", 3.3, 10);   // 0.330/day, only 10% better
  const c = chooseAccount([a, b], "APIFY_TOKEN");
  check("a marginally better account does not steal the default",
    c.tokenEnv === "APIFY_TOKEN", c.reason);

  const far = acct("APIFY_TIKTOK_TOKEN", 4.5, 3);  // 1.5/day, 5x better
  check("a clearly better account does take over",
    chooseAccount([a, far], "APIFY_TOKEN").tokenEnv === "APIFY_TIKTOK_TOKEN");
}

/* ---- Failure never invents permission to spend --------------------------- */
{
  const broken = { ...acct("APIFY_TOKEN", 0, 0), error: "network down" };
  const other = { ...acct("APIFY_TIKTOK_TOKEN", 0, 0), error: "network down" };
  const c = chooseAccount([broken, other], "APIFY_TOKEN");
  check("unreadable usage falls back to the configured account",
    c.tokenEnv === "APIFY_TOKEN" && c.fellBack === true);
  check("and says so rather than implying a decision", /unreadable/i.test(c.reason));
  check("headroom is null when nothing could be read", c.headroomPerDay === null);
  check("a broken account yields no headroom figure", headroomPerDay(broken) === null);
}

{
  // Both at their ceiling: routing must not manufacture a winner. The
  // caller's own budget guard is what refuses; this just steps aside.
  const a = acct("APIFY_TOKEN", 0.01, 10);
  const b = acct("APIFY_TIKTOK_TOKEN", 0.02, 10);
  const c = chooseAccount([a, b], "APIFY_TOKEN");
  check("no useful headroom defers to the budget guard",
    c.tokenEnv === "APIFY_TOKEN" && c.headroomPerDay === 0);
  check("and does not claim to have found capacity", /budget guard/i.test(c.reason));
}

/* ---- Edge arithmetic ----------------------------------------------------- */
{
  // Last afternoon of a cycle: dividing by ~0 would report vast headroom for
  // credit that is about to vanish.
  const expiring = acct("APIFY_TIKTOK_TOKEN", 4.0, 0.01);
  check("days remaining is clamped so a dying cycle cannot look infinite",
    headroomPerDay(expiring) === 4.0 / 0.5);

  const fresh = acct("APIFY_TOKEN", 5, 30);
  check("a full cycle reports a modest daily rate",
    Math.abs(headroomPerDay(fresh) - 5 / 30) < 1e-9);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
