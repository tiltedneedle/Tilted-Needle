// Tests for caption-less video labels.
//
// The thing these guard against is scope creep into the database. This module
// exists precisely BECAUSE 41 live videos have no caption and there is nothing
// to recover -- the platforms returned empty, and those rows carry no
// description either. A generated title written back to the row would invent a
// caption the creator never wrote and would make a real title, if one ever
// arrives, indistinguishable from a synthesised one. So every assertion here
// is about what gets DISPLAYED, and isPlaceholder is the flag that keeps the
// distinction alive.
//
// The shortCode cases are the load-bearing ones. TikTok ids are 19-digit
// snowflakes whose leading digits are a timestamp shared by everything posted
// that week, so truncating from the FRONT would hand every video from the same
// week an identical label -- which is the exact problem this set out to fix.
const L = await import("../src/lib/contentLabels.ts");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

/* -- Detecting an empty title ---------------------------------------------- */
eq("Untitled is a placeholder", L.isPlaceholderTitle("Untitled"), true);
eq("case does not matter", L.isPlaceholderTitle("untitled"), true);
eq("surrounding space does not matter", L.isPlaceholderTitle("  Untitled  "), true);
eq("an empty string is a placeholder", L.isPlaceholderTitle(""), true);
eq("whitespace only is a placeholder", L.isPlaceholderTitle("   "), true);
eq("null is a placeholder", L.isPlaceholderTitle(null), true);
eq("undefined is a placeholder", L.isPlaceholderTitle(undefined), true);
eq("a lone dash is a placeholder", L.isPlaceholderTitle("-"), true);
eq("an em dash is a placeholder", L.isPlaceholderTitle("—"), true);
eq("a real caption is not", L.isPlaceholderTitle("Gen Z slang with our CFO"), false);
eq("a caption CONTAINING the word untitled is not a placeholder",
  L.isPlaceholderTitle("Untitled draft finally shipped"), false);

/* -- Shortening the post id ------------------------------------------------ */
eq("an Instagram shortcode is already short enough",
  L.shortCode("DZyWu6docyS"), "DZyWu6docyS");
eq("a TikTok snowflake keeps its TAIL, where posts actually differ",
  L.shortCode("7239481027364958211"), "4958211");
eq("a long non-numeric id is truncated from the front",
  L.shortCode("abcdefghijklmnopqrst"), "abcdefghijk");
eq("empty gives nothing", L.shortCode(""), null);
eq("null gives nothing", L.shortCode(null), null);
eq("whitespace gives nothing", L.shortCode("   "), null);

{
  // Two TikToks posted the same week share their leading digits entirely.
  // Front-truncation would label both identically; this is the regression the
  // tail rule exists to prevent.
  const a = L.shortCode("7239481027364958211");
  const b = L.shortCode("7239481027364958399");
  check("two posts from the same week get different codes", a !== b, `${a} vs ${b}`);
}

/* -- The label ------------------------------------------------------------- */
{
  const got = L.videoLabel({ title: "Gen Z slang with our CFO", postCode: "DZyWu6docyS" });
  eq("a real caption is shown untouched", got.text, "Gen Z slang with our CFO");
  eq("and is not flagged as a placeholder", got.isPlaceholder, false);
}

{
  const got = L.videoLabel({ title: "Untitled", postCode: "DZyWu6docyS" });
  eq("a caption-less video says why, and carries its code",
    got.text, "No caption · DZyWu6docyS");
  eq("and is flagged so it can be styled as a gap", got.isPlaceholder, true);
}

{
  const got = L.videoLabel({ title: "Untitled", postCode: null });
  eq("with no code it still says why", got.text, "No caption");
  eq("still flagged", got.isPlaceholder, true);
}

{
  // The whole point: forty neighbours must not read identically.
  const a = L.videoLabel({ title: "Untitled", postCode: "DZyWu6docyS" }).text;
  const b = L.videoLabel({ title: "Untitled", postCode: "DZlKAbfoaxn" }).text;
  check("two caption-less videos do not read the same", a !== b, `${a} vs ${b}`);
}

eq("a title that is only whitespace falls back too",
  L.videoLabel({ title: "   ", postCode: "DZyWu6docyS" }).text, "No caption · DZyWu6docyS");

eq("a missing title object does not throw",
  L.videoLabel({}).text, "No caption");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
