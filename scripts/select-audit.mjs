// Audit: runs every distinct .from(X).select("...") found in src/ against
// the live database (service role, limit 1). A structurally invalid select
// -- ambiguous embed, wrong FK hint, misspelled column -- errors here
// instead of silently rendering as an empty page like the todos/training
// bug did. Rows returned are irrelevant; only query validity is checked.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const env = (n) =>
  (readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .find((l) => l.startsWith(n + "=")) || "")
    .slice(n.length + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
const admin = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), {
  auth: { persistSession: false },
});

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const queries = new Map(); // "table :: select" -> files
for (const file of walk(fileURLToPath(new URL("../src", import.meta.url)))) {
  const src = readFileSync(file, "utf8");
  // .from("x") ... .select("...") or .select(`...`), tolerating whitespace,
  // comments, and multi-line select strings.
  const re = /\.from\(\s*"([a-z_]+)"\s*\)\s*(?:\.[a-zA-Z]+\([^)]*\)\s*)*?\.select\(\s*(?:"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)/gs;
  let m;
  while ((m = re.exec(src))) {
    const table = m[1];
    const select = (m[2] ?? m[3] ?? "")
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!select) continue;
    // Template-literal selects with runtime interpolation cannot be checked
    // statically -- skip rather than false-positive (one known site:
    // scrapeBudget, whose interpolated column is a closed 3-value union).
    if (select.includes("${")) continue;
    const key = `${table} :: ${select}`;
    if (!queries.has(key)) queries.set(key, []);
    queries.get(key).push(file.split(/src[\\/]/)[1] ?? file);
  }
}

console.log(`Found ${queries.size} distinct table/select pairs.\n`);
let bad = 0;
for (const [key, files] of queries) {
  const [table, select] = key.split(" :: ");
  const { error } = await admin.from(table).select(select).limit(1);
  if (error) {
    bad++;
    console.log(`FAIL  ${table}`);
    console.log(`      select: ${select.slice(0, 140)}`);
    console.log(`      error:  ${error.message}`);
    console.log(`      files:  ${[...new Set(files)].join(", ")}`);
  }
}
console.log(bad === 0 ? "\nAll selects structurally valid against the live schema." : `\n${bad} broken select(s).`);
process.exit(bad ? 1 : 0);
