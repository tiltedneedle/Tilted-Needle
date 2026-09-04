// What each Apify account has spent, and where work is being routed.
//   node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/apify-status.mjs
//
// Runs in the pipeline so the answer is waiting rather than asked for. A
// cloud routine cannot do this job: the tokens are secrets, and the only
// places that hold them are this machine and the GitHub Actions environment.
// Actions already runs every six hours, so the check belongs there.
//
// Output goes to stdout and is appended to the job summary by the workflow,
// which makes "did routing rebalance yet" a question you answer by looking at
// the most recent run rather than by running anything.
import { readFileSync } from "node:fs";

// .env.local locally, real env in CI. Neither is required to exist.
try {
  const file = Object.fromEntries(
    readFileSync("./.env.local", "utf8").split("\n").filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(),
                   l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
  );
  for (const [k, v] of Object.entries(file)) process.env[k] ??= v;
} catch { /* CI supplies the environment directly */ }

const { readApifyUsage } = await import("../src/lib/apifyUsage.ts");
const { chooseAccount, headroomPerDay } = await import("../src/lib/apifyRouting.ts");
const { TRANSCRIPT_ACTORS } = await import("../src/lib/providers/apifyTranscripts.ts");

const usage = await readApifyUsage();

console.log("## Apify accounts\n");
console.log("| account | used | cap | spare after baseline | resets | $/day spare |");
console.log("|---|---|---|---|---|---|");
for (const a of usage) {
  if (a.error) {
    // Never a zero. An unreadable account and an idle one look identical
    // otherwise, and that is the failure this whole file exists to avoid.
    console.log(`| ${a.tokenName} | — | — | **unreadable** | — | ${a.error} |`);
    continue;
  }
  const rate = headroomPerDay(a);
  console.log(
    `| ${a.account ?? a.tokenName} | $${a.usedUsd.toFixed(3)} | $${a.maxMonthlyUsd} `
    + `| $${(a.spareAfterBaselineUsd ?? 0).toFixed(2)} `
    + `| ${String(a.cycleEnd ?? "?").slice(0, 10)} (${(a.daysRemaining ?? 0).toFixed(1)}d) `
    + `| $${rate == null ? "?" : rate.toFixed(3)} |`,
  );
}

console.log("\n## Transcript routing\n");
console.log("| platform | default account | routed to | moved | why |");
console.log("|---|---|---|---|---|");
for (const [platform, actor] of Object.entries(TRANSCRIPT_ACTORS)) {
  const c = chooseAccount(usage, actor.tokenEnv);
  const moved = c.tokenEnv !== actor.tokenEnv;
  console.log(
    `| ${platform} | ${actor.tokenEnv} | ${c.tokenEnv} | ${moved ? "**yes**" : "no"} | ${c.reason} |`,
  );
}

/* A ROUTING DECISION THE ENVIRONMENT CANNOT HONOUR IS WORSE THAN NONE.
   The router will happily nominate an account whose token is absent here,
   and fetchTranscript then falls back to the default -- correct behaviour,
   but silent. Saying it out loud is the difference between "routing is
   working" and "routing is deciding and being ignored". */
const missing = [...new Set(Object.values(TRANSCRIPT_ACTORS).map((a) => a.tokenEnv))]
  .filter((e) => !process.env[e]);
if (missing.length) {
  console.log(`\n> **${missing.join(", ")} not set in this environment.**`);
  console.log("> Work routed to it silently falls back to the configured default,");
  console.log("> so cross-account rebalancing is inactive here.");
}
