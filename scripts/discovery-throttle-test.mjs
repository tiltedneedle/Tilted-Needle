// Tests for the discovery cooldown. This is the fix for a real incident: an
// unthrottled 15-minute cron against 10 real accounts would burn the entire
// monthly discovery pool in under half an hour, then leave automatic
// discovery dead for the rest of the month. These pin the boundary math so
// that regression cannot silently return.
const R = await import("../src/lib/discoveryThrottle.ts");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

check("a manual trigger is always due, even seconds after the last attempt",
  R.isDueForDiscovery("manual", new Date(now - 1000).toISOString(), now) === true);

check("a cron trigger with no prior attempt is due (first-ever discovery)",
  R.isDueForDiscovery("cron", null, now) === true);

check("a cron trigger just inside the cooldown is NOT due",
  R.isDueForDiscovery("cron", new Date(now - (10 * DAY - 60000)).toISOString(), now) === false);

check("a cron trigger exactly at the cooldown boundary is due",
  R.isDueForDiscovery("cron", new Date(now - 10 * DAY).toISOString(), now) === true);

check("a cron trigger well past the cooldown is due",
  R.isDueForDiscovery("cron", new Date(now - 20 * DAY).toISOString(), now) === true);

check("the cron cooldown is exactly 10 days, not something that quietly drifted",
  R.AUTO_DISCOVERY_COOLDOWN_MS === 10 * DAY);

// The budget math this cooldown exists to protect: 10 workspace accounts,
// each asking AUTO_DISCOVERY_WANT rows once per cooldown window, must land
// safely under the 200-credit monthly discovery pool with real headroom for
// manual syncs -- not just avoid overrunning it outright.
{
  const accounts = 10;
  const attemptsPerMonth = 30 / (R.AUTO_DISCOVERY_COOLDOWN_MS / DAY);
  const monthlySpend = accounts * R.AUTO_DISCOVERY_WANT * attemptsPerMonth;
  check("projected monthly auto-discovery spend stays under the 200 pool",
    monthlySpend < 200, `${monthlySpend} credits/mo for ${accounts} accounts`);
  check("projected spend leaves real headroom for manual syncs (under 90% of pool)",
    monthlySpend < 180, `${monthlySpend} credits/mo`);
}

// Without the throttle: what actually happened before this fix, for the
// record. Documents the incident this code prevents, not a passing case.
{
  const accounts = 10;
  const ticksPerDay = (24 * 60) / 15; // the cron's real cadence
  const unthrottledWant = 12; // the old fixed request size
  const creditsToExhaustPool = Math.ceil(200 / (accounts * unthrottledWant));
  const minutesToExhaust = creditsToExhaustPool * 15;
  check("documented incident: unthrottled cron would have exhausted the pool within an hour",
    minutesToExhaust <= 60, `${minutesToExhaust} minutes (${creditsToExhaustPool} ticks at ${ticksPerDay}/day)`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
