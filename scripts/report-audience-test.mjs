// What the audience section claims, and the counting it refuses to fudge.
//   node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/report-audience-test.mjs
import { buildAudience, audienceLead, MIN_PERIOD_THEMED } from "../src/lib/reportAudience.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

const period = { start: "2026-08-01", end: "2026-08-31" };
const periodLabel = "August 2026";
const ids = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
// Twelve comments in August, three in July.
const comments = [
  ...ids("a", 12).map((id) => ({ id, publishedAt: "2026-08-10T00:00:00Z" })),
  ...ids("j", 3).map((id) => ({ id, publishedAt: "2026-07-10T00:00:00Z" })),
];

/* ---- Period scoping and the distinct denominator ------------------------ */
{
  const themes = [
    { label: "Pricing", sentiment: "neutral", commentIds: [...ids("a", 8), "j0"], postCount: 4 },
    { label: "Praise", sentiment: "positive", commentIds: ["a0", "a1", "a9", "a10", "j1"], postCount: 3 },
    { label: "Old only", sentiment: "negative", commentIds: ["j2"], postCount: 1 },
  ];
  const a = buildAudience({ themes, comments, signals: null, period, periodLabel });
  check("themes are re-counted over the period's comments", a.themes.map((t) => `${t.label}:${t.comments}`).join(",") === "Pricing:8,Praise:4", a.themes.map((t) => `${t.label}:${t.comments}`).join(","));
  check("a theme with no comments in the period is dropped", !a.themes.some((t) => t.label === "Old only"));
  // a0 and a1 carry both themes: 8 + 4 = 12 counted, 10 distinct.
  check("the denominator is DISTINCT comments, not the sum of theme counts", a.distinctComments === 10, String(a.distinctComments));
  check("scope is the period", a.scope === "period" && /August 2026/.test(a.scopeNote));
  check("sentiment buckets are distinct within themselves", a.sentiment.neutral === 8 && a.sentiment.positive === 4 && a.sentiment.negative === 0, JSON.stringify(a.sentiment));
}

/* ---- A thin month falls back, and says so -------------------------------- */
{
  const themes = [{ label: "Pricing", sentiment: "neutral", commentIds: ["a0", "a1", ...ids("j", 3), ...ids("z", 20)], postCount: 5 }];
  const a = buildAudience({ themes, comments, signals: null, period, periodLabel });
  check(`under ${MIN_PERIOD_THEMED} themed comments in the period falls back to all time`, a.scope === "all" && /since tracking began/.test(a.scopeNote), a.scopeNote);
  check("and the all-time count is then what is shown", a.themes[0].comments === 25);
}

/* ---- Nothing to say means no section ----------------------------------- */
{
  check("no themes and no signals yields null, never an empty page",
    buildAudience({ themes: [], comments: [], signals: null, period, periodLabel }) === null);
  check("zero analysed comments counts as no signals",
    buildAudience({ themes: [], comments: [], signals: { analysed: 0, questions: 0, intent: 0, confusion: 0, mentions: 0 }, period, periodLabel }) === null);
}

/* ---- The lead sentence ------------------------------------------------------ */
{
  const themes = [{ label: "Affordability", sentiment: "negative", commentIds: ids("a", 12), postCount: 5 }];
  const withSignals = buildAudience({ themes, comments, signals: { analysed: 213, questions: 29, intent: 8, confusion: 2, mentions: 0 }, period, periodLabel });
  check("signals lead when present", /213 analysed comments/.test(audienceLead(withSignals)) && /29 questions/.test(audienceLead(withSignals)) && /8 signals of intent/.test(audienceLead(withSignals)), audienceLead(withSignals));
  const noSignals = buildAudience({ themes, comments, signals: null, period, periodLabel });
  check("the top theme leads otherwise, with the honest denominator", /"Affordability".*12 of 12 themed/.test(audienceLead(noSignals)), audienceLead(noSignals));
  const one = buildAudience({ themes, comments, signals: { analysed: 5, questions: 1, intent: 0, confusion: 0, mentions: 0 }, period, periodLabel });
  check("singular where it should be singular", /1 question\b/.test(audienceLead(one)) && !/questions/.test(audienceLead(one)), audienceLead(one));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
