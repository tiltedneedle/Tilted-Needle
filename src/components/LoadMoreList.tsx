"use client";

import { useState, type ReactNode } from "react";

/**
 * Renders only the first `initialCount` of an already-rendered list, with a
 * "Load more" button revealing the rest in batches of `step`. Takes
 * pre-rendered ReactNode items rather than raw data + a render callback so
 * it works the same way whether the caller is a client component (which
 * could pass a function) or a server component (which cannot -- functions
 * aren't serializable across that boundary, but a list of already-built
 * elements is).
 *
 * Purely a rendering-cost fix: with 223 real videos on one workspace, a full
 * list was 223 VideoTiles (avatars, per-platform metric rows, credit
 * dropdowns) mounting on every page load regardless of how far anyone
 * scrolled. The underlying data fetch is unchanged -- this only cuts what
 * gets built into the DOM up front.
 */
export default function LoadMoreList({
  items,
  initialCount = 10,
  step = 10,
  className,
  /** Pass the active sort/filter key to snap back to the first page when it
      changes -- otherwise switching sort while expanded would keep whatever
      count was reached against the list's new order. */
  resetKey,
}: {
  items: ReactNode[];
  initialCount?: number;
  step?: number;
  className?: string;
  resetKey?: string | number;
}) {
  const [count, setCount] = useState(initialCount);

  // Snap back to the first page when the sort/filter key changes -- adjusted
  // during render (React's sanctioned prop-change pattern), not in an effect.
  const [lastKey, setLastKey] = useState(resetKey);
  if (resetKey !== lastKey) {
    setLastKey(resetKey);
    setCount(initialCount);
  }

  const visible = items.slice(0, count);
  const remaining = items.length - visible.length;

  return (
    <>
      <div className={className}>{visible}</div>
      {remaining > 0 && (
        <button
          className="btn mt-2 w-full justify-center py-2 text-xs"
          onClick={() => setCount((c) => c + step)}
        >
          Load {Math.min(step, remaining)} more — {remaining} left
        </button>
      )}
    </>
  );
}
