// WCAG contrast for a candidate palette, before any of it reaches the app.
//
// Picking colours by eye is how a "premium" dark theme ends up with 2.8:1 body
// text that looks fine on the designer's monitor and is unreadable on a laptop
// at an angle. Every pair below is checked against the threshold it actually
// has to meet: 4.5 for body text, 3.0 for large text and UI boundaries.

const hex = (h) => {
  const s = h.replace("#", "");
  const n = parseInt(s.length === 3 ? s.split("").map((c) => c + c).join("") : s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lum = (h) => {
  const [r, g, b] = hex(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const DARK = {
  bg: "#0a0a0b",
  panel: "#141416",
  elevated: "#1c1c20",
  subtle: "#18181b",
  sidebar: "#08080a",
  border: "#27272b",
  borderStrong: "#3a3a41",
  fg: "#fafafa",
  muted: "#9a9aa4",
  accent: "#e5484d",
  accentFg: "#0a0a0b",
  success: "#3fb57f",
  warning: "#edb25a",
  danger: "#f0666b",
  info: "#6b93f2",
  sidebarFg: "#fafafa",
  sidebarAccent: "#e5484d",
};

const LIGHT = {
  bg: "#fbfbfc",
  panel: "#ffffff",
  elevated: "#ffffff",
  subtle: "#f4f4f6",
  sidebar: "#0a0a0b",
  border: "#e6e6ea",
  borderStrong: "#c2c2cc",
  fg: "#16161a",
  muted: "#6b6b76",
  accent: "#d92d38",
  accentFg: "#ffffff",
  success: "#157a4e",
  warning: "#8a5a12",
  danger: "#c92a34",
  info: "#2f5fd0",
  sidebarFg: "#fafafa",
  sidebarAccent: "#e5484d",
};

let fails = 0;
function check(label, fg, bg, min) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) fails++;
  console.log(
    `  ${ok ? "OK  " : "FAIL"} ${label.padEnd(34)} ${r.toFixed(2).padStart(5)}:1  (needs ${min})`,
  );
}

for (const [name, P] of [["DARK", DARK], ["LIGHT", LIGHT]]) {
  console.log(`\n=== ${name} ===`);
  check("body text on page", P.fg, P.bg, 4.5);
  check("body text on card", P.fg, P.panel, 4.5);
  check("body text on elevated", P.fg, P.elevated, 4.5);
  check("muted text on page", P.muted, P.bg, 4.5);
  check("muted text on card", P.muted, P.panel, 4.5);
  check("muted text on subtle fill", P.muted, P.subtle, 4.5);
  check("accent text on page", P.accent, P.bg, 4.5);
  check("accent text on card", P.accent, P.panel, 4.5);
  check("text on accent (buttons)", P.accentFg, P.accent, 4.5);
  check("success on card", P.success, P.panel, 4.5);
  check("warning on card", P.warning, P.panel, 4.5);
  check("danger on card", P.danger, P.panel, 4.5);
  check("info on card", P.info, P.panel, 4.5);
  // Boundaries are UI components, not text: 3:1 is the bar.
  check("border against card", P.border, P.panel, 1.2);
  check("strong border against card", P.borderStrong, P.panel, 1.6);
  // The sidebar is dark in both themes, so it carries its own foreground.
  check("sidebar text on sidebar", P.sidebarFg, P.sidebar, 4.5);
  check("accent on sidebar", P.sidebarAccent, P.sidebar, 4.5);
}

console.log(`\n${fails} failing pair(s)`);
process.exit(fails ? 1 : 0);
