// Which platforms cost money, and which sync path each one takes.
//
// WHY THIS EXISTS
//
// isMetered() used to answer "does this platform have rows in scrape_schedule?"
// and that stood in for "does reading a post cost money" only because Instagram
// was the sole platform with a refresh cadence. The day schedule bands were
// added for youtube and tiktok, both were silently reclassified as metered:
// they moved onto the budget-capped path, started claiming against a
// 1400/month allowance sized for Apify, and would have stopped refreshing
// entirely after about five days.
//
// Nothing failed loudly. The build passed, the types passed, and the app
// looked fine -- the damage would have surfaced a working week later as
// "Scrape budget exhausted" on platforms that never cost a penny.
//
// So this asserts the property directly: meteredness comes from the provider
// capability and from nothing else. If someone adds a schedule band, changes a
// provider, or introduces a platform, this fails immediately rather than in
// five days.

import { PROVIDERS } from "../src/lib/providers/index.ts";

let pass = 0;
let fail = 0;
const failures = [];

function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) pass++;
  else {
    fail++;
    failures.push(`${label}: expected ${expected}, got ${actual}`);
  }
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label.padEnd(58)} ${String(actual)}`);
}

console.log("\n=== which platforms bill for a REFRESH ===");
// Instagram alone. Every other route reads a known post for free; that is the
// whole reason the free path exists.
check("instagram refresh is metered", PROVIDERS.instagram.capability.isMetered, true);
check("tiktok refresh is free", PROVIDERS.tiktok.capability.isMetered, false);
check("youtube refresh is free", PROVIDERS.youtube.capability.isMetered, false);
check("youtube_shorts refresh is free", PROVIDERS.youtube_shorts.capability.isMetered, false);

console.log("\n=== discovery bills separately from refresh ===");
// TikTok is the case that makes the distinction necessary: whichever route
// discovery takes, re-reading a KNOWN video is free forever. Collapsing the
// two into one flag is what would put free reads on a paid budget.
//
// discoveryMetered is deliberately NOT asserted to a fixed value, because it
// is environment-dependent and correctly so: with a self-hosted yt-dlp service
// configured, discovery is free and the flag is absent; with only an Apify
// token, discovery bills per row and the flag is true. Pinning it would make
// this test pass or fail on which env vars happen to be present, which is the
// same category of mistake as deciding meteredness from a schedule table.
//
// What must hold in EVERY environment is the asymmetry: refresh is never
// metered, regardless of how discovery is routed.
const tt = PROVIDERS.tiktok.capability;
check("tiktok refresh stays free on every discovery route", tt.isMetered, false);
console.log(
  `       (info: discovery route here is ${
    tt.discoveryMetered ? "Apify — billed per row" : "self-hosted or absent — free"
  })`,
);

console.log("\n=== meteredness does not come from scrape_schedule ===");
// The regression itself. A platform's cost model must not change because a
// row was inserted into a scheduling table.
const src = await import("node:fs").then((fs) =>
  fs.readFileSync("src/lib/scrapeBudget.ts", "utf8"),
);
const isMeteredBody = src.slice(
  src.indexOf("export async function isMetered"),
  src.indexOf("export async function claim"),
);
check(
  "isMetered() does not query scrape_schedule",
  !isMeteredBody.includes("scrape_schedule"),
  true,
);
check(
  "isMetered() reads the provider capability",
  isMeteredBody.includes("capability.isMetered"),
  true,
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log("\nfailures:");
  for (const f of failures) console.log("  - " + f);
  console.log(
    "\nIf a refresh genuinely started costing money, change the provider's\n" +
      "capability and this expectation together -- deliberately, in one commit.",
  );
}
process.exit(fail ? 1 : 0);
