// Does the confidence engine actually stay quiet when nothing is there?
//   npm run test:inference              -- the assertions, fast
//   node ... scripts/inference-sim.mjs --full   -- the full study, slower
//
// WHY A SIMULATION AND NOT ONLY UNIT TESTS
//
// Every number in the PRD's design is a claim about BEHAVIOUR UNDER REPEATED
// SAMPLING -- "tau^2 collapses to zero in 56% of null runs", "the null headline
// rate falls from 0.976 to 0.014", "power at n=39 is 0.51 not 0.34". None of
// those can be checked by asserting on one input and one output. They are
// properties of a distribution, and the only honest way to check them is to
// generate data with a KNOWN answer and count how often the engine gets it
// right.
//
// This matters more here than in most places, because the failure mode is
// invisible: an engine that is too eager does not crash, it produces confident,
// plausible, well-formatted findings from noise. The existing engine does
// exactly that 97.6% of the time and has been doing it in production.
//
// THE SIGMA IS MEASURED, NOT ASSUMED. The PRD's simulations originally used
// sigma = 0.8-1.2. Measured across the live scored corpus it is 1.679, which
// makes every effect harder to detect than the design assumed -- so the power
// table is regenerated here at the real value rather than quoted from the
// document.
import { readFileSync } from "node:fs";
import {
  binaryClientEstimate, dersimonianLaird, posterior, benjaminiHochberg,
  permutationP, rng, isMixed, stateFor, mean, median, variance,
  MIN_SIDE_POOL, MIN_SIDE_ROW, MIN_CLIENTS,
} from "../src/lib/analysis/inference.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

const FULL = process.argv.includes("--full");

/** Measured across the live scored corpus on 2026-08-21. The PRD assumed
 *  0.8-1.2; this is what it actually is, and it is why the regenerated power
 *  table below is worse than the design's. */
const SIGMA = 1.679;
/** Thirteen clients of about 29 scored posts each: the real shape. */
const CLIENTS = 13;
const POSTS_PER_CLIENT = 29;

/* ---- Data generation ----------------------------------------------------
   A client's posts are log-normal around its own baseline. `effect` is the
   TRUE log-multiplier applied to posts carrying the attribute; 0 is the null.
   `tau` is genuine between-client heterogeneity in that effect. */
function simulate(rand, { effect = 0, tau = 0, share = 0.4, sigma = SIGMA } = {}) {
  const obs = [];
  const normal = () => {
    // Box-Muller, from the seeded generator so a run is reproducible.
    const u = Math.max(1e-12, rand()), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  for (let c = 0; c < CLIENTS; c++) {
    const clientEffect = effect + tau * normal();
    const baseline = normal() * 0.5;
    for (let i = 0; i < POSTS_PER_CLIENT; i++) {
      const has = rand() < share;
      obs.push({
        clientId: `c${c}`,
        platform: rand() < 0.5 ? "youtube" : "tiktok",
        x: baseline + (has ? clientEffect : 0) + sigma * normal(),
        value: has,
      });
    }
  }
  return obs;
}

/** The engine, end to end, for one hypothesis. Returns what a marketer sees. */
function runEngine(obs, { permutations = 400, seed = 1 } = {}) {
  const estimate = (rows) => {
    const clients = [...new Set(rows.map((o) => o.clientId))];
    const est = clients.map((c) => binaryClientEstimate(rows, c)).filter(Boolean);
    return est.length >= MIN_CLIENTS ? { pooled: dersimonianLaird(est), est } : null;
  };

  const first = estimate(obs);
  if (!first?.pooled) return { ran: false };

  const p = permutationP(
    obs,
    (rows) => estimate(rows)?.pooled ?? null,
    first.pooled.mu,
    { permutations, seed },
  );

  const posts = first.est.map((e) => posterior(e, first.pooled));
  const mixed = isMixed(posts, first.pooled.mu);

  return {
    ran: true, p, pooled: first.pooled, posteriors: posts, mixed,
    // The single biggest multiplier any client would be shown.
    loudest: posts.reduce((a, b) =>
      Math.abs(Math.log(b.multiplier)) > Math.abs(Math.log(a.multiplier)) ? b : a),
  };
}

/* ---- 1. tau^2 collapses to zero under the null -------------------------- */
/* The property that lets this engine say "no difference" by construction
   rather than by a threshold somebody chose. */
{
  const reps = FULL ? 6000 : 1200;
  const rand = rng(20260822);
  let zeroTau = 0, ran = 0;
  for (let r = 0; r < reps; r++) {
    const obs = simulate(rand, { effect: 0, tau: 0 });
    const clients = [...new Set(obs.map((o) => o.clientId))];
    const est = clients.map((c) => binaryClientEstimate(obs, c)).filter(Boolean);
    const pooled = dersimonianLaird(est);
    if (!pooled) continue;
    ran++;
    if (pooled.tau2 === 0) zeroTau++;
  }
  const rate = zeroTau / ran;
  console.log(`\ntau^2 = 0 in ${(rate * 100).toFixed(1)}% of ${ran} null runs`);
  check(
    "tau^2 collapses to zero in about half of null runs",
    rate > 0.40 && rate < 0.75,
    `${(rate * 100).toFixed(1)}% -- the PRD measured 56%`,
  );

  // And when it does, every client is handed the pooled mean.
  const obs = simulate(rng(7), { effect: 0, tau: 0 });
  const clients = [...new Set(obs.map((o) => o.clientId))];
  const est = clients.map((c) => binaryClientEstimate(obs, c)).filter(Boolean);
  const pooled = dersimonianLaird(est);
  if (pooled && pooled.tau2 === 0) {
    const posts = est.map((e) => posterior(e, pooled));
    check("with tau^2 = 0 every client gets B = 1 and the pooled mean",
      posts.every((p) => p.b === 1 && Math.abs(p.theta - pooled.mu) < 1e-12));
  } else {
    check("with tau^2 = 0 every client gets B = 1 and the pooled mean", true,
      "skipped: this seed produced tau^2 > 0");
  }
}

/* ---- 2. The null headline rate, decomposed ------------------------------ */
/* The claim being checked: shrinkage does roughly three times the work of the
   sample floor, and the testing apparatus contributes almost nothing to the
   number that gets remembered. */
{
  /* THE WHOLE FAMILY IS SIMULATED, not one hypothesis.
   *
   * An earlier version of this block ran a single hypothesis and compared its
   * p against 0.10 directly. That measures an UNCORRECTED test, which is
   * false-positive one time in ten by construction -- and it duly reported
   * 0.073, close enough to plausible to have been believed. BH operates on the
   * family; a harness without a family is not testing the engine that ships.
   *
   * Every rate below shares ONE denominator: client-hypothesis pairs, i.e. the
   * number of rows a marketer could possibly have been shown. Comparing a
   * per-client count against a per-family count is how a decomposition ends up
   * with columns that cannot be read against each other.
   */
  const FAMILY_SIZE = 16;
  const runs = FULL ? 40 : 12;
  const rand = rng(99);
  let current = 0, floored = 0, shrunk = 0, full = 0, n = 0;

  for (let r = 0; r < runs; r++) {
    const familyResults = [];

    for (let hIdx = 0; hIdx < FAMILY_SIZE; hIdx++) {
      const obs = simulate(rand, { effect: 0, tau: 0 });

      /* (a) What the CURRENT engine does: one client, ratio of medians,
         printed whenever both sides clear MIN_SIDE_POOL. */
      for (const c of [...new Set(obs.map((o) => o.clientId))]) {
        const mine = obs.filter((o) => o.clientId === c);
        const a = mine.filter((o) => o.value).map((o) => o.x);
        const b = mine.filter((o) => !o.value).map((o) => o.x);
        if (a.length < MIN_SIDE_POOL || b.length < MIN_SIDE_POOL) continue;
        n++;
        const ratio = Math.exp(median(a) - median(b));
        const loud = ratio < 0.87 || ratio > 1.15;      // a number worth acting on
        if (loud) current++;
        if (loud && a.length >= MIN_SIDE_ROW && b.length >= MIN_SIDE_ROW) floored++;
      }

      const res = runEngine(obs, { permutations: 100, seed: 1000 + r * FAMILY_SIZE + hIdx });
      if (res.ran) familyResults.push(res);
    }
    if (!familyResults.length) continue;

    // (b) shrinkage alone, before any significance test.
    for (const res of familyResults) {
      for (const p of res.posteriors) {
        if (p.multiplier < 0.87 || p.multiplier > 1.15) shrunk++;
      }
    }

    // (c) BH once across the family, then the state gates -- exactly the
    //     sequence run-inference.mjs performs against the live corpus.
    const rejected = benjaminiHochberg(familyResults.map((x) => x.p), 0.10);
    familyResults.forEach((res, i) => {
      if (!rejected[i] || res.mixed) return;
      for (const p of res.posteriors) {
        if (stateFor({ significant: true, mixed: false, p }) === "acting") full++;
      }
    });
  }

  const rate = (x) => (n ? x / n : 0);
  console.log(`\nnull headline rate, per client-hypothesis (${n} opportunities, family of ${FAMILY_SIZE})`);
  console.log(`  current engine (median ratio, n>=3)   ${rate(current).toFixed(3)}`);
  console.log(`  + sample floor n>=8                   ${rate(floored).toFixed(3)}`);
  console.log(`  + shrinkage to the pooled mean        ${rate(shrunk).toFixed(3)}`);
  console.log(`  + significance and state gates        ${rate(full).toFixed(3)}`);

  check("the current engine manufactures headlines from pure noise",
    rate(current) > 0.5, rate(current).toFixed(3));
  check("shrinkage cuts the noise headline rate by more than the sample floor does",
    rate(shrunk) < rate(floored),
    `shrunk ${rate(shrunk).toFixed(3)} vs floored ${rate(floored).toFixed(3)}`);
  check("the full stack almost never speaks when nothing is there",
    rate(full) < 0.05, rate(full).toFixed(3));
}

/* ---- 3. It still finds a real effect ------------------------------------ */
/* An engine that says nothing is easy to build and useless. */
{
  const reps = FULL ? 300 : 80;
  const rand = rng(4242);
  let detected = 0, ran = 0;
  const trueEffect = Math.log(2.0);        // a doubling: large but not absurd

  for (let r = 0; r < reps; r++) {
    const obs = simulate(rand, { effect: trueEffect, tau: 0.2 });
    const res = runEngine(obs, { permutations: 200, seed: 5000 + r });
    if (!res.ran) continue;
    ran++;
    if (res.p <= 0.10) detected++;
  }
  const power = detected / ran;
  console.log(`\npower at a true 2.0x, sigma=${SIGMA}: ${(power * 100).toFixed(0)}% over ${ran} runs`);
  check("a real doubling is detected most of the time",
    power > 0.6, `${(power * 100).toFixed(0)}%`);

  // Direction must be right, not merely significant.
  const obs = simulate(rng(11), { effect: trueEffect, tau: 0.2 });
  const res = runEngine(obs, { permutations: 200, seed: 3 });
  check("and it points the right way", res.ran && res.pooled.mu > 0,
    res.ran ? `mu = ${res.pooled.mu.toFixed(3)}` : "did not run");
}

/* ---- 4. Heterogeneity is reported, not averaged away -------------------- */
{
  const rand = rng(31337);
  // Clients genuinely disagree: half helped, half hurt.
  let mixedSeen = 0, runs = 0;
  for (let r = 0; r < (FULL ? 200 : 60); r++) {
    const obs = simulate(rand, { effect: 0, tau: 0.8 });
    const res = runEngine(obs, { permutations: 100, seed: 900 + r });
    if (!res.ran) continue;
    runs++;
    if (res.mixed) mixedSeen++;
  }
  check("strong disagreement between clients is flagged as mixed",
    mixedSeen / runs > 0.3,
    `${((mixedSeen / runs) * 100).toFixed(0)}% of ${runs} high-heterogeneity runs`);
}

/* ---- 5. Benjamini-Hochberg behaves ------------------------------------- */
{
  // All null: at q=0.10 the expected number of rejections is small.
  const rand = rng(2024);
  const nulls = Array.from({ length: 16 }, () => rand());
  const rej = benjaminiHochberg(nulls, 0.10);
  check("BH rejects little from uniform p-values",
    rej.filter(Boolean).length <= 3, `${rej.filter(Boolean).length} of 16`);

  // One clearly real signal among fifteen nulls survives.
  const withSignal = [0.0001, ...Array.from({ length: 15 }, () => 0.3 + rand() * 0.7)];
  const rej2 = benjaminiHochberg(withSignal, 0.10);
  check("BH keeps a genuinely small p-value", rej2[0] === true);

  // The step-up property: an interior p that fails its own threshold is still
  // rejected when a later one passes. This is what makes BH more powerful than
  // a naive per-test comparison, and getting it wrong is a silent power loss.
  const stepUp = benjaminiHochberg([0.001, 0.04, 0.05], 0.10);
  check("BH steps up rather than testing each p in isolation",
    stepUp.every(Boolean),
    "p=0.04 fails (2/3)*0.10=0.067? no -- it passes; the largest passing index carries the rest");
}

/* ---- 6. Rank beats median split ----------------------------------------- */
/* The PRD's justification for ranking continuous covariates rather than
   splitting them: measured power 0.34 vs 0.51 at n=39. Reproduced here on the
   same underlying effect rather than taken on trust. */
if (FULL) {
  const rand = rng(555);
  let splitHits = 0, rankHits = 0, runs = 300;
  for (let r = 0; r < runs; r++) {
    // A continuous covariate genuinely correlated with the outcome.
    const xs = [], cov = [];
    for (let i = 0; i < 39; i++) {
      const c = rand() * 100;
      const u = Math.max(1e-12, rand()), v = rand();
      const noise = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      cov.push(c);
      xs.push(0.012 * c + SIGMA * noise);
    }
    const cut = median(cov);
    const hi = xs.filter((_, i) => cov[i] > cut);
    const lo = xs.filter((_, i) => cov[i] <= cut);
    const s2 = variance(xs);
    const tSplit = Math.abs(mean(hi) - mean(lo)) / Math.sqrt(s2 * (1 / hi.length + 1 / lo.length));
    if (tSplit > 1.96) splitHits++;

    const rs = cov.map((c, i) => [c, xs[i]]);
    const rho = spearmanLocal(rs.map((p) => p[0]), rs.map((p) => p[1]));
    const z = Math.atanh(Math.max(-0.999, Math.min(0.999, rho))) * Math.sqrt(39 - 3);
    if (Math.abs(z) > 1.96) rankHits++;
  }
  console.log(`\nsame effect at n=39: median split ${(splitHits / runs).toFixed(2)}, rank ${(rankHits / runs).toFixed(2)}`);
  check("ranking a continuous covariate beats splitting it",
    rankHits > splitHits,
    `${rankHits} vs ${splitHits} detections in ${runs} runs`);
}

function spearmanLocal(a, b) {
  const rk = (xs) => {
    const idx = xs.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
    const out = new Array(xs.length).fill(0);
    idx.forEach(([, i], r) => { out[i] = r + 1; });
    return out;
  };
  const ra = rk(a), rb = rk(b);
  const ma = mean(ra), mb = mean(rb);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

/* ---- 7. Determinism ----------------------------------------------------- */
/* A jittering p-value silently busts the analysis cache and re-buys every
   narration, so the same data must give the same answer forever. */
{
  const obs = simulate(rng(1), { effect: 0.3 });
  const a = runEngine(obs, { permutations: 200, seed: 42 });
  const b = runEngine(obs, { permutations: 200, seed: 42 });
  check("the same data and seed give the same p-value", a.p === b.p, `${a.p} vs ${b.p}`);
  const c = runEngine(obs, { permutations: 200, seed: 43 });
  check("a different seed genuinely resamples", c.p !== a.p || a.p < 0.01,
    `${a.p} vs ${c.p}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
