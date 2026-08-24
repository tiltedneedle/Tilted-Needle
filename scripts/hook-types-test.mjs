// The hook taxonomy and per-client hook performance.
//   node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/hook-types-test.mjs
import { readFileSync } from "node:fs";
import {
  HOOK_TYPES, isHookType, hookTypeLabel, hookPerformance, MIN_VIDEOS_PER_HOOK,
} from "../src/lib/analysis/hookTypes.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

/* ---- The vocabulary ------------------------------------------------------ */
{
  check("ten hook types, no more", HOOK_TYPES.length === 10, `got ${HOOK_TYPES.length}`);
  check("ids are unique", new Set(HOOK_TYPES.map((h) => h.id)).size === 10);
  check("every type carries a hint and an example",
    HOOK_TYPES.every((h) => h.hint.length > 20 && h.example.length > 5));
  check("isHookType accepts every declared id", HOOK_TYPES.every((h) => isHookType(h.id)));
  check("isHookType rejects anything else",
    !isHookType("educational") && !isHookType("") && !isHookType(null) && !isHookType(7));
  check("hookTypeLabel is null for untagged", hookTypeLabel(null) === null);
}

/* ---- The constraint must not drift from the list -------------------------
   The migration hard-codes the ten values, and the module hard-codes them
   again. This project has already been bitten once by a constant duplicated
   across files -- the Always Free ceiling sat at 4 OCPU in audit.py while the
   other two files said 2 -- so the duplication gets a test rather than a
   comment asking people to be careful. */
{
  const sql = readFileSync("./supabase/migrations/20260824120000_hook_type.sql", "utf8");
  const block = sql.slice(sql.indexOf("hook_type in ("), sql.indexOf("));"));
  const inSql = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  const inCode = HOOK_TYPES.map((h) => h.id).sort();
  check("the check constraint lists exactly the module's ids",
    JSON.stringify(inSql) === JSON.stringify(inCode),
    `sql=${inSql.join(",")} code=${inCode.join(",")}`);
}

/* ---- Performance --------------------------------------------------------- */
const rows = (spec) => spec.flatMap(([hookType, ...idx]) => idx.map((index) => ({ hookType, index })));

{
  // 10 questions at 2.0, 10 bold claims at 1.0 -> question is 2x its siblings.
  const perf = hookPerformance(rows([
    ["question", ...Array(10).fill(2)],
    ["bold_claim", ...Array(10).fill(1)],
  ]));
  const q = perf.find((p) => p.hookType === "question");
  check("counts only videos with that hook", q.n === 10);
  check("median is the hook's own median", q.medianIndex === 2);
  check("the comparison is against OTHER hooks, not against 1.0",
    q.medianOthers === 1 && q.ratio === 2);
  check("nothing is underpowered at n=10", perf.every((p) => !p.underpowered));
}

{
  // Untagged rows are UNKNOWN and must not become a denominator.
  const perf = hookPerformance([
    ...Array(9).fill({ hookType: "story", index: 1.5 }),
    ...Array(50).fill({ hookType: null, index: 0.2 }),
    ...Array(50).fill({ hookType: "not_a_hook", index: 0.2 }),
  ]);
  check("untagged videos are excluded entirely", perf.length === 1 && perf[0].n === 9);
  check("an unknown hook string is excluded, not bucketed",
    !perf.some((p) => p.hookType === "not_a_hook"));
  check("with no sibling hooks the ratio is null, not 1",
    perf[0].medianOthers === null && perf[0].ratio === null);
}

{
  const perf = hookPerformance(rows([
    ["question", ...Array(MIN_VIDEOS_PER_HOOK - 1).fill(9)],   // tiny n, huge index
    ["story", ...Array(MIN_VIDEOS_PER_HOOK).fill(1.1)],
  ]));
  check("n below the floor is flagged underpowered",
    perf.find((p) => p.hookType === "question").underpowered === true);
  check("n at the floor is not flagged",
    perf.find((p) => p.hookType === "story").underpowered === false);
  // The whole point: a 9x hook resting on 7 videos must not outrank a 1.1x
  // hook resting on 8. Sorting it first would be the headline the number has
  // not earned.
  check("an underpowered row never sorts above a powered one",
    perf[0].hookType === "story" && perf[1].hookType === "question");
}

{
  const perf = hookPerformance([
    { hookType: "question", index: null },
    { hookType: "question", index: 0 },
    { hookType: "question", index: -3 },
    { hookType: "question", index: 2 },
  ]);
  check("null and non-positive indices are dropped", perf[0].n === 1);
}

{
  check("an empty corpus yields no rows, not a zero row",
    hookPerformance([]).length === 0);
  // Even median arithmetic: 4 values -> mean of the middle two.
  const perf = hookPerformance(rows([["story", 1, 2, 3, 4]]));
  check("even-length median averages the middle pair", perf[0].medianIndex === 2.5);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
