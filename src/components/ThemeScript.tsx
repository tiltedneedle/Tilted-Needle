/**
 * Sets data-theme and data-glass on <html> before first paint, so there is
 * never a flash of the wrong theme or the wrong material. Runs as a plain
 * inline script rather than a React effect -- an effect only runs after the
 * DOM (and the browser's first paint) already happened.
 *
 * data-glass defaults to "tinted" rather than "clear", and that is the whole
 * point of it. Apple shipped uniform Clear glass in iOS 26, drew sustained
 * accessibility criticism, and added exactly this switch in 26.1 -- with
 * Tinted as the thing they retreated TO. Starting at the retreat is cheaper
 * than repeating the experiment.
 *
 * prefers-reduced-transparency is handled in CSS rather than here, because
 * it can change while the page is open and a media query tracks that for
 * free. This script only restores the stored CHOICE.
 */
const THEME_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("theme") || "system";
    var dark = stored === "dark" || (stored === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    var glass = localStorage.getItem("glass");
    if (glass !== "clear" && glass !== "tinted" && glass !== "solid") glass = "tinted";
    document.documentElement.setAttribute("data-glass", glass);
  } catch (e) {}
})();
`;

export default function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}
