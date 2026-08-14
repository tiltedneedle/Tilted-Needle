"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import type { WorkspaceSummary } from "@/lib/workspace";

/**
 * The app frame, responsive. Desktop keeps the fixed 240px sidebar; below
 * lg the sidebar becomes a slide-in drawer behind a hamburger, because a
 * fixed 240px column on a 375px phone left ~135px for every dashboard.
 *
 * The drawer renders the same <Sidebar> as desktop rather than a trimmed
 * mobile menu -- the whole nav stays reachable, and the two can never
 * drift apart.
 */
export default function AppShell({
  workspaces,
  active,
  fullName,
  children,
}: {
  workspaces: WorkspaceSummary[];
  active: WorkspaceSummary;
  fullName: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Closing on pathname covers browser back/forward too, which the
  // per-link onNavigate callback alone would miss. Adjusted during render
  // (React's sanctioned prop-change pattern) rather than in an effect.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Keyboard users skip the whole nav in one Tab; invisible otherwise. */}
      <a
        href="#main"
        className="btn-primary sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
        style={{ zIndex: "var(--z-skip)" }}
      >
        Skip to content
      </a>
      <div className="hidden lg:flex">
        <Sidebar workspaces={workspaces} active={active} fullName={fullName} />
      </div>

      {open && (
        <div
          className="fixed inset-0 flex lg:hidden"
          style={{ zIndex: "var(--z-modal)" }}
          role="dialog"
          aria-modal="true"
        >
          {/* Scrim, not a blackout. A flat 50% black hides the page; a
              lighter wash with a small blur pushes it out of focus while
              leaving it legible as context -- you can still see WHERE you
              were, which is the difference between a drawer over your work
              and a new screen. This is chrome floating over content, so the
              blur belongs here for the same reason it does not belong on a
              table. */}
          <div
            className="absolute inset-0"
            style={{
              background: "rgb(0 0 0 / 0.42)",
              backdropFilter: "blur(3px)",
              WebkitBackdropFilter: "blur(3px)",
            }}
            onClick={() => setOpen(false)}
          />
          <div className="animate-slide-in relative">
            <Sidebar
              workspaces={workspaces}
              active={active}
              fullName={fullName}
              onNavigate={() => setOpen(false)}
            />
          </div>
        </div>
      )}

      <main id="main" className="min-w-0 flex-1 overflow-y-auto">
        <div
          className="sticky top-0 flex items-center gap-2 border-b border-[var(--border)] px-3 py-2 lg:hidden"
          style={{
            zIndex: "var(--z-sticky)",
            // Frosted: this bar sits over the page while it scrolls, so a
            // solid fill makes it a lid and a translucent one makes it a
            // layer. One of the few places in the app where content passing
            // underneath is the point.
            background: "var(--glass-bg)",
            backdropFilter: "var(--glass-filter)",
            WebkitBackdropFilter: "var(--glass-filter)",
          }}
        >
          <button
            className="btn-ghost"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={18} strokeWidth={1.8} />
          </button>
          <span className="truncate text-sm font-semibold">{active.name}</span>
        </div>
        {children}
      </main>
    </div>
  );
}
