"use client";

import { useEffect, useRef, useState } from "react";
import { formatCount } from "@/lib/format";

/**
 * A number that counts up to its value on first paint -- the one place
 * animated numbers earn their keep is a dashboard headline. Honors
 * prefers-reduced-motion by rendering the final value immediately, and
 * animates only once per mount (never on re-render), so it reads as an
 * entrance, not a slot machine.
 *
 * Formatting is chosen by a serializable `kind`, NOT a function prop: this
 * renders from Server Components, and a function crossing that boundary is
 * a runtime crash ("Functions cannot be passed directly to Client
 * Components") that the build never exercises on a session-gated page.
 */
export default function CountUp({
  value,
  kind = "int",
  durationMs = 900,
}: {
  value: number;
  /** "int" = 1,234; "count" = 4.6k / 10.2M (the house abbreviation). */
  kind?: "int" | "count";
  durationMs?: number;
}) {
  const format = (n: number) =>
    kind === "count" ? formatCount(Math.round(n)) : Math.round(n).toLocaleString();
  const [shown, setShown] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    // Reduced motion lands on the final value in a single frame; every
    // state write stays inside rAF so the effect never renders eagerly.
    const reduced =
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dur = reduced ? 0 : durationMs;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = dur === 0 ? 1 : Math.min(1, (now - start) / dur);
      // ease-out cubic: fast start, gentle landing on the true value.
      setShown(value * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <span className="tabular">{format(shown)}</span>;
}
