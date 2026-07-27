"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { switchWorkspace, signOut } from "@/app/actions";
import type { WorkspaceSummary } from "@/lib/workspace";

const NAV = [
  {
    group: null,
    items: [
      { href: "/timesheet", label: "Timesheet", icon: GridIcon },
      { href: "/track", label: "Time Tracker", icon: ClockIcon },
    ],
  },
  {
    group: "Analyze",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: SquaresIcon },
      { href: "/reports", label: "Reports", icon: ChartIcon },
    ],
  },
  {
    group: "Content",
    items: [
      { href: "/content", label: "Content", icon: PlayIcon },
      { href: "/accounts", label: "Accounts", icon: ShareIcon },
    ],
  },
  {
    group: "Manage",
    items: [
      { href: "/projects", label: "Projects", icon: FolderIcon },
      { href: "/clients", label: "Clients", icon: BriefcaseIcon },
      { href: "/tags", label: "Tags", icon: TagIcon },
      { href: "/team", label: "Team", icon: UsersIcon },
    ],
  },
];

export default function Sidebar({
  workspaces,
  active,
  fullName,
}: {
  workspaces: WorkspaceSummary[];
  active: WorkspaceSummary;
  fullName: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  return (
    <aside className="flex h-dvh w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-subtle)]">
      {/* Workspace switcher: the team runs several workspaces, so this is a
          high-frequency control, not a settings-page afterthought (PRD 7.1). */}
      <div className="relative p-3">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--border)]/50"
          aria-expanded={open}
          aria-haspopup="listbox"
        >
          <span
            className="grid size-6 shrink-0 place-items-center rounded text-[11px] font-semibold"
            style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
          >
            {active.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {active.name}
          </span>
          <ChevronIcon className={open ? "rotate-180" : ""} />
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div
              role="listbox"
              className="animate-pop panel-shadow absolute left-3 right-3 top-14 z-20 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--panel)] py-1"
            >
              {workspaces.map((w) => (
                <button
                  key={w.id}
                  role="option"
                  aria-selected={w.id === active.id}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--bg-subtle)]"
                  onClick={() => {
                    setOpen(false);
                    if (w.id !== active.id) {
                      startTransition(() => void switchWorkspace(w.id));
                    }
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{w.name}</span>
                  {w.id === active.id && <CheckIcon />}
                </button>
              ))}
              <div className="my-1 h-px bg-[var(--border)]" />
              <Link
                href="/onboarding"
                className="block px-3 py-1.5 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)]"
                onClick={() => setOpen(false)}
              >
                New workspace
              </Link>
            </div>
          </>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        {NAV.map((section, i) => (
          <div key={i} className="mb-4">
            {section.group && (
              <div className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
                {section.group}
              </div>
            )}
            {section.items.map(({ href, label, icon: Icon }) => {
              const isActive = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`mb-0.5 flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                    isActive
                      ? "bg-[var(--border)]/70 font-medium text-[var(--fg)]"
                      : "text-[var(--muted)] hover:bg-[var(--border)]/40 hover:text-[var(--fg)]"
                  }`}
                >
                  <Icon />
                  {label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-[var(--border)] p-3">
        <div className="mb-2 truncate px-1 text-xs text-[var(--muted)]">
          {fullName} · {active.role}
        </div>
        <form action={signOut}>
          <button className="w-full rounded-md px-1 py-1 text-left text-sm text-[var(--muted)] transition-colors hover:text-[var(--fg)]">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}

/* Inline icons keep the bundle free of an icon dependency. */
const s = { width: 15, height: 15, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function ClockIcon() {
  return <svg {...s}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
}
function GridIcon() {
  return <svg {...s}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 9v12" /></svg>;
}
function SquaresIcon() {
  return <svg {...s}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>;
}
function ChartIcon() {
  return <svg {...s}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>;
}
function FolderIcon() {
  return <svg {...s}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>;
}
function BriefcaseIcon() {
  return <svg {...s}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>;
}
function TagIcon() {
  return <svg {...s}><path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9z" /><circle cx="7.5" cy="7.5" r="1.2" /></svg>;
}
function UsersIcon() {
  return <svg {...s}><circle cx="9" cy="8" r="3.2" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M17 11a3 3 0 1 0 0-6M18 20a6.4 6.4 0 0 0-2-4.6" /></svg>;
}
function PlayIcon() {
  return <svg {...s}><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M10.5 9.5v5l4.5-2.5z" /></svg>;
}
function ShareIcon() {
  return <svg {...s}><circle cx="18" cy="5" r="2.6" /><circle cx="6" cy="12" r="2.6" /><circle cx="18" cy="19" r="2.6" /><path d="M8.4 10.8 15.6 6.4M8.4 13.2l7.2 4.4" /></svg>;
}
function ChevronIcon({ className = "" }: { className?: string }) {
  return <svg {...s} width={13} height={13} className={`shrink-0 transition-transform duration-150 ${className}`}><path d="m6 9 6 6 6-6" /></svg>;
}
function CheckIcon() {
  return <svg {...s} width={14} height={14} className="shrink-0 text-[var(--accent)]"><path d="m20 6-11 11-5-5" /></svg>;
}
