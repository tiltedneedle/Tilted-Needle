// The avatar palette carries white initials, so every colour in it must clear
// 4.5:1 against white.  npm run test:avatar
//
// This exists because the palette's own comment claimed the colours were
// "chosen to stay legible against white text" while four of the eight were
// not -- clay 3.93, green 4.02, amber 3.28, teal 4.13. They were invisible to
// the composite contrast gate because that gate tests TOKENS and these are
// literals inside a component, which is exactly how text-emerald-500 also
// reached 2.47:1 in light mode. An assertion in a comment is not a test.
const { AVATAR_COLORS, colorForSeed, initialsOf } = await import("../src/lib/avatar.ts");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const againstWhite = (hex) => 1.05 / (lum(hex) + 0.05);

for (const hex of AVATAR_COLORS) {
  const r = againstWhite(hex);
  check(`${hex} carries white initials`, r >= 4.5, `${r.toFixed(2)}:1`);
}

// The colour must be stable per person, or a row of circles stops being
// scannable -- which is the only reason the palette exists.
{
  const a = colorForSeed("user-123"), b = colorForSeed("user-123");
  check("same seed, same colour", a === b, a);
  check("different seeds differ somewhere",
    new Set(["a", "b", "c", "d", "e", "f", "g", "h", "i"].map(colorForSeed)).size > 1);
}

check("initials: one word", initialsOf("Cimmie") === "C");
check("initials: two words", initialsOf("Malik Ahmed") === "MA");
check("initials: middle names use first and last", initialsOf("Malik Ahmed Sher Awan") === "MA");
check("initials: empty is not a crash", initialsOf("   ") === "?");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
