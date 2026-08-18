// WCAG contrast for the palette, before any of it reaches the app.
//
// Picking colours by eye is how a "premium" dark theme ends up with 2.8:1 body
// text that looks fine on the designer's monitor and is unreadable on a laptop
// at an angle. Every pair below is checked against the threshold it actually
// has to meet: 4.5 for body text, 3.0 for large text and UI boundaries.
//
// ---------------------------------------------------------------------------
// WHY THIS SCRIPT GREW A COMPOSITE MODEL
//
// It used to test every pair against a SOLID background, which was true while
// surfaces were solid. Under the glass redesign it stopped being true, and in
// the most dangerous way: it kept passing.
//
// A text token on a glass panel does not sit on --panel. It sits on a stack:
//
//     ground  ->  field blobs (0-3 of them, overlapping)  ->  glass tint
//
// and the middle layer VARIES ACROSS THE PAGE. The same panel is over garnet
// at the top-left and over bare ground in the middle. So a single ratio is not
// a property of the token at all -- it is a property of the token AND where it
// happens to be. A contrast ratio that depends on scroll position is not a
// contrast ratio.
//
// The fix is to stop testing one background and start testing the WORST TWO:
// the brightest and the darkest point the field can produce. A pair passes
// only if it clears the bar at both extremes, in all three transparency modes,
// in both themes. Anything else is a number that is true on average and false
// somewhere on the page.
//
// Modelling note: backdrop-filter's blur redistributes luminance locally but
// does not change the average, and saturate() moves chroma far more than
// lightness, so compositing ground -> blobs -> tint is a sound approximation of
// what a glyph actually sits on. It errs slightly pessimistic at blob edges,
// which is the correct direction for a gate.

const hex = (h) => {
  const s = h.replace("#", "");
  const n = parseInt(s.length === 3 ? s.split("").map((c) => c + c).join("") : s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toLin = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const lumRGB = ([r, g, b]) => 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
const lum = (h) => lumRGB(hex(h));
const ratioRGB = (a, b) => {
  const [x, y] = [lumRGB(a), lumRGB(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const ratio = (a, b) => ratioRGB(hex(a), hex(b));

/** Source-over: `over` at `alpha` composited onto `base`. Both plain sRGB. */
const over = (base, src, alpha) => base.map((c, i) => c * (1 - alpha) + src[i] * alpha);

const DARK = {
  bg: "#0a0a0b",
  panel: "#141416",
  elevated: "#1c1c20",
  subtle: "#18181b",
  inputBg: "#0e0e10",
  sidebar: "#08080a",
  border: "#27272b",
  borderStrong: "#3a3a41",
  fg: "#fafafa",
  muted: "#9a9aa4",
  accent: "#e14a66",
  accentFg: "#0a0a0b",
  success: "#3fb57f",
  warning: "#edb25a",
  danger: "#f0666b",
  info: "#6b93f2",
  sidebarFg: "#fafafa",
  sidebarAccent: "#e14a66",
  // Glass: the tint colour, and the field as configured in globals.css.
  surface: [22, 21, 24],
  field: [
    { rgb: [155, 28, 46], a: 0.2 },
    { rgb: [59, 30, 70], a: 0.17 },
    { rgb: [14, 59, 69], a: 0.15 },
  ],
};

const LIGHT = {
  bg: "#f7f5f1",
  panel: "#ffffff",
  elevated: "#ffffff",
  subtle: "#f6f4f0",
  inputBg: "#f2efe9",
  sidebar: "#0a0a0b",
  border: "#e9e6e1",
  borderStrong: "#c6c3bc",
  fg: "#16161a",
  muted: "#67676f",
  accent: "#a01f42",
  accentFg: "#ffffff",
  success: "#157a4e",
  warning: "#8a5a12",
  danger: "#c92a34",
  info: "#2f5fd0",
  sidebarFg: "#fafafa",
  sidebarAccent: "#e14a66",
  surface: [255, 255, 255],
  field: [
    { rgb: [155, 28, 46], a: 0.24 },
    { rgb: [59, 30, 70], a: 0.18 },
    { rgb: [14, 59, 69], a: 0.165 },
  ],
};

// Must mirror globals.css. Tinted is the default; Clear is opt-in; Solid is
// the accessibility floor and also what prefers-reduced-transparency forces.
// Chrome's Clear alpha differs BY THEME, and that is deliberate: on a light
// ground the field darkens the surface while the text is also dark, so the
// same transparency costs contrast at both ends. See globals.css.
const MODES = {
  clear: { chrome: { DARK: 0.72, LIGHT: 0.82 }, panel: 0.84, data: 0.96, field: 1 },
  tinted: { chrome: 0.84, panel: 0.93, data: 0.99, field: 1 },
  solid: { chrome: 1, panel: 1, data: 1, field: 0 },
};

/**
 * Every distinct field state a surface can sit over: bare ground, each blob
 * alone, and all three stacked. The extremes of this set bound what any glyph
 * on the page can land on.
 *
 * DELIBERATELY PESSIMISTIC, and worth knowing when reading a near-miss. The
 * all-three-stacked state is a bound, not a typical pixel: the blobs are
 * positioned so that no point of the viewport actually receives all three at
 * full strength, and the MEASURED median effective field alpha is about 0.047
 * against the 0.16 the token declares -- roughly a third.
 *
 * That gap is kept on purpose. Failing safe means testing a darker backdrop
 * than the layout can produce, so a pass here is a pass everywhere. But a
 * token sitting at 4.6:1 in this model has more real headroom than the number
 * suggests, and a future change should not be abandoned on that basis without
 * re-measuring the actual geometry.
 */
function fieldStates(P, fieldScale) {
  const ground = hex(P.bg);
  const blobs = P.field.map((b) => ({ ...b, a: b.a * fieldScale }));
  const states = [ground];
  for (const b of blobs) states.push(over(ground, b.rgb, b.a));
  let all = ground;
  for (const b of blobs) all = over(all, b.rgb, b.a);
  states.push(all);
  // Pairs, since two blobs overlap in the middle of the viewport.
  for (let i = 0; i < blobs.length; i++) {
    for (let j = i + 1; j < blobs.length; j++) {
      states.push(over(over(ground, blobs[i].rgb, blobs[i].a), blobs[j].rgb, blobs[j].a));
    }
  }
  return states;
}

/** The lightest and darkest background a given tier can present. */
function tierExtremes(P, mode, tier, theme) {
  const m = MODES[mode];
  const raw = m[tier];
  const alpha = typeof raw === "object" ? raw[theme] : raw;
  const backs = fieldStates(P, m.field).map((f) => over(f, P.surface, alpha));
  let lightest = backs[0];
  let darkest = backs[0];
  for (const b of backs) {
    if (lumRGB(b) > lumRGB(lightest)) lightest = b;
    if (lumRGB(b) < lumRGB(darkest)) darkest = b;
  }
  return { lightest, darkest };
}

let fails = 0;
const failures = [];

function check(label, fg, bg, min) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) {
    fails++;
    failures.push(label);
  }
  console.log(
    `  ${ok ? "OK  " : "FAIL"} ${label.padEnd(38)} ${r.toFixed(2).padStart(5)}:1  (needs ${min})`,
  );
}

/** Checks a token at BOTH extremes of a tier. Reports the worse one. */
function checkGlass(theme, P, mode, tier, label, fg, min) {
  const { lightest, darkest } = tierExtremes(P, mode, tier, theme);
  const rl = ratioRGB(hex(fg), lightest);
  const rd = ratioRGB(hex(fg), darkest);
  const worst = Math.min(rl, rd);
  const ok = worst >= min;
  if (!ok) {
    fails++;
    failures.push(`${theme}/${mode}/${tier}: ${label}`);
  }
  console.log(
    `  ${ok ? "OK  " : "FAIL"} ${label.padEnd(38)} ${worst.toFixed(2).padStart(5)}:1` +
      `  (bright ${rl.toFixed(2)}, dark ${rd.toFixed(2)}; needs ${min})`,
  );
}

// ---------------------------------------------------------------------------
// Solid pairs: surfaces that are NOT glass and never will be -- the sidebar's
// own foreground, buttons, and the opaque fallbacks.
for (const [name, P] of [["DARK", DARK], ["LIGHT", LIGHT]]) {
  console.log(`\n=== ${name} — solid surfaces ===`);
  check("body text on page", P.fg, P.bg, 4.5);
  check("body text on card", P.fg, P.panel, 4.5);
  check("body text on elevated", P.fg, P.elevated, 4.5);
  check("muted text on page", P.muted, P.bg, 4.5);
  check("muted text on card", P.muted, P.panel, 4.5);
  check("muted text on subtle fill", P.muted, P.subtle, 4.5);
  // Inputs are a well -- a different surface from the card, so the text and
  // placeholder on them need their own pair rather than inheriting the card's.
  check("body text in an input", P.fg, P.inputBg, 4.5);
  check("placeholder in an input", P.muted, P.inputBg, 4.5);
  check("accent text on page", P.accent, P.bg, 4.5);
  check("accent text on card", P.accent, P.panel, 4.5);
  check("text on accent (buttons)", P.accentFg, P.accent, 4.5);
  check("success on card", P.success, P.panel, 4.5);
  check("warning on card", P.warning, P.panel, 4.5);
  check("danger on card", P.danger, P.panel, 4.5);
  check("info on card", P.info, P.panel, 4.5);
  check("border against card", P.border, P.panel, 1.2);
  check("strong border against card", P.borderStrong, P.panel, 1.6);
  check("sidebar text on sidebar", P.sidebarFg, P.sidebar, 4.5);
  check("accent on sidebar", P.sidebarAccent, P.sidebar, 4.5);
}

// ---------------------------------------------------------------------------
// Glass pairs: every text token, on every tier, in every mode, at both
// extremes of the field.
for (const [theme, P] of [["DARK", DARK], ["LIGHT", LIGHT]]) {
  for (const mode of Object.keys(MODES)) {
    for (const tier of ["chrome", "panel", "data"]) {
      console.log(`\n=== ${theme} — ${mode} — ${tier} tier ===`);
      checkGlass(theme, P, mode, tier, "body text", P.fg, 4.5);
      checkGlass(theme, P, mode, tier, "muted text", P.muted, 4.5);
      checkGlass(theme, P, mode, tier, "accent text", P.accent, 4.5);
      checkGlass(theme, P, mode, tier, "success text", P.success, 4.5);
      checkGlass(theme, P, mode, tier, "warning text", P.warning, 4.5);
      checkGlass(theme, P, mode, tier, "danger text", P.danger, 4.5);
      checkGlass(theme, P, mode, tier, "info text", P.info, 4.5);
    }
  }
}

console.log(`\n${fails} failing pair(s)`);
if (fails) {
  console.log("\nfailures:");
  for (const f of failures) console.log("  - " + f);
  console.log(
    "\nA glass failure means the token is illegible SOMEWHERE on the page, not\n" +
      "everywhere -- which is worse, because it will look fine in most screenshots.\n" +
      "Fix by raising the tier's opacity or lowering the field alpha, not by\n" +
      "lowering the threshold.",
  );
}
process.exit(fails ? 1 : 0);
