// select("*") must never touch a table with a revoked column.
//
// WHY THIS IS ITS OWN CHECK
//
// PostgREST rejects the WHOLE query with 42501 if ANY requested column is
// revoked. So on a table with a column-level REVOKE, select("*") cannot
// succeed for a signed-in user no matter how permissive the row policy is --
// it fails outright, and the error names the TABLE, not the column, which
// sends you reading RLS policies that were never the problem.
//
// That is not hypothetical. rls-test asserted "client sees only its own
// membership" using select("*"), discarded the error, and reported "saw
// undefined". It read as a broken row policy and sat failing while the policy
// was correct the whole time.
//
// scripts/select-audit.mjs cannot catch this: it runs every select with the
// SERVICE ROLE, which bypasses column grants entirely, so a query that fails
// for every real user passes there cleanly. This check works statically
// instead -- it reads the revokes out of the migrations and the selects out of
// the source, and refuses the combination.

import fs from "node:fs";
import path from "node:path";

const MIGRATIONS = "supabase/migrations";
const SRC = "src";

// --- what is revoked, per table --------------------------------------------
const revoked = new Map(); // table -> Set(column)
for (const f of fs.readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql"))) {
  const sql = fs.readFileSync(path.join(MIGRATIONS, f), "utf8");
  // revoke select (col) on table from role;
  const re = /revoke\s+select\s*\(\s*([a-z_,\s]+?)\s*\)\s+on\s+([a-z_.]+)/gi;
  let m;
  while ((m = re.exec(sql))) {
    const cols = m[1].split(",").map((c) => c.trim());
    const table = m[2].replace(/^public\./, "");
    if (!revoked.has(table)) revoked.set(table, new Set());
    for (const c of cols) revoked.get(table).add(c);
  }
}

// --- every .from(X).select("*") in the source ------------------------------
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const offenders = [];
let starSelects = 0;
for (const file of walk(SRC)) {
  const src = fs.readFileSync(file, "utf8");

  /**
   * Walk BACKWARD from each select("*") to the nearest preceding .from().
   *
   * The obvious forward pattern -- .from("x") ... .select("*") with a bounded
   * gap -- is wrong, and wrong in the direction that matters: the gap happily
   * spans intervening statements, so it pairs one query's .from() with a
   * LATER query's .select("*"). Fault-injecting a select("*") on memberships
   * proved it: the check reported the table as "platform_posts", found no
   * revoke for it, and passed. Every row it printed was mis-attributed.
   *
   * The nearest preceding .from() is unambiguous, because a select always
   * chains off the from that opened its own statement.
   */
  const starRe = /\.select\(\s*["'`]\*["'`]/g;
  const fromRe = /\.from\(\s*["'`]([a-z_]+)["'`]\s*\)/g;

  // Index every .from() once, then binary-search-free scan backward.
  const froms = [];
  let fm;
  while ((fm = fromRe.exec(src))) froms.push({ index: fm.index, table: fm[1] });

  let sm;
  while ((sm = starRe.exec(src))) {
    starSelects++;
    let owner = null;
    for (const f of froms) {
      if (f.index < sm.index) owner = f;
      else break;
    }
    if (owner && revoked.has(owner.table)) {
      const line = src.slice(0, sm.index).split("\n").length;
      offenders.push(
        `${file.replace(/\\/g, "/")}:${line}  select("*") on ${owner.table} ` +
          `(revoked: ${[...revoked.get(owner.table)].join(", ")})`,
      );
    }
  }
}

console.log("select(*) MUST AVOID TABLES WITH REVOKED COLUMNS\n");
if (revoked.size === 0) {
  console.log("  no column-level revokes found in migrations");
} else {
  for (const [t, cols] of revoked) {
    console.log(`  revoked: ${t}.${[...cols].join(", ")}`);
  }
}
console.log(`\n  scanned ${starSelects} select("*") call(s) in ${SRC}/`);

if (offenders.length) {
  console.log(`\n  ${offenders.length} unsafe:`);
  for (const o of offenders) console.log("    - " + o);
  console.log(
    "\n  Name the columns explicitly instead. select(\"*\") on these tables\n" +
      "  returns 42501 for every signed-in user, and the error names the table\n" +
      "  rather than the column -- so it reads as an RLS bug that isn't there.",
  );
} else {
  console.log("\n  none of them touch a table with a revoked column");
}

console.log(`\n${starSelects - offenders.length} passed, ${offenders.length} failed`);
process.exit(offenders.length ? 1 : 0);
