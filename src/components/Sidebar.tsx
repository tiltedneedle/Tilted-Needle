"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { switchWorkspace, signOut } from "@/app/actions";
import type { WorkspaceSummary } from "@/lib/workspace";

/**
 * A client user is an external party. They get one destination; every other
 * route would 404 or come back empty under the Phase 5 policies anyway, and
 * showing links to pages they cannot open reads as broken.
 */
const CLIENT_NAV = [
  {
    group: "Your account",
    items: [{ href: "/portal", label: "Overview", icon: ChartIcon }],
  },
];

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
      { href: "/performance", label: "Performance", icon: TrophyIcon },
      { href: "/accounts", label: "Accounts", icon: ShareIcon },
    ],
  },
  {
    group: "Billing",
    items: [
      { href: "/invoices", label: "Invoices", icon: InvoiceIcon },
      { href: "/expenses", label: "Expenses", icon: ReceiptIcon },
      { href: "/rates", label: "Rates", icon: RateIcon },
    ],
  },
  {
    group: "Team",
    items: [
      { href: "/approvals", label: "Approvals", icon: ApprovalIcon },
      { href: "/time-off", label: "Time off", icon: CalendarIcon },
    ],
  },
  {
    group: "Manage",
    items: [
      { href: "/projects", label: "Projects", icon: FolderIcon },
      { href: "/clients", label: "Clients", icon: BriefcaseIcon },
      { href: "/tags", label: "Tags", icon: TagIcon },
      { href: "/team", label: "Team", icon: UsersIcon },
      { href: "/kiosks", label: "Kiosks", icon: KioskIcon },
    ],
  },
  {
    group: "Admin",
    items: [
      { href: "/import", label: "Import", icon: ImportIcon },
      { href: "/developers", label: "Developers", icon: CodeIcon },
      { href: "/audit-log", label: "Audit log", icon: ShieldIcon },
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
        {(active.role === "client" ? CLIENT_NAV : NAV).map((section, i) => (
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
function InvoiceIcon() {
  return <svg {...s}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></svg>;
}
function ReceiptIcon() {
  return <svg {...s}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h4" /></svg>;
}
function RateIcon() {
  return <svg {...s}><circle cx="12" cy="12" r="9" /><path d="M14.5 9.2a2.6 2.6 0 0 0-2.5-1.4c-1.5 0-2.4.8-2.4 1.9 0 2.6 5.1 1.4 5.1 4 0 1.2-1 2.1-2.7 2.1a2.9 2.9 0 0 1-2.7-1.5M12 6.2v11.6" /></svg>;
}
function TrophyIcon() {
  return <svg {...s}><path d="M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M7 6H4.5v1.5A3.5 3.5 0 0 0 8 11M17 6h2.5v1.5A3.5 3.5 0 0 1 16 11" /><path d="M12 14v3M9 20h6M10 17h4" /></svg>;
}
function ShareIcon() {
  return <svg {...s}><circle cx="18" cy="5" r="2.6" /><circle cx="6" cy="12" r="2.6" /><circle cx="18" cy="19" r="2.6" /><path d="M8.4 10.8 15.6 6.4M8.4 13.2l7.2 4.4" /></svg>;
}
function KioskIcon() {
  return <svg {...s}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 18h6M9 7h6v6H9z" /></svg>;
}
function ImportIcon() {
  return <svg {...s}><path d="M12 3v12M7 10l5 5 5-5" /><path d="M4 19h16" /></svg>;
}
function CodeIcon() {
  return <svg {...s}><path d="m9 8-4 4 4 4M15 8l4 4-4 4" /></svg>;
}
function ShieldIcon() {
  return <svg {...s}><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="m9 12 2 2 4-4" /></svg>;
}
function CalendarIcon() {
  return <svg {...s}><rect x="3.5" y="4.5" width="17" height="16" rx="2" /><path d="M3.5 9.5h17M8 3v3M16 3v3" /></svg>;
}
function ApprovalIcon() {
  return <svg {...s}><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.3 2.3L15.7 9.6" /></svg>;
}
function ChevronIcon({ className = "" }: { className?: string }) {
  return <svg {...s} width={13} height={13} className={`shrink-0 transition-transform duration-150 ${className}`}><path d="m6 9 6 6 6-6" /></svg>;
}
function CheckIcon() {
  return <svg {...s} width={14} height={14} className="shrink-0 text-[var(--accent)]"><path d="m20 6-11 11-5-5" /></svg>;
}
