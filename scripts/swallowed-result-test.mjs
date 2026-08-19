// Server actions return a Result. Callers must look at it.
//   npm run test:results
//
// WHY THIS IS A TEST AND NOT A CODE REVIEW
//
// A discarded Result is the worst-behaved bug this codebase can produce,
// because it is invisible from the outside: the action fails, the component
// refreshes from the server, and the screen redraws looking exactly as it did
// before. Nothing is red. Nobody is told. The user has already moved on.
//
// Four of these were live at once, and the pattern is always the same -- a
// button whose onClick awaits an action and then calls refresh():
//
//   revokeApiKey        a credential the operator believes is dead is live
//   toggleKiosk         a kiosk believed deactivated still takes clock-ins
//   discardImportBatch  the batch survives, and the user is already elsewhere
//   reviewTimeOffRequest / updateTrainingModule  approvals that never happened
//
// Every one of those sat in a file that ALREADY had error handling and used
// it correctly a few functions earlier. This is not a knowledge problem; it
// is a "one call site got missed" problem, which is exactly what a test is
// for.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Deliberate exceptions, each with a reason.
 *
 * `file:line` moves, so these match on FILE and ACTION. A second discarded
 * call to the same action in the same file would be missed -- accepted,
 * because line numbers churn on every edit and a test nobody can keep green
 * gets deleted.
 */
const ALLOW = [
  [
    "ContentOverview.tsx",
    "bulkAssignRole",
    "assigned by a multi-line ternary (`const res = cond ? await a() : await b()`), " +
      "and res.error is checked two lines below",
  ],
];

const actionsSrc = readFileSync("src/app/actions.ts", "utf8");
const returnsResult = new Set();
for (const m of actionsSrc.matchAll(
  /export async function (\w+)\s*\(([\s\S]*?)\)\s*:\s*Promise<([^>]+)>/g,
)) {
  if (m[3].includes("Result")) returnsResult.add(m[1]);
}

const walk = (d, out = []) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
  }
  return out;
};

const offenders = [];
for (const f of walk("src").filter((x) => !x.endsWith("actions.ts"))) {
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    const t = line.trim();
    for (const a of returnsResult) {
      const at = t.indexOf("await " + a + "(");
      if (at < 0) continue;
      if (at > 0 && /[.\w]/.test(t[at - 1])) continue;
      const before = t.slice(0, at);
      const kept =
        before.includes("=") ||
        before.startsWith("return") ||
        before.includes("(") ||
        before.includes("?");
      if (kept) continue;
      if (ALLOW.some(([file, action]) => f.includes(file) && action === a)) continue;
      offenders.push({ f, line: i + 1, a, text: t.slice(0, 70) });
    }
  });
}

console.log(`actions returning Result : ${returnsResult.size}`);
console.log(`allowed exceptions       : ${ALLOW.length}`);
for (const [file, action, why] of ALLOW) console.log(`  ${file} ${action}() — ${why}`);
console.log("");

for (const o of offenders) {
  console.log(`FAIL  ${o.f}:${o.line} discards the Result from ${o.a}()`);
  console.log(`        ${o.text}`);
}

console.log(
  offenders.length === 0
    ? "\nPASS  every server-action Result is looked at"
    : `\n${offenders.length} discarded Result(s). Check res.error, or add a reasoned entry to ALLOW.`,
);
process.exit(offenders.length ? 1 : 0);
