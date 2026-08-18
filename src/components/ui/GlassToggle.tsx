"use client";

import { useEffect, useState } from "react";
import { Sparkles, Layers, Square } from "lucide-react";

type GlassChoice = "clear" | "tinted" | "solid";

const OPTIONS: { value: GlassChoice; icon: typeof Sparkles; label: string; hint: string }[] = [
  { value: "clear", icon: Sparkles, label: "Clear", hint: "Full transparency" },
  { value: "tinted", icon: Layers, label: "Tinted", hint: "More opaque, more contrast" },
  { value: "solid", icon: Square, label: "Solid", hint: "No transparency at all" },
];

/**
 * Transparency control: Clear / Tinted / Solid.
 *
 * WHY THIS IS A P0 FEATURE AND NOT A SETTINGS-PAGE NICETY
 *
 * Nielsen Norman Group's guidance on glassmorphism asks for a user control
 * over transparency, and Apple was forced into shipping one: iOS 26 launched
 * uniform Liquid Glass, drew sustained accessibility criticism -- legibility,
 * eye strain over long sessions, poor outdoor readability -- and 26.1 added
 * precisely this switch, with Tinted described as increasing opacity while
 * adding contrast. 26.2 went further again.
 *
 * If Apple could not ship uniform glass to a billion devices without an
 * escape hatch, this app cannot either. It shipped WITH the first glass
 * surface rather than after it.
 *
 * TINTED IS THE DEFAULT because it is where Apple landed, not where they
 * started. Clear photographs better; Tinted is the one people can use for a
 * full working day, which is what this product is for.
 *
 * Pure presentation, so it is persisted in localStorage and applied instantly
 * -- no server round trip, exactly like ThemeToggle. The OS-level
 * prefers-reduced-transparency and prefers-contrast overrides live in CSS
 * instead, because those can change while the page is open and a media query
 * tracks that for free.
 */
export default function GlassToggle() {
  const [choice, setChoice] = useState<GlassChoice>("tinted");
  const [forced, setForced] = useState(false);

  useEffect(() => {
    // Post-hydration on purpose: the server cannot know the stored choice, so
    // first paint renders the default and this corrects it once localStorage
    // is readable. Reading during render would hydration-mismatch instead.
    const stored = localStorage.getItem("glass");
    const next: GlassChoice =
      stored === "clear" || stored === "tinted" || stored === "solid" ? stored : "tinted";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChoice(next);

    // If the OS is already asking for less transparency, CSS has overridden
    // this control entirely. Saying so is better than leaving someone
    // clicking a switch that visibly does nothing.
    const mq = matchMedia("(prefers-reduced-transparency: reduce)");
    const sync = () => setForced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  function choose(next: GlassChoice) {
    setChoice(next);
    localStorage.setItem("glass", next);
    document.documentElement.setAttribute("data-glass", next);
  }

  return (
    <div className="flex flex-col gap-1">
      <div
        className="flex items-center gap-0.5 rounded-lg p-0.5"
        style={{ background: "var(--on-dark-hover)" }}
        role="radiogroup"
        aria-label="Transparency"
      >
        {OPTIONS.map(({ value, icon: Icon, label, hint }) => (
          <button
            key={value}
            role="radio"
            aria-checked={choice === value}
            title={`${label} — ${hint}`}
            onClick={() => choose(value)}
            className="grid size-7 place-items-center rounded-md transition-colors"
            style={{
              background: choice === value ? "var(--accent)" : "transparent",
              color: choice === value ? "var(--accent-fg)" : "var(--charcoal-400)",
            }}
          >
            <Icon size={14} strokeWidth={1.8} />
          </button>
        ))}
      </div>
      {forced && (
        <p className="text-[10px] leading-tight" style={{ color: "var(--sidebar-muted)" }}>
          Your system asks for reduced transparency, so this is off.
        </p>
      )}
    </div>
  );
}
