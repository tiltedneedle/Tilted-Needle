"use client";

import { useCallback, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import Popover from "@/components/ui/Popover";

/**
 * A dropdown that actually obeys the theme.
 *
 * A native <select> renders its option list through the OPERATING SYSTEM, not
 * the page. No CSS reaches inside it -- not our variables, not our fonts, not
 * our radii. In dark mode that produced the bug in the screenshots: a white
 * panel with near-invisible grey text floating over a dark app, unfixable from
 * the stylesheet because the panel was never ours to style.
 *
 * So the list is rendered here instead, in the app's own surface tokens, using
 * the same anatomy as the multi-select in FilterBar: a button that states the
 * current value, a panel that closes on outside-click and Escape, and a check
 * beside what is chosen.
 *
 * Deliberately keeps the native element's INTERFACE -- value in, string out --
 * so swapping one in is a two-line change at each call site and nothing has to
 * learn a new state shape.
 */
export default function Select({
  value,
  onChange,
  options,
  placeholder = "Select…",
  className = "",
  ariaLabel,
  disabled = false,
  invalid = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  /** Shown when nothing is chosen; also the "clear" row when clearable. */
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  /**
   * Draw the control as needing attention. Exists because the import review
   * rows flagged unmapped people and clients with a red or amber border on
   * the native element -- swapping to this component would have silently
   * dropped that cue, and a row that is missing a required value would have
   * looked identical to one that is complete.
   */
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Outside-click and Escape now belong to Popover, which can see both the
  // anchor and the portalled panel. Doing it here would treat a click on an
  // option as "outside" and close before the option registered.
  const close = useCallback(() => setOpen(false), []);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        type="button"
        className={`input flex w-full cursor-pointer items-center gap-1.5 py-1.5 text-left text-sm transition-colors ${
          invalid
            ? "border-[var(--danger)]"
            : value
              ? "border-[var(--accent)]/50 font-medium"
              : ""
        } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
        onClick={() => !disabled && setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        disabled={disabled}
      >
        <span
          className={`min-w-0 flex-1 truncate ${selected ? "" : "text-[var(--muted)]"}`}
        >
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          size={13}
          className={`shrink-0 text-[var(--muted)] transition-transform duration-150 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <Popover
          anchorRef={wrapRef}
          onClose={close}
          matchWidth
          minWidth={180}
          ariaLabel={ariaLabel}
        >
          {/* The clear row. A native select needs an empty <option> for this
              and it reads as a blank line; naming it says what it does. */}
          <button
            type="button"
            role="option"
            aria-selected={!value}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--muted)] transition-colors hover:bg-[var(--bg-subtle)]"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            <span className="grid size-4 shrink-0 place-items-center">
              {!value && <Check size={11} strokeWidth={3} />}
            </span>
            <span className="min-w-0 flex-1 truncate">{placeholder}</span>
          </button>

          {options.length === 0 && (
            <div className="px-3 py-2 text-xs text-[var(--muted)]">
              Nothing to pick yet.
            </div>
          )}

          {options.map((o) => {
            const isSel = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={isSel}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--bg-subtle)]"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                <span
                  className="grid size-4 shrink-0 place-items-center rounded transition-colors"
                  style={{ color: "var(--accent)" }}
                >
                  {isSel && <Check size={11} strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
              </button>
            );
          })}
        </Popover>
      )}
    </div>
  );
}
