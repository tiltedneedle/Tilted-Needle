"use client";

import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";

type ThemeChoice = "light" | "dark" | "system";

function apply(choice: ThemeChoice) {
  const dark =
    choice === "dark" ||
    (choice === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
}

const OPTIONS: { value: ThemeChoice; icon: typeof Sun; label: string }[] = [
  { value: "light", icon: Sun, label: "Light" },
  { value: "dark", icon: Moon, label: "Dark" },
  { value: "system", icon: Monitor, label: "System" },
];

/**
 * A three-way Light/Dark/System switch, persisted in localStorage and
 * applied instantly (no route change, no server round trip -- theme is
 * pure presentation, so it never needed one). "System" keeps listening to
 * the OS setting live rather than snapshotting it once at selection time.
 */
export default function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => {
    // Deliberately a post-hydration setState: the server cannot know the
    // stored choice, so first paint renders "system" and this corrects it
    // once localStorage is readable -- reading it during render would
    // hydration-mismatch instead. One extra render at mount, by design.
    const stored = (localStorage.getItem("theme") as ThemeChoice | null) ?? "system";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChoice(stored);

    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if ((localStorage.getItem("theme") ?? "system") === "system") apply("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function choose(next: ThemeChoice) {
    setChoice(next);
    localStorage.setItem("theme", next);
    apply(next);
  }

  return (
    <div
      className="flex items-center gap-0.5 rounded-lg p-0.5"
      style={{ background: "rgb(255 255 255 / 0.05)" }}
      role="radiogroup"
      aria-label="Theme"
    >
      {OPTIONS.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          role="radio"
          aria-checked={choice === value}
          title={label}
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
  );
}
