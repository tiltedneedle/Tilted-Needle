/**
 * Sets data-theme on <html> before first paint, so there is never a flash
 * of the wrong theme. Runs as a plain inline script rather than a React
 * effect -- an effect only runs after the DOM (and the browser's first
 * paint) already happened.
 */
const THEME_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("theme") || "system";
    var dark = stored === "dark" || (stored === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  } catch (e) {}
})();
`;

export default function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}
