// The number a client is shown must be the shrunk one.
//   npm run test:shrinkage
//
// WHY THIS IS ITS OWN TEST
//
// buildClientEvidence has always computed a ratio of medians per client and
// printed it. The ratio is not wrong -- it is what happened in that library --
// but at n=3 it is mostly noise, and the code's own comment already knew the
// danger: "printing it with a caveat is not good enough because the number is
// what gets remembered."
//
// applyWorkspaceInference is what fixes that, and it fixes it in a way no
// per-client test could detect: it pools ACROSS clients and writes each one's
// posterior back. So the property to check is a relationship between clients,
// not a property of any one of them -- specifically, that a client with a loud
// ratio from a tiny sample gets pulled toward what everyone else shows.
import { readFileSync } from "node:fs";
import {
  buildClientEvidence, applyWorkspaceInference, MIN_PER_SIDE,
} from "../src/lib/analysis/clientEvidence.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

let counter = 0;
const video = (clientId, { index, title = "A video", hook = null, ts = null } = {}) => ({
  id: `v${counter++}`,
  title,
  clientId,
  bestIndex: index,
  lengthSeconds: 40,
  postedAtTs: ts,
  hookText: hook,
  platforms: [{ platform: "youtube", views: 1000 }],
});

/* ---- The headline case --------------------------------------------------
   Eight clients where numbered titles do nothing, plus one small client where
   three numbered videos happened to land badly. The small client's raw ratio
   is dramatic and meaningless. */
{
  const byClient = new Map();

  // Eight clients, no real effect, comfortably sized.
  for (let c = 0; c < 8; c++) {
    const vids = [];
    for (let i = 0; i < 20; i++) {
      // Deterministic spread, alternating sides, no effect between them.
      const idx = 1 + ((i * 37) % 23) / 10;
      vids.push(video(`big${c}`, { index: idx, title: i % 2 ? "How we did it 5 ways" : "How we did it" }));
    }
    byClient.set(`big${c}`, vids);
  }

  // The small one: three numbered videos that all did badly, ten that did fine.
  const small = [];
  for (let i = 0; i < 3; i++) small.push(video("small", { index: 0.4, title: `${i + 3} ways to win` }));
  for (let i = 0; i < 10; i++) small.push(video("small", { index: 1.0 + i * 0.05, title: "Ways to win" }));
  byClient.set("small", small);

  const evidence = new Map(
    [...byClient.entries()].map(([id, vids]) => [id, buildClientEvidence(id, vids)]),
  );

  const before = (evidence.get("small").splits ?? []).find((s) => s.id === "h_title_numeral");
  check("the raw split is computed and is dramatic",
    before && before.ratio < 0.6, before ? `raw ratio ${before.ratio}` : "no split");
  check("before pooling, no multiplier and no state",
    before?.multiplier === null && before?.state === "none",
    "a per-client ratio is not a finding on its own");

  const summary = applyWorkspaceInference(byClient, evidence, { permutations: 300 });
  const after = (evidence.get("small").splits ?? []).find((s) => s.id === "h_title_numeral");

  check("pooling runs and reports what it did", summary.ran >= 1,
    `${summary.ran} hypotheses ran, ${summary.significant} significant, ${summary.acting} actionable`);
  check("the row now carries a posterior multiplier", typeof after?.multiplier === "number",
    String(after?.multiplier));
  check("the raw ratio is KEPT alongside it", after?.ratio === before.ratio,
    "a reader is entitled to see what actually happened in their library");
  check(
    "the printed number is pulled toward the pooled effect",
    after.multiplier > after.ratio,
    `raw ${after.ratio} -> posterior ${after.multiplier} (B=${after.shrinkage})`,
  );
  check("the pooled effect is reported so the row can be read in context",
    typeof after.pooledMultiplier === "number" && after.contributingClients >= 3,
    `${after.pooledMultiplier}x across ${after.contributingClients} clients`);
}

/* ---- Silence is the expected output ------------------------------------- */
/* With no real effect anywhere, nothing should reach "acting". This is the
   property the whole design turns on, and the previous engine failed it 86% of
   the time. */
{
  const byClient = new Map();
  for (let c = 0; c < 6; c++) {
    const vids = [];
    for (let i = 0; i < 18; i++) {
      const idx = 0.5 + ((i * 53 + c * 11) % 31) / 10;
      vids.push(video(`c${c}`, {
        index: idx,
        title: i % 3 === 0 ? "Top 7 things?" : "Things we learned",
        ts: new Date(Date.UTC(2026, 5, 1 + i, i % 24)).toISOString(),
      }));
    }
    byClient.set(`c${c}`, vids);
  }
  const evidence = new Map(
    [...byClient.entries()].map(([id, vids]) => [id, buildClientEvidence(id, vids)]),
  );
  const summary = applyWorkspaceInference(byClient, evidence, { permutations: 300 });
  check("no client is told to act on noise", summary.acting === 0,
    `${summary.ran} ran, ${summary.acting} actionable`);

  const states = [...evidence.values()].flatMap((e) => (e.splits ?? []).map((s) => s.state));
  check("every row lands in a valid state",
    states.every((s) => ["acting", "holds", "none"].includes(s)),
    `${states.length} rows`);
}

/* ---- Unobserved still never counts as a negative ------------------------ */
{
  const byClient = new Map();
  for (let c = 0; c < 4; c++) {
    const vids = [];
    // Half have a hook, half have none at all.
    for (let i = 0; i < 16; i++) {
      vids.push(video(`h${c}`, {
        index: 1 + (i % 7) / 10,
        hook: i % 2 ? "What if I told you this changes everything?" : null,
      }));
    }
    byClient.set(`h${c}`, vids);
  }
  const evidence = new Map(
    [...byClient.entries()].map(([id, vids]) => [id, buildClientEvidence(id, vids)]),
  );
  applyWorkspaceInference(byClient, evidence, { permutations: 200 });

  const hookSplit = (evidence.get("h0").splits ?? []).find((s) => s.id === "h_hook_question");
  check("a hook split counts only videos that HAVE a hook",
    !hookSplit || hookSplit.withN + hookSplit.withoutN <= 8,
    hookSplit ? `${hookSplit.withN}/${hookSplit.withoutN} of 16 videos` : "no split (all one side)");
}

/* ---- The registry contract ---------------------------------------------- */
/* Splits and rank hypotheses must not test the same covariate. Three median
   splits of continuous covariates were removed for exactly this reason; if one
   comes back, the family silently double-counts the question it is correcting
   for. */
{
  const src = readFileSync("./src/lib/analysis/clientEvidence.ts", "utf8");
  const live = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  for (const gone of ["Title over 50 characters", "Longer than this client", "Faster opening"]) {
    check(`the median split "${gone}" stays removed`,
      !live.includes(gone),
      "it is tested as a rank hypothesis instead; both forms would double-count");
  }
  check("the model is given a state it may not alter",
    /enum: \["acting", "holds", "none"\]/.test(live) && !/enum: \["low", "medium", "high"\]/.test(live));
  check("MIN_PER_SIDE is still enforced", MIN_PER_SIDE >= 3);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
