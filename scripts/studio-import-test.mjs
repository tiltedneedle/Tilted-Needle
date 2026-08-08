// Studio-export parser tests. Every expectation hand-computed.
//
// The input here is a file a human exported from a UI that changes between
// versions and locales, so the cases below are deliberately hostile: renamed
// columns, thousands separators, percent signs, a Total row, duration formats,
// and title-only exports. A parser that throws on any of those pushes the work
// back onto the person least able to fix it.
//
//   node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/studio-import-test.mjs
import {
  parseCsv, toNumber, toFraction, toSeconds, mapColumns, parseStudioExport,
} from "../src/lib/studioImport.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

/* ---- CSV ---------------------------------------------------------------- */
{
  const t = parseCsv('a,b\n1,2\n');
  check("plain rows parse", JSON.stringify(t) === '[["a","b"],["1","2"]]');

  const q = parseCsv('title,views\n"Hello, world",100\n');
  check("a comma inside quotes stays in the field", q[1][0] === "Hello, world" && q[1][1] === "100");

  const e = parseCsv('t\n"She said ""hi"""\n');
  check("escaped quotes unescape", e[1][0] === 'She said "hi"');

  check("CRLF is handled", parseCsv("a,b\r\n1,2\r\n")[1][1] === "2");
  check("a BOM does not poison the first header", parseCsv("﻿Video,Views\n")[0][0] === "Video");
  check("blank lines are dropped", parseCsv("a\n\n\nb\n").length === 2);
}

/* ---- Coercion ----------------------------------------------------------- */
{
  check("thousands separators parse", toNumber("1,234,567") === 1234567);
  check("an empty cell is null, not zero", toNumber("") === null && toNumber("-") === null);
  check("garbage is null, never NaN", toNumber("n/a") === null);

  check("a percentage becomes a fraction", toFraction("4.85") === 0.0485);
  check("a percent sign is tolerated", toFraction("4.85%") === 0.0485);
  // Guards a misread column: a "percentage" of 4,000 means we grabbed views.
  check("an impossible percentage is refused", toFraction("4000") === null);

  check("mm:ss parses", toSeconds("0:35") === 35);
  check("h:mm:ss parses", toSeconds("1:23:45") === 5025);
  check("bare seconds parse", toSeconds("42") === 42);
  check("a malformed duration is null", toSeconds("later") === null);
}

/* ---- Column mapping ----------------------------------------------------- */
{
  const cols = mapColumns([
    "Video", "Video title", "Views", "Impressions",
    "Impressions click-through rate (%)", "Average view duration",
    "Average percentage viewed (%)",
  ]);
  check("the id column is found", cols.videoId === 0);
  check("CTR is found under its long Studio name", cols.ctr === 4);
  check("average percentage viewed is found", cols.avgViewedPct === 6);

  // The trap: "Views" must not capture "Average percentage viewed", and
  // "Average view duration" must not capture the percentage column.
  check("'Views' does not steal the percentage-viewed column",
    cols.views === 2 && cols.avgViewedPct === 6);
  check("duration and percentage stay distinct",
    cols.avgViewSeconds === 5 && cols.avgViewedPct === 6);
}

/* ---- A realistic export ------------------------------------------------- */
{
  const csv = [
    'Video,Video title,Views,Impressions,Impressions click-through rate (%),Average view duration,Average percentage viewed (%)',
    'Total,,"12,345","98,765",4.85,0:41,38.20',
    'OcT01xFp8wM,"Driving the Pagani, briefly","4,010","30,000",5.10,1:02,44.50',
    'dQw4w9WgXcQ,Another video,"8,335","68,765",4.20,0:31,33.10',
  ].join("\n");

  const r = parseStudioExport(csv);
  check("the Total row is excluded from rows", r.rows.length === 2, `got ${r.rows.length}`);
  check("but the Total row is still reported", r.totalRow?.views === 12345);

  const first = r.rows[0];
  check("the video id is captured", first.videoId === "OcT01xFp8wM");
  check("a quoted title with a comma survives", first.title === "Driving the Pagani, briefly");
  check("views parse past the separator", first.views === 4010);
  check("impressions parse", first.impressions === 30000);
  check("CTR becomes a fraction", first.ctr === 0.051);
  check("average view duration becomes seconds", first.avgViewSeconds === 62);
  check("average percentage viewed becomes a fraction", first.avgViewedPct === 0.445);
  check("no problems on a clean export", r.problems.length === 0, r.problems.join("; "));
}

/* ---- Hostile inputs ----------------------------------------------------- */
{
  const empty = parseStudioExport("");
  check("an empty file reports a problem rather than throwing",
    empty.rows.length === 0 && empty.problems.length === 1);

  const wrong = parseStudioExport("Date,Views\n2026-08-01,100\n");
  check("an export with no video dimension is refused with guidance",
    wrong.rows.length === 0 && wrong.problems[0].includes("Advanced mode"));

  // Public-only columns: importing would add nothing over the sync.
  const publicOnly = parseStudioExport("Video,Views\nOcT01xFp8wM,100\n");
  check("an export with no owner-only columns says so",
    publicOnly.problems.some((p) => p.includes("owner-only")));

  // Title-only export: rows cannot be matched to posts.
  const titles = parseStudioExport(
    "Video title,Views,Impressions,Impressions click-through rate (%)\nSome video,100,900,4.1\n",
  );
  check("a title-only export explains why it cannot be matched",
    titles.rows.length === 0 && titles.problems.some((p) => p.includes("video id")));

  // A row missing optional cells must still import what it has.
  const partial = parseStudioExport(
    "Video,Views,Impressions,Impressions click-through rate (%)\nOcT01xFp8wM,100,,\n",
  );
  check("missing optional cells become null, not zero",
    partial.rows[0]?.views === 100 && partial.rows[0]?.impressions === null &&
    partial.rows[0]?.ctr === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
