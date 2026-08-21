// Run the confidence engine over the live corpus.
//   node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/run-inference.mjs
//
// Read-only. This prints what the engine currently concludes and, just as
// importantly, what it declines to conclude -- which at this coverage will be
// most of it. A run that reports nothing is a working run, not a broken one.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { HYPOTHESES, activeFamily, isObserved } from "../src/lib/analysis/hypotheses.ts";
import {
  binaryClientEstimate, rankClientEstimate, dersimonianLaird, posterior,
  benjaminiHochberg, permutationP, rng, digestSeed, isMixed, stateFor,
  mean, variance, MIN_CLIENTS, Q_FDR,
} from "../src/lib/analysis/inference.ts";

const env = Object.fromEntries(
  readFileSync("./.env.local", "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(),
                 l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
const PERMUTATIONS = Number(process.env.SIM_PERMUTATIONS ?? 2000);

async function all(table, select, orderBy = "id") {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(select).order(orderBy).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

/* ---- The unit of observation is a scored POST -------------------------- */
/* Not a video. Today they are one-to-one, but EvidenceVideo.bestIndex is a MAX
   across a video's posts, and max-of-k is upward biased by ~0.56 sigma at k=2.
   If cross-posting correlates with the attribute under test -- teams cross-post
   their best-planned videos, which also have the most considered titles -- that
   is a manufactured confound. Built per-post now, before cross-posting starts,
   rather than after. */
const features = new Map(
  (await all("video_features", "*", "content_item_id")).map((f) => [f.content_item_id, f]),
);
const items = new Map(
  (await all("content_items", "id, workspace_id, client_id, review_state, client:clients(is_archived)"))
    .map((i) => [i.id, i]),
);

/* THE SCORE COMES FROM computeRankings, NOT FROM A REIMPLEMENTATION.
   perfIndex is a value relative to a rolling account baseline -- the median of
   the prior <=10 mature values -- evaluated at a fixed maturity window. None of
   that is stored; it is computed. Recomputing it here by hand would produce a
   second, subtly different definition of the number the whole engine is about,
   and the two would drift silently. */
const { computeRankings } = await import("../src/lib/performanceData.ts");
const ws = [...items.values()][0]?.workspace_id;
if (!ws) throw new Error("no content items");
const rankings = await computeRankings(db, ws);

const one = (v) => (Array.isArray(v) ? v[0] : v);
const rows = [];
for (const [contentId, scored] of rankings.scoredByContent) {
  const item = items.get(contentId);
  if (!item || item.review_state !== "approved" || one(item.client)?.is_archived) continue;
  const f = features.get(contentId);
  if (!f) continue;
  /* ONE ROW PER SCORED POST, not per video. Today they are one-to-one, but
     bestIndex is a MAX across a video's posts and max-of-k is upward biased by
     ~0.56 sigma at k=2. If cross-posting correlates with the attribute under
     test -- teams cross-post their best-planned videos, which also carry the
     most considered titles -- that is a manufactured confound. Built per-post
     now, before cross-posting begins, rather than repaired after. */
  for (const s of scored) {
    if (!(s.index > 0)) continue;
    rows.push({
      clientId: item.client_id,
      platform: s.platform ?? "unknown",
      x: Math.log(s.index),
      features: f,
    });
  }
}

console.log(`scored posts        ${rows.length}`);
console.log(`clients             ${new Set(rows.map((r) => r.clientId)).size}`);
console.log(`with a transcript   ${rows.filter((r) => r.features.transcript_present).length}`);

/* ---- sigma, measured rather than assumed -------------------------------- */
/* Every power figure depends on it, and the PRD's simulations originally
   assumed 0.8-1.2. */
const pooledWithin = [];
for (const c of new Set(rows.map((r) => r.clientId))) {
  const xs = rows.filter((r) => r.clientId === c).map((r) => r.x);
  if (xs.length >= 3) pooledWithin.push(variance(xs));
}
const sigma = Math.sqrt(mean(pooledWithin));
console.log(`sigma (SD of ln perfIndex, pooled within client)  ${sigma.toFixed(3)}`);

/* ---- Map the registry onto the feature columns -------------------------- */
const COLUMN = {
  h_title_question: "title_has_question",
  h_title_numeral: "title_has_numeral",
  h_hook_question: "hook_has_question",
  h_hook_greeting: "hook_is_greeting",
  h_hook_numeral: "hook_numeral",
  h_hook_imperative: "hook_imperative_open",
  h_cta_present: "cta_present",
  h_loop_marker: "loop_marker",
  r_length_seconds: "length_seconds",
  r_hook_word_count: "hook_word_count",
  r_title_length: "title_length",
  r_time_to_first_noun: "time_to_first_noun_ms",
  r_words_per_second: "words_per_second",
};

function valueFor(h, f) {
  if (h.requires === "transcript" && !f.transcript_present) return null;
  if (h.id === "h_posted_weekend") {
    return f.posted_weekday === null ? null : f.posted_weekday === 0 || f.posted_weekday === 6;
  }
  if (h.id === "h_posted_before_noon") {
    return f.posted_hour === null ? null : f.posted_hour < 12;
  }
  if (h.id === "h_hook_second_person") {
    return f.hook_second_person_rate === null ? null : Number(f.hook_second_person_rate) > 0;
  }
  const col = COLUMN[h.id];
  if (!col) return null;
  const raw = f[col];
  if (raw === null || raw === undefined) return null;
  return h.kind === "rank" ? Number(raw) : Boolean(raw);
}

/* ---- Run the family ----------------------------------------------------- */
const family = activeFamily({ descriptors: false });
const results = [];

for (const h of family) {
  const obs = rows.map((r) => ({
    clientId: r.clientId,
    platform: r.platform,
    x: r.x,
    value: valueFor(h, r.features),
  }));

  const estimateFor = (input) => {
    const clients = [...new Set(input.map((o) => o.clientId))];
    const est = clients
      .map((c) => (h.kind === "rank" ? rankClientEstimate(input, c) : binaryClientEstimate(input, c)))
      .filter(Boolean);
    return est.length >= MIN_CLIENTS ? { pooled: dersimonianLaird(est), est } : null;
  };

  const first = estimateFor(obs);
  if (!first?.pooled) {
    results.push({ h, ran: false, clients: 0 });
    continue;
  }

  // Seeded from the hypothesis and the data shape, so the same corpus gives
  // the same p forever and the analysis cache is not busted by jitter.
  const seed = digestSeed(`${h.id}|${rows.length}|${first.est.length}`);
  const p = permutationP(obs, (input) => estimateFor(input)?.pooled ?? null, first.pooled.mu,
    { permutations: PERMUTATIONS, seed });

  const posts = first.est.map((e) => posterior(e, first.pooled));
  results.push({
    h, ran: true, p, pooled: first.pooled, posteriors: posts,
    mixed: isMixed(posts, first.pooled.mu), clients: first.est.length,
  });
}

const ran = results.filter((r) => r.ran);
const rejected = benjaminiHochberg(ran.map((r) => r.p), Q_FDR);
ran.forEach((r, i) => { r.significant = rejected[i]; });

console.log(`\nfamily              ${family.length} registered, ${ran.length} ran (>= ${MIN_CLIENTS} clients)`);
console.log(`BH at q=${Q_FDR}       ${ran.filter((r) => r.significant).length} survive\n`);

const pad = (s, n) => String(s).padEnd(n);
console.log(pad("hypothesis", 26) + pad("clients", 8) + pad("pooled", 9) + pad("tau2", 8) + pad("I2", 7) + pad("p", 8) + "verdict");
console.log("-".repeat(84));

for (const r of results.sort((a, b) => (a.ran ? a.p : 9) - (b.ran ? b.p : 9))) {
  if (!r.ran) {
    console.log(pad(r.h.id, 26) + pad("-", 8) + pad("-", 9) + pad("-", 8) + pad("-", 7) + pad("-", 8)
      + `did not run (< ${MIN_CLIENTS} clients had both sides)`);
    continue;
  }
  const mult = Math.exp(r.pooled.mu);
  const verdict = !r.significant ? "not significant"
    : r.mixed ? "MIXED -- clients disagree, no headline"
    : `significant${r.h.isCanary ? "  << CANARY FIRED" : ""}`;
  console.log(
    pad(r.h.id, 26) + pad(r.clients, 8)
    + pad((r.h.kind === "rank" ? r.pooled.mu.toFixed(3) : `${mult.toFixed(2)}x`), 9)
    + pad(r.pooled.tau2.toFixed(3), 8)
    + pad(`${(r.pooled.i2 * 100).toFixed(0)}%`, 7)
    + pad(r.p.toFixed(4), 8) + verdict,
  );
}

/* ---- What a client would actually be shown ------------------------------ */
const actionable = [];
for (const r of ran.filter((x) => x.significant && !x.mixed)) {
  for (const p of r.posteriors) {
    const state = stateFor({ significant: true, mixed: false, p });
    if (state === "acting") actionable.push({ h: r.h, p });
  }
}
console.log(`\nrows a client would see as "worth acting on": ${actionable.length}`);
for (const a of actionable.slice(0, 10)) {
  console.log(`  ${a.h.label}: ${a.p.multiplier.toFixed(2)}x `
    + `(raw ${a.p.rawMultiplier.toFixed(2)}x, shrunk by B=${a.p.b.toFixed(2)}, n=${a.p.n1}/${a.p.n0})`);
}

const fired = ran.filter((r) => r.significant && r.h.isCanary);
if (fired.length) {
  console.log(`\n!! ${fired.length} CANARY HYPOTHES${fired.length > 1 ? "ES" : "IS"} FIRED: `
    + fired.map((r) => r.h.id).join(", "));
  console.log("   These have no plausible mechanism. Distrust this run rather than publishing it.");
} else {
  console.log("\ncanaries: none fired.");
}
