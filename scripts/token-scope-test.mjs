// Colour must come from the token layer, not from literals in components.
//
// WHY THIS MATTERS MORE THAN IT LOOKS
//
// The whole theming architecture rests on one property: every component reads
// a variable NAME, so changing a value in globals.css re-skins the app in one
// pass. A hardcoded rgb() opts that component out silently -- it keeps
// rendering the old design while everything around it moves, and nothing
// fails.
//
// That is not hypothetical here. The sidebar's active-nav wash sat at
// rgb(229 72 77 / 0.12) -- the pre-claret red -- for an entire palette change,
// matching neither accent token, because a literal cannot follow a rename.
//
// The rule: no raw rgb()/hex colour in a component. Exceptions are listed,
// each with a reason, so an exception is a decision someone wrote down rather
// than an omission nobody noticed.

import fs from "node:fs";
import path from "node:path";

const ROOTS = ["src/components", "src/app"];

// Files that legitimately carry raw colour values.
const ALLOW = [
  ["src/lib/types.ts", "PLATFORM_COLORS / CHART_COLORS are brand and chart palettes"],
  ["src/components/Avatar.tsx", "deterministic per-person avatar hues, generated not themed"],
  ["src/components/ClientImage.tsx", "same monogram hue generator as Avatar"],
  ["src/components/ProjectsManager.tsx", "user-chosen project colours stored per row"],
];

// rgb(...) or #rrggbb / #rgb, but not inside a comment line.
const COLOUR = /(rgb\(\s*\d+\s+\d+\s+\d+\s*(\/[^)]*)?\)|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b)/;

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = ROOTS.flatMap(walk);
const offenders = [];
let scanned = 0;

for (const file of files) {
  const norm = file.replace(/\\/g, "/");
  if (ALLOW.some(([f]) => norm === f)) continue;
  scanned++;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    // Comments describe colours constantly -- "a 200px bar of #00f2ea glares"
    // -- and documenting a value is the opposite of hardcoding one.
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
    const m = COLOUR.exec(line);
    if (m) offenders.push(`${norm}:${i + 1}  ${m[0]}`);
  });
}

console.log("COLOUR COMES FROM TOKENS\n");
console.log(`  scanned ${scanned} component file(s)`);
for (const [f, why] of ALLOW) console.log(`  allowed: ${f} — ${why}`);

if (offenders.length) {
  console.log(`\n  ${offenders.length} hardcoded colour(s):`);
  for (const o of offenders) console.log("    - " + o);
  console.log(
    "\n  Use a var(--token) instead. If the value genuinely cannot be themed,\n" +
      "  add the file to ALLOW above with a reason.",
  );
} else {
  console.log("\n  no hardcoded colours outside the allowlist");
}

console.log(`\n${scanned - offenders.length} passed, ${offenders.length} failed`);
process.exit(offenders.length ? 1 : 0);
