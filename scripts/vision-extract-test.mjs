// Vision-extraction tests.
//
// The behaviour under test is what happens when a model reads a screenshot
// badly, because it will. OCR misreads 1.2k as 12k, drops decimal points, and
// confuses reach with impressions — and unlike a CSV there is no header row to
// check the mapping against. Nothing here writes anything; every value is a
// draft for a human holding the image to confirm.
//
//   node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/vision-extract-test.mjs
import {
  parseMetricText, parsePercentText, parseDurationText,
  toExtractedValues, ownerOnlyCount, OWNER_ONLY,
} from "../src/lib/analysis/visionExtract.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

/* ---- Suffix expansion is ours, not the model's -------------------------- */
{
  check("a plain number parses", parseMetricText("1234") === 1234);
  check("thousands separators parse", parseMetricText("1,234,567") === 1234567);

  // The error this exists to prevent: a model asked to expand "1.2k" itself
  // will sometimes answer 12000.
  check("1.2k expands to 1200, not 12000", parseMetricText("1.2k") === 1200);
  check("case does not matter", parseMetricText("3.4M") === 3400000);
  check("a space before the suffix is tolerated", parseMetricText("12 k") === 12000);
  check("a suffixed figure is rounded, since the platform already rounded it",
    parseMetricText("1.2345k") === 1235, String(parseMetricText("1.2345k")));
  check("an unsuffixed decimal keeps its precision", parseMetricText("4.85") === 4.85);

  check("prose is not a number", parseMetricText("about a thousand") === null);
  check("an empty string is not zero", parseMetricText("") === null);
  check("a stray dash is not a number", parseMetricText("—") === null);
}

/* ---- Percentages --------------------------------------------------------- */
{
  check("a percentage becomes a fraction", parsePercentText("4.85%") === 0.0485);
  check("the sign is optional", parsePercentText("4.85") === 0.0485);
  // Guards the classic misread: grabbing the views figure as a percentage.
  check("an impossible percentage is refused", parsePercentText("4000") === null);
  check("a negative percentage is refused", parsePercentText("-5") === null);
}

/* ---- Durations ----------------------------------------------------------- */
{
  check("mm:ss parses", parseDurationText("0:35") === 35);
  check("h:mm:ss parses", parseDurationText("1:23:45") === 5025);
  check("bare seconds parse", parseDurationText("42") === 42);
  check("a malformed duration is null", parseDurationText("a while") === null);
}

/* ---- Drafts flag rather than drop --------------------------------------- */
{
  const values = toExtractedValues([
    { name: "reach", rawText: "12.4k", confidence: "high" },
    { name: "likes", rawText: "1,203", confidence: "high" },
    { name: "saves", rawText: "blurry", confidence: "low" },
    { name: "impressions", rawText: "8,900", confidence: "low" },
  ]);

  const byName = Object.fromEntries(values.map((v) => [v.name, v]));

  check("a rounded figure is expanded", byName.reach.value === 12400);
  check("and says so, since 12.4k is not 12,400 exactly",
    byName.reach.warning?.includes("rounded"), byName.reach.warning);

  check("an unreadable figure is kept, not dropped", byName.saves !== undefined);
  check("and is flagged for typing in", byName.saves.value === null &&
    byName.saves.warning?.includes("type it in"));

  check("a low-confidence but readable figure is flagged, not discarded",
    byName.impressions.value === 8900 && byName.impressions.warning?.includes("unsure"));

  check("a clean high-confidence figure carries no warning", !byName.likes.warning);

  // The reviewer is looking at the image; the rows worth checking must be
  // the ones in front of them.
  check("flagged rows sort to the top", values[0].warning !== undefined);
  check("clean rows sort to the bottom", values.at(-1).warning === undefined);
}

/* ---- Duplicate labels ---------------------------------------------------- */
{
  const values = toExtractedValues([
    { name: "reach", rawText: "100", confidence: "high" },
    { name: "reach", rawText: "200", confidence: "high" },
  ]);
  check("a repeated label is flagged rather than silently overwritten",
    values.some((v) => v.warning?.includes("more than once")));
  check("and both readings survive for the human to choose between",
    values.length === 2);
}

/* ---- Owner-only value ---------------------------------------------------- */
{
  // A screenshot of views and likes adds nothing: the sync already has those.
  const publicOnly = toExtractedValues([
    { name: "views", rawText: "10000", confidence: "high" },
    { name: "likes", rawText: "500", confidence: "high" },
  ]);
  check("a screenshot of already-synced figures counts as no owner data",
    ownerOnlyCount(publicOnly) === 0);

  const worthIt = toExtractedValues([
    { name: "reach", rawText: "8.2k", confidence: "high" },
    { name: "saves", rawText: "312", confidence: "high" },
    { name: "views", rawText: "10000", confidence: "high" },
  ]);
  check("reach and saves are counted as owner-only", ownerOnlyCount(worthIt) === 2);

  check("an unreadable owner-only field does not count toward value",
    ownerOnlyCount(toExtractedValues([
      { name: "reach", rawText: "???", confidence: "low" },
    ])) === 0);

  check("views and likes are not treated as owner-only",
    !OWNER_ONLY.has("views") && !OWNER_ONLY.has("likes"));
}

/* ---- Nothing is written -------------------------------------------------- */
{
  const values = toExtractedValues([{ name: "reach", rawText: "1k", confidence: "high" }]);
  check("extraction returns plain data, with no write path of its own",
    Array.isArray(values) && typeof values[0].value === "number");
  check("and keeps the original text beside the parse, so a human can compare",
    values[0].rawText === "1k");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
