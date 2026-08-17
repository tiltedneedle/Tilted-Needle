"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

/**
 * The panel half of every dropdown in the app, rendered through a portal.
 *
 * WHY A PORTAL, and not a bigger z-index.
 *
 * Two separate bugs were killing these panels, and only one of them is about
 * paint order:
 *
 *   1. The stat cards on /content carry `.animate-rise` inside `.stagger`.
 *      That animation is declared `both`, so during its delay the BACKWARDS
 *      fill is already applying `transform: translateY(8px)`. A transform
 *      creates a stacking context. So each stat card became its own layer,
 *      and the filter bar's panel -- z-30 inside a DIFFERENT ancestor -- had
 *      no number it could pick to climb out. Raising z-30 to z-50 or z-9999
 *      changes nothing, because z-index only orders siblings WITHIN a
 *      stacking context. That is why this kept coming back.
 *
 *   2. The video list is a `card ... overflow-hidden` (ContentOverview), and
 *      that overflow is what gives the divided card its rounded corners. A
 *      panel opened on the last row was CLIPPED, not painted under. No
 *      z-index has ever fixed a clip.
 *
 * A portal to <body> answers both at once and permanently: the panel is no
 * longer a descendant of anything, so no ancestor's stacking context and no
 * ancestor's overflow can reach it. The cost is that `position: absolute`
 * relative to the trigger stops working, so the panel is `fixed` and
 * positioned from the trigger's rect -- which is why the scroll and resize
 * listeners below are load-bearing rather than polish.
 *
 * THE TRAP THIS COMPONENT EXISTS TO CLOSE. Every call site used to detect
 * outside-clicks with `wrapRef.current.contains(e.target)`, which worked only
 * because the panel was a DOM child of the wrapper. Portalled, it no longer
 * is -- so that same check now reports "outside" for a click on an option and
 * slams the panel shut mid-interaction. It is silent, and it breaks the
 * multi-select worst, because ticking a box is supposed to leave it open. So
 * outside-detection belongs HERE, where both the anchor and the panel are
 * known, and no call site is allowed to own it.
 */

/** Distance between trigger and panel. */
const GAP = 4;
/** Keep the panel this far from the viewport edge. */
const EDGE = 8;
/** Below this much room underneath, prefer flipping above the trigger. */
const MIN_ROOM = 160;

export default function Popover({
  anchorRef,
  onClose,
  children,
  align = "left",
  matchWidth = false,
  minWidth = 180,
  width,
  maxHeight = 256,
  className = "",
  style,
  role = "listbox",
  ariaMultiselectable,
  ariaLabel,
}: {
  /** The trigger (or its wrapper). The panel is positioned from its rect. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Fired on outside pointerdown and on Escape. The caller owns `open`. */
  onClose: () => void;
  children: ReactNode;
  align?: "left" | "right";
  /** Pin the panel to the trigger's exact width, as a full-width Select wants. */
  matchWidth?: boolean;
  minWidth?: number;
  width?: number;
  maxHeight?: number;
  className?: string;
  style?: CSSProperties;
  role?: string;
  ariaMultiselectable?: boolean;
  ariaLabel?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxWidth: number;
    maxHeight: number;
  } | null>(null);

  const place = useCallback(() => {
    const el = anchorRef.current;
    // Returning false rather than just bailing: the caller needs to know the
    // anchor was not there yet, because that is a recoverable state and
    // silently doing nothing is what made the panel never appear at all.
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const roomBelow = vh - r.bottom - GAP - EDGE;
    const roomAbove = r.top - GAP - EDGE;
    // Flip only when below is genuinely cramped AND above is better, so the
    // panel does not jump sides on a page that is merely a little short.
    const flip = roomBelow < MIN_ROOM && roomAbove > roomBelow;
    const room = Math.max(120, Math.min(maxHeight, flip ? roomAbove : roomBelow));

    const w = matchWidth ? r.width : Math.max(width ?? 0, minWidth, r.width);
    let left = align === "right" ? r.right - w : r.left;
    // Never let a right-aligned or wide panel hang off the screen.
    left = Math.min(Math.max(EDGE, left), Math.max(EDGE, vw - w - EDGE));
    // How far the panel may grow before it would leave the viewport. This is
    // what makes the width below a FLOOR rather than a cap: a "Role" trigger
    // is about 100px, and pinning its menu to that turned every option into
    // "Ro...", "Sc...", "Ed..." -- a menu whose entries cannot be read is not
    // a menu. It grows to fit its content and stops at the screen edge.
    const maxW = Math.max(w, vw - left - EDGE);

    setPos(
      flip
        ? // Anchored by its BOTTOM edge when flipped: anchoring by top would
          // need the rendered height, and a panel shorter than its max would
          // float away from the trigger.
          { bottom: vh - r.top + GAP, left, width: w, maxWidth: maxW, maxHeight: room }
        : { top: r.bottom + GAP, left, width: w, maxWidth: maxW, maxHeight: room },
    );
    return true;
  }, [anchorRef, align, matchWidth, minWidth, width, maxHeight]);

  // Measure before paint so the panel never appears at 0,0 and jumps.
  useLayoutEffect(() => {
    place();
  }, [place]);

  /**
   * The anchor is not always attached yet when the layout effect runs, and
   * without this the panel simply never appears.
   *
   * React commits layout effects and ref attachments in ONE bottom-up pass,
   * so a child's useLayoutEffect can fire before an ANCESTOR's ref callback
   * has run. That is fine for a trigger whose ref is attached on every render
   * -- by the time the panel opens, the ref has been set for many commits.
   * It is fatal for a call site that attaches the ref conditionally in the
   * same commit that opens the panel, which is exactly what VideoTile's
   * per-role credit menu does: `ref={isOpen ? anchorRef : undefined}`. The
   * first measurement found null, bailed, and nothing ever tried again -- so
   * clicking a role showed no menu whatsoever.
   *
   * Passive effects run after the whole commit, by which point every ref is
   * attached. This only does work when the layout pass came up empty, so the
   * normal path still measures before paint and never flickers.
   */
  useEffect(() => {
    if (pos) return;
    place();
  }, [pos, place]);

  useEffect(() => {
    // capture:true so a scroll inside ANY container is seen, not just the
    // window -- a panel whose trigger scrolls away must follow or close.
    const onScroll = () => place();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);

    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
      // Focus goes back where it came from; otherwise Escape strands the
      // keyboard at the top of the document.
      const trigger = anchorRef.current;
      (trigger?.querySelector("button") ?? trigger)?.focus?.();
    };

    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchorRef, onClose, place]);

  // The panel only ever mounts from a real interaction, so document exists --
  // but a null guard keeps it honest if it is ever rendered open on first
  // paint, where reaching for document.body would throw during SSR.
  if (!pos || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={panelRef}
      role={role}
      aria-multiselectable={ariaMultiselectable}
      aria-label={ariaLabel}
      className={`animate-pop overflow-y-auto py-1 ${className}`}
      style={{
        position: "fixed",
        top: pos.top,
        bottom: pos.bottom,
        left: pos.left,
        // max-content between a floor and a cap, instead of a fixed width.
        //
        // The trigger width is the FLOOR the panel must not drop below; the
        // widest option decides the rest; the viewport edge is the cap.
        // Pinning it to the trigger is what turned a 100px "Role" menu into
        // "Ro...", "Sc...", "Ed...". max-content is needed explicitly because
        // the options carry `truncate` with `min-w-0`, so they will happily
        // shrink to nothing and never ask the panel to be wider.
        width: "max-content",
        minWidth: pos.width,
        maxWidth: pos.maxWidth,
        maxHeight: pos.maxHeight,
        // The options themselves must not wrap to two lines now that the
        // panel can grow -- growing is the fix, wrapping would be a new bug.
        whiteSpace: "nowrap",
        zIndex: "var(--z-dropdown)",
        borderRadius: "var(--radius-md)",
        // Chrome tier: a popover floats over content, which is exactly the
        // case that earns the strongest glass. Its opacity is no longer fixed
        // here -- it follows the transparency mode, and every value is gated
        // by the composite contrast test against both extremes of the field.
        background: "var(--glass-bg)",
        backdropFilter: "var(--glass-filter)",
        WebkitBackdropFilter: "var(--glass-filter)",
        boxShadow: "var(--shadow-overlay)",
        border: "1px solid var(--glass-border)",
        ...style,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
