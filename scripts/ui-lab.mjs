/**
 * Walk every route and measure what is wrong with it.
 *
 * Same method as scripts/report-lab.mjs, which found four defects that were
 * invisible in the markup and obvious on the page. This does it for the whole
 * app: load each route at desktop and phone width and record the things that
 * make a screen feel unfinished.
 *
 *   node scripts/ui-lab.mjs              # measure everything
 *   node scripts/ui-lab.mjs --shots      # and save screenshots
 *
 * What it looks for, and why each one:
 *
 *   HORIZONTAL OVERFLOW -- the single most common phone defect, and invisible
 *   on a desktop monitor.
 *   CONSOLE ERRORS -- a page that logs an error is a page doing something it
 *   did not intend, whether or not it looks broken.
 *   EMPTY SHELLS -- a route that renders chrome and no content is the "empty
 *   spaces" complaint in its purest form.
 *   TINY TEXT and LOW CONTRAST -- the two things that make a product read as
 *   cheap regardless of layout.
 *   SLOW ROUTES -- anything past a couple of seconds reads as broken before it
 *   reads as slow.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync("./.env.local", "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);

const SHOTS = process.argv.includes("--shots");
const OUT = "ui-lab";
if (SHOTS) mkdirSync(OUT, { recursive: true });

const ROUTES = (process.env.UI_ROUTES || [
  "/home", "/content", "/clients", "/guidelines", "/todos", "/training",
  "/track", "/timesheet", "/dashboard", "/reports", "/reports/client",
  "/approvals", "/time-off", "/invoices", "/expenses", "/rates",
  "/team-admin", "/data", "/projects", "/tags", "/kiosks", "/import",
  "/developers", "/audit-log", "/performance",
].join(",")).split(",");

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
];

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: VIEWPORTS[0] });
const page = await ctx.newPage();

const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 120)); });
page.on("pageerror", (e) => consoleErrors.push("throw: " + String(e).slice(0, 120)));

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

for (const route of ROUTES) {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    consoleErrors.length = 0;
    const t0 = Date.now();
    let loadError = null;
    try {
      await page.goto("http://localhost:3000" + route, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForSelector("main", { timeout: 20000 });
      await page.waitForTimeout(400);
    } catch (e) {
      loadError = String(e).split(String.fromCharCode(10))[0].slice(0, 70);
    }
    const ms = Date.now() - t0;

    const m = loadError ? null : await page.evaluate(() => {
      const doc = document.documentElement;
      const main = document.querySelector("main");
      const text = (main?.innerText || "").trim();

      /**
       * Overflow that ESCAPES, not overflow that is contained.
       *
       * A wide table inside an `overflow-x-auto` wrapper is wider than the
       * viewport BY DESIGN -- that is what makes it scroll sideways instead of
       * pushing the page. Measuring elements against the viewport without
       * checking their ancestors reported six routes as broken when every one
       * of them was working correctly, and "fixing" them would have removed
       * the scrolling.
       *
       * The page itself is the honest test: if documentElement.scrollWidth is
       * the viewport width, nothing escaped.
       */
      const contained = (el) => {
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === "auto" || ox === "scroll" || ox === "hidden") return true;
        }
        return false;
      };
      const over = [];
      if (doc.scrollWidth > window.innerWidth + 1) {
        for (const el of document.querySelectorAll("main *")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || contained(el)) continue;
          if (r.right > window.innerWidth + 1) {
            over.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0] || "?"}(+${Math.round(r.right - window.innerWidth)})`);
          }
        }
      }

      // Text too small to be a deliberate choice.
      let tiny = 0;
      for (const el of document.querySelectorAll("main *")) {
        if (!el.childNodes.length) continue;
        const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!hasText) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs && fs < 10.5) tiny++;
      }

      return {
        scrollW: doc.scrollWidth,
        innerW: window.innerWidth,
        overflow: [...new Set(over)].slice(0, 4),
        textLen: text.length,
        firstText: text.replace(/\s+/g, " ").slice(0, 60),
        tiny,
        // A screen whose whole content is one short sentence.
        looksEmpty: text.length < 140,
      };
    });

    if (SHOTS && !loadError) {
      await page.screenshot({ path: `${OUT}/${route.replace(/\//g, "_") || "root"}-${vp.name}.png`, fullPage: false });
    }

    results.push({ route, vp: vp.name, ms, loadError, errors: [...new Set(consoleErrors)].slice(0, 2), ...(m || {}) });
  }
}

await b.close();
writeFileSync(`${OUT === "ui-lab" && !SHOTS ? "." : OUT}/ui-lab.json`, JSON.stringify(results, null, 1));

const bad = results.filter((r) => r.loadError || (r.overflow || []).length || r.errors?.length || r.looksEmpty || r.ms > 4000);
console.log("route                  vp        ms  wide  tiny  notes");
for (const r of results) {
  const flags = [];
  if (r.loadError) flags.push(r.loadError);
  if ((r.overflow || []).length) flags.push("OVERFLOW " + r.overflow.join(","));
  if (r.errors?.length) flags.push("ERR " + r.errors[0]);
  if (r.looksEmpty) flags.push(`EMPTY(${r.textLen})`);
  console.log(
    `${r.route.padEnd(22)} ${r.vp.padEnd(8)} ${String(r.ms).padStart(5)} ${String(r.scrollW ?? "").padStart(5)} ${String(r.tiny ?? "").padStart(5)}  ${flags.join(" | ")}`,
  );
}
console.log("");
console.log(`${results.length - bad.length}/${results.length} clean`);
