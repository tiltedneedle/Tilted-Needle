"use client";

import { X } from "lucide-react";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";

type ToastTone = "success" | "warning" | "danger" | "info";

type ToastItem = { id: number; tone: ToastTone; message: string };

const BAR_COLOR: Record<ToastTone, string> = {
  success: "var(--success-500)",
  warning: "var(--warning-500)",
  danger: "var(--danger-500)",
  info: "var(--info-500)",
};

const ToastContext = createContext<((tone: ToastTone, message: string) => void) | null>(null);

/** Anywhere under <ToastProvider>: const toast = useToast(); toast("success", "Saved."); */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

/**
 * Bottom-right stack, a coloured left bar per status, slide-in from the right.
 *
 * Auto-dismiss is NOT uniform, deliberately. A success or info toast confirms
 * something you just did and can evaporate after four seconds. An error is
 * often the only record that something failed -- taking it away on a timer
 * means a message you happened to look away from is gone for good, and the
 * user is left with an action that silently did nothing. Errors and warnings
 * therefore persist and carry a close button; the others do not, because a
 * dismiss control on a message that removes itself is one nobody will press.
 *
 * One provider at the root; components call useToast() rather than managing
 * their own timers.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const id = nextId.current++;
      setItems((prev) => [...prev, { id, tone, message }]);
      // An error does not time out. Success and info are confirmations of
      // something you just did and can safely evaporate; an error is the only
      // record that something FAILED, and taking it away after four seconds
      // means a message you glanced away from is gone for good. Those get a
      // close button instead -- see below.
      if (tone === "success" || tone === "info") {
        setTimeout(() => dismiss(id), 4000);
      }
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      {/* Above dropdowns on purpose: a toast reports on what just happened,
          and a panel that hides it makes the app look like it did nothing. */}
      <div
        className="pointer-events-none fixed bottom-4 right-4 flex flex-col gap-2"
        style={{ zIndex: "var(--z-toast)" }}
      >
        {items.map((t) => (
          <div
            key={t.id}
            className="animate-rise pointer-events-auto flex w-80 items-start gap-3 overflow-hidden p-3.5 pl-4 text-sm"
            style={{
              borderRadius: "var(--radius-md)",
              // Frosted, like every other floating surface. A toast sits over
              // whatever you were reading, and letting a little of it through
              // is the difference between a layer and a sticker.
              background: "var(--glass-bg)",
              backdropFilter: "var(--glass-filter)",
              WebkitBackdropFilter: "var(--glass-filter)",
              boxShadow: "var(--shadow-overlay)",
              border: "1px solid var(--glass-border)",
              // 3px, not 4: the border on all four sides now carries the
              // shape, so the tone bar only has to carry the colour.
              borderLeft: `3px solid ${BAR_COLOR[t.tone]}`,
            }}
            // Errors are announced assertively; a success confirmation should
            // not interrupt a screen reader mid-sentence.
            role={t.tone === "danger" || t.tone === "warning" ? "alert" : "status"}
          >
            <span className="min-w-0 flex-1">{t.message}</span>
            {/* Only where it is needed. A dismiss button on a message that
                removes itself in four seconds is a control nobody will ever
                press, and one more thing on screen. */}
            {(t.tone === "danger" || t.tone === "warning") && (
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="-mr-1 -mt-0.5 shrink-0 rounded p-1 text-[var(--muted)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)]"
              >
                <X size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
