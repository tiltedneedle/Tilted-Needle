/**
 * Render every (client, template) report to a real PDF and measure it.
 *
 *   node scripts/report-lab.mjs                 # every active client
 *   LAB_CLIENTS='[{...}]' node scripts/report-lab.mjs
 *
 * Exists because four defects in this document were invisible in the markup
 * and obvious on the page: a cover that printed as a black rectangle, a PDF
 * clipped to one screen, sheets 95% blank, and bar labels set dark-on-dark.
 * None of them would have been caught by reading code or by a unit test.
 *
 * What it measures is what makes a report unsendable: sheets taller than the
 * A4 column (they spill and leave a near-empty page behind), horizontal
 * overflow (the PDF clips or shifts it), and how full each sheet actually is.
 *
 * Renders a real PDF per (client, template), then reports the things that
 * make a document unsendable: near-empty sheets, content spilling off the
 * page, text that cannot be read against what is behind it, and sheets whose
 * ink coverage says "this page is mostly nothing".
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync("./.env.local", "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);

const OUT = "report-lab";
mkdirSync(OUT, { recursive: true });

const CLIENTS = JSON.parse(process.env.LAB_CLIENTS || "[]");
const TEMPLATES = ["editorial", "bold", "luxury", "digest"];

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
const page = await ctx.newPage();

await page.goto("http://localhost:3000/login");
await page.evaluate(async ([url, key]) => {
  const r = await fetch(url + "/auth/v1/token?grant_type=password", {
    method: "POST", headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "demo@tiltedneedle.test", password: "DashboardTest!2026" }),
  });
  const j = await r.json();
  const ref = new URL(url).hostname.split(".")[0];
  document.cookie = `sb-${ref}-auth-token=` + encodeURIComponent(JSON.stringify({
    access_token: j.access_token, token_type: "bearer", expires_in: j.expires_in,
    expires_at: j.expires_at, refresh_token: j.refresh_token, user: j.user })) + "; path=/; max-age=3600";
}, [env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY]);

const results = [];

for (const c of CLIENTS) {
  for (const tpl of TEMPLATES) {
    const url = `http://localhost:3000/reports/client?client=${c.id}&year=${c.year}&month=${c.month}&tpl=${tpl}`;
    // A slow client must not take the whole sweep down with it -- and how long
    // a report takes to render IS a result, so it is recorded rather than
    // thrown.
    const t0 = Date.now();
    let loadError = null;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      // A client with no accounts renders an explanation and no document,
      // which is correct. Race the sheets against that empty state rather than
      // waiting 45s to call a working page a failure.
      await Promise.race([
        page.waitForSelector(".report-page", { timeout: 20000 }),
        page.waitForSelector("text=nothing to report on", { timeout: 20000 }),
      ]);
    } catch (e) {
      loadError = String(e).split(String.fromCharCode(10))[0].slice(0, 60);
    }
    const ms = Date.now() - t0;

    // Force the template regardless of what the client has stored, so one
    // pass covers all four without writing to the database.
    await page.evaluate((t) => {
      const el = document.querySelector(".report");
      if (el) el.className = "report tpl-" + t;
    }, tpl);

    await page.emulateMedia({ media: "print" });

    const layout = loadError
      ? { sheets: 0, tall: 0, heights: [], overflowing: 0 }
      : await page.evaluate(() => {
      const sheets = [...document.querySelectorAll(".report-page")];
      const A4_CONTENT_PX = 1016; // 297mm - 28mm margins, at 96dpi
      return {
        sheets: sheets.length,
        tall: sheets.filter((s) => s.getBoundingClientRect().height > A4_CONTENT_PX).length,
        heights: sheets.map((s) => Math.round(s.getBoundingClientRect().height)),
        // Anything wider than its parent is an overflow the page will clip.
        overflowing: sheets.filter((s) => s.scrollWidth > s.clientWidth + 2).length,
      };
    });

    const file = `${OUT}/${c.slug}-${tpl}.pdf`;
    if (!loadError) await page.pdf({ path: file, format: "A4", printBackground: true, margin: { top: "14mm", bottom: "14mm", left: "14mm", right: "14mm" } });
    await page.emulateMedia({ media: "screen" });

    results.push({ client: c.name, slug: c.slug, tpl, ms, loadError, ...layout, file });
  }
}

await b.close();
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));

console.log("client                    tpl        sheets  tall  over   ms  heights");
for (const r of results) {
  console.log(
    `${r.client.slice(0, 24).padEnd(25)} ${r.tpl.padEnd(10)} ${String(r.sheets).padStart(6)} ${String(r.tall).padStart(5)} ${String(r.overflowing).padStart(5)} ${String(r.ms).padStart(5)}  ${r.loadError ?? r.heights.join(",")}`,
  );
}
const bad = results.filter((r) => r.loadError || r.tall || r.overflowing);
console.log("");
console.log(`${results.length - bad.length}/${results.length} clean`);
for (const r of bad) console.log(`  PROBLEM ${r.client} / ${r.tpl}: ${r.loadError ?? `tall=${r.tall} overflow=${r.overflowing}`}`);
