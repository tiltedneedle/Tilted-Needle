// Snapshot thinning: what it removes, and more importantly what it must not.
//
// This function deletes history, so the tests that matter are the negative
// ones. Any pruner can shrink a table; the question is whether the curve you
// get back afterwards still says the same thing.

import { thinSnapshots, KEEP_ALL_DAYS, MIN_KEEP } from "../src/lib/thinSnapshots.ts";

let pass = 0, fail = 0;
const failures = [];
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else { fail++; failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label.padEnd(56)} ${JSON.stringify(actual)}`);
}

const DAY = 86400000;
const NOW = Date.UTC(2026, 7, 17);
const old = (daysAgo) => NOW - daysAgo * DAY;

/** n readings, `daysAgo` back, spaced a day apart, with the given views. */
const series = (startDaysAgo, views) =>
  views.map((v, i) => ({ id: "s" + i, capturedAt: old(startDaysAgo - i), views: v }));

console.log("\n=== what it removes ===");
// Perfectly linear: every interior point is predictable from its neighbours.
// Alternating, because a removed point's neighbour is protected.
//
// 20 readings, not 7: the MIN_KEEP floor leaves anything at or below 12
// entirely alone, so a short fixture would test the floor rather than the
// collinearity rule.
const linear = series(300, Array.from({ length: 20 }, (_, i) => 100 + i * 100));
const cut = thinSnapshots(linear, NOW).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
check("a straight line loses alternating interior points", cut, ["s1", "s3", "s5", "s7", "s9", "s11", "s13", "s15"]);
check("first reading always survives", cut.includes("s0"), false);
check("last reading always survives", cut.includes("s19"), false);
check("and it stops at the floor", 20 - cut.length >= MIN_KEEP, true);

console.log("\n=== what it must NOT remove ===");
// The bend is the signal. 100 -> 105 -> 300 is a video that took off; the
// middle point is where it happened.
const bend = series(300, [100, 105, 300]);
check("an inflection point is kept", thinSnapshots(bend, NOW), []);

// A plateau followed by a jump: the last flat reading dates the takeoff.
const plateau = series(300, [100, 100, 100, 100, 5000]);
const pcut = thinSnapshots(plateau, NOW);
check("the reading just before a jump is kept", pcut.includes("s3"), false);

console.log("\n=== the recent window is untouchable ===");
// Same perfectly-linear shape, but inside the keep-all window.
const recent = series(10, [100, 200, 300, 400, 500]);
check(`nothing within ${KEEP_ALL_DAYS} days is removed`, thinSnapshots(recent, NOW), []);

// A series straddling the boundary: only the old half is eligible.
const straddle = series(KEEP_ALL_DAYS + 3, [100, 200, 300, 400, 500, 600]);
const scut = thinSnapshots(straddle, NOW);
const boundary = straddle.filter((s) => s.capturedAt >= NOW - KEEP_ALL_DAYS * DAY).map((s) => s.id);
check("no removal crosses the boundary", scut.filter((id) => boundary.includes(id)), []);

console.log("\n=== edge cases ===");
check("empty series", thinSnapshots([], NOW), []);
check("a single reading", thinSnapshots(series(300, [100]), NOW), []);
check("two readings", thinSnapshots(series(300, [100, 200]), NOW), []);
// A null is the platform declining to answer; its absence is information.
const withNull = series(300, [100, null, 300]);
check("a null reading is never removed", thinSnapshots(withNull, NOW), []);
// Duplicate timestamps must not divide by zero.
const same = [
  { id: "a", capturedAt: old(300), views: 100 },
  { id: "b", capturedAt: old(300), views: 100 },
  { id: "c", capturedAt: old(300), views: 100 },
];
check("identical timestamps do not explode", thinSnapshots(same, NOW), []);

console.log("\n=== scale independence ===");
// The same shape at two magnitudes must thin identically -- an absolute
// threshold would delete everything on one and nothing on the other.
const small = series(300, [10, 20, 30, 40, 50]);
const large = series(300, [10000, 20000, 30000, 40000, 50000]);
check("small and large curves thin the same", thinSnapshots(small, NOW).sort(), thinSnapshots(large, NOW).sort());

console.log("\n=== it converges ===");
// Re-running must not keep eating the series. Feed the survivors back in.
let live = series(400, Array.from({ length: 40 }, (_, i) => 100 + i * 10));
let rounds = 0;
for (;;) {
  const gone = new Set(thinSnapshots(live, NOW));
  if (gone.size === 0) break;
  live = live.filter((s) => !gone.has(s.id));
  if (++rounds > 20) break;
}
check("repeated passes terminate", rounds <= 20, true);
check("and leave the endpoints", [live[0].id, live[live.length - 1].id], ["s0", "s39"]);
// The floor is what stops a perfectly straight line collapsing to two points
// over successive passes. Before it existed, this measured exactly that.
check(`never thins below the floor of ${MIN_KEEP}`, live.length >= MIN_KEEP, true);
console.log(`       (40 readings -> ${live.length} after ${rounds} passes)`);

// And a short series is left completely alone.
const short = series(300, Array.from({ length: MIN_KEEP }, (_, i) => 100 + i * 10));
check("a series at the floor is untouched", thinSnapshots(short, NOW), []);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nfailures:"); for (const f of failures) console.log("  - " + f); }
process.exit(fail ? 1 : 0);
