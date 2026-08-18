// A binned client must not appear anywhere.
//
// WHY THIS IS A TEST AND NOT A CODE REVIEW
//
// `clients.deleted_at` is a soft delete, and soft deletes fail in one
// characteristic way: every read has to opt IN to the filter, and the one
// query that forgets shows a deleted client as though nothing happened. There
// are nineteen places in this codebase that read the clients table. Nineteen
// is more than anyone reliably checks by hand, and the failure is silent --
// the row simply appears, looking normal.
//
// The service role cannot be defended by RLS here (it bypasses policies by
// design), so there is no database-level backstop. This grep IS the backstop.
//
// It is deliberately dumb: it looks for `.from("clients")` and requires the
// same statement to mention deleted_at. A query that legitimately wants the
// binned rows -- listBinnedClients, restoreClient, the purge -- says so via
// the allowlist below, which makes each exception a decision someone wrote
// down rather than an omission.

import fs from "node:fs";
import path from "node:path";

const ROOT = "src";

// Reads that SHOULD see binned clients, each for a stated reason.
const ALLOW = [
  ["src/app/actions.ts", "binClient / restoreClient / listBinnedClients own the bin itself"],
];

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
let checked = 0;
const offenders = [];

for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const norm = file.replace(/\\/g, "/");
  if (ALLOW.some(([f]) => norm === f)) continue;

  let idx = 0;
  for (;;) {
    idx = src.indexOf('.from("clients")', idx);
    if (idx < 0) break;
    checked++;
    // The statement runs until the next semicolon at depth zero -- close
    // enough, since these are all chained builder calls on one statement.
    const end = src.indexOf(";", idx);
    const stmt = src.slice(idx, end < 0 ? src.length : end);
    const count = (stmt.match(/\.is\("deleted_at", null\)/g) || []).length;
    if (count === 0) {
      const line = src.slice(0, idx).split("\n").length;
      offenders.push(`${norm}:${line}  (missing)`);
    } else if (count > 1) {
      // Harmless to run -- the same predicate twice -- but it only happens
      // when a scripted edit is applied more than once, and nineteen of these
      // appeared exactly that way. Flagged so the next bulk rewrite says so
      // rather than leaving a quiet mess behind.
      const line = src.slice(0, idx).split("\n").length;
      offenders.push(`${norm}:${line}  (filter repeated ${count}x)`);
    }
    idx += 16;
  }
}

console.log("BINNED CLIENTS MUST NOT LEAK\n");
console.log(`  checked ${checked} read(s) of the clients table outside the allowlist`);
for (const [f, why] of ALLOW) console.log(`  allowed: ${f} — ${why}`);

if (offenders.length) {
  console.log(`\n  ${offenders.length} read(s) missing a deleted_at filter:`);
  for (const o of offenders) console.log("    - " + o);
  console.log(
    "\n  Add .is(\"deleted_at\", null) to each, or add it to ALLOW above with a\n" +
      "  reason if it genuinely needs to see binned clients.",
  );
} else {
  console.log("\n  every read filters binned clients out");
}

console.log(`\n${checked - offenders.length} passed, ${offenders.length} failed`);
process.exit(offenders.length ? 1 : 0);
