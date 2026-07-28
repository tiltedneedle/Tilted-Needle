// Tests for the Clockify import's pure parsing logic. The network client
// itself (clockify.ts) imports "server-only", which throws unconditionally
// outside Next's bundler, so it cannot be exercised here -- that boundary
// is deliberate, not a gap: it is why the pure parsing was split out.
const C = await import("../src/lib/clockifyParse.ts");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  if (ok) pass++;
  else fail++;
};

check("hours and minutes", C.parseIsoDuration("PT1H30M") === 5400);
check("hours only", C.parseIsoDuration("PT2H") === 7200);
check("minutes only", C.parseIsoDuration("PT45M") === 2700);
check("seconds only", C.parseIsoDuration("PT30S") === 30);
check("hours, minutes, and seconds", C.parseIsoDuration("PT1H2M3S") === 3723);
check("zero duration", C.parseIsoDuration("PT0S") === 0);
check("null input returns null, not zero", C.parseIsoDuration(null) === null);
check("malformed input returns null rather than throwing",
  C.parseIsoDuration("not-a-duration") === null);
check("empty string returns null", C.parseIsoDuration("") === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
