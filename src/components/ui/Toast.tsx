"use client";

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
 * Bottom-right stack, a coloured left bar per status, slide-in from the
 * right, auto-dismiss after 4s. One provider at the root; components call
 * useToast() rather than managing their own dismiss timers.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const push = useCallback((tone: ToastTone, message: string) => {
    const id = nextId.current++;
    setItems((prev) => [...prev, { id, tone, message }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className="animate-rise pointer-events-auto flex w-72 items-start gap-3 overflow-hidden bg-[var(--bg-elevated)] p-3 pl-4 text-sm"
            style={{
              borderRadius: "var(--radius-sm)",
              boxShadow: "var(--shadow-card-hover)",
              borderLeft: `4px solid ${BAR_COLOR[t.tone]}`,
            }}
            role="status"
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
