"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import {
  BarChart3,
  Briefcase,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Code2,
  Folder,
  Grid2x2,
  LayoutGrid,
  LogOut,
  Percent,
  PlayCircle,
  Receipt,
  Share2,
  ShieldCheck,
  Tag,
  Trophy,
  Upload,
} from "lucide-react";
import type { ComponentType } from "react";
import { switchWorkspace, signOut } from "@/app/actions";
import type { WorkspaceSummary } from "@/lib/workspace";

type IconType = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;

/**
 * A client user is an external party. They get one destination; every other
 * route would 404 or come back empty under the Phase 5 policies anyway, and
 * showing links to pages they cannot open reads as broken.
 */
const CLIENT_NAV = [
  {
    group: "Your account",
    items: [{ href: "/portal", label: "Overview", icon: BarChart3 as IconType }],
  },
];

/**
 * The three dashboards lead, because they are what the tool is for. Content
 * and People each answer one question across everything; Clients drills the
 * other way, from one client down to one channel's own chart. Everything
 * below them is the supporting machinery that feeds them.
 */
const NAV = [
  {
    group: "Dashboards",
    items: [
      { href: "/content", label: "Content", icon: PlayCircle as IconType },
      { href: "/team", label: "People", icon: Trophy as IconType },
      { href: "/clients", label: "Clients", icon: Briefcase as IconType },
    ],
  },
  {
    // Approvals and Time off live here rather than in their own "Team"
    // group -- that name collided directly with People, the actual
    // employee dashboard, which sits one line above at a URL that is
    // literally /team. Everything here is the same underlying concept
    // anyway: a person's own tracked hours and leave.
    group: "Track",
    items: [
      { href: "/track", label: "Time Tracker", icon: Clock as IconType },
      { href: "/timesheet", label: "Timesheet", icon: Grid2x2 as IconType },
      { href: "/dashboard", label: "Hours", icon: LayoutGrid as IconType },
      { href: "/reports", label: "Reports", icon: BarChart3 as IconType },
      { href: "/approvals", label: "Approvals", icon: CheckCircle2 as IconType },
      { href: "/time-off", label: "Time off", icon: Calendar as IconType },
    ],
  },
  {
    group: "Billing",
    items: [
      { href: "/invoices", label: "Invoices", icon: Receipt as IconType },
      { href: "/expenses", label: "Expenses", icon: Receipt as IconType },
      { href: "/rates", label: "Rates", icon: Percent as IconType },
    ],
  },
  {
    // Setup and configuration, folded into one group rather than split
    // across "Manage" and "Admin" -- neither name told you which of the
    // two an item like Kiosks or Developers belonged in.
    group: "Manage",
    items: [
      { href: "/accounts", label: "Accounts", icon: Share2 as IconType },
      { href: "/projects", label: "Projects", icon: Folder as IconType },
      { href: "/tags", label: "Tags", icon: Tag as IconType },
      { href: "/kiosks", label: "Kiosks", icon: Grid2x2 as IconType },
      { href: "/import", label: "Import", icon: Upload as IconType },
      { href: "/developers", label: "Developers", icon: Code2 as IconType },
      { href: "/audit-log", label: "Audit log", icon: ShieldCheck as IconType },
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
    <aside
      className="flex h-dvh w-60 shrink-0 flex-col"
      style={{ background: "var(--charcoal-900)", color: "var(--white)" }}
    >
      {/* Workspace switcher: the team runs several workspaces, so this is a
          high-frequency control, not a settings-page afterthought (PRD 7.1). */}
      <div className="relative p-3">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-2 text-left transition-colors hover:bg-white/5"
          aria-expanded={open}
          aria-haspopup="listbox"
        >
          <span
            className="grid size-7 shrink-0 place-items-center rounded-lg text-[11px] font-semibold"
            style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
          >
            {active.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {active.name}
          </span>
          <ChevronDown
            size={14}
            className={`shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
            style={{ color: "var(--charcoal-400)" }}
          />
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div
              role="listbox"
              className="animate-pop absolute left-3 right-3 top-14 z-20 overflow-hidden py-1"
              style={{
                borderRadius: "var(--radius-sm)",
                background: "var(--panel)",
                boxShadow: "var(--shadow-card-hover)",
              }}
            >
              {workspaces.map((w) => (
                <button
                  key={w.id}
                  role="option"
                  aria-selected={w.id === active.id}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--fg)] transition-colors hover:bg-[var(--bg-subtle)]"
                  onClick={() => {
                    setOpen(false);
                    if (w.id !== active.id) {
                      startTransition(() => void switchWorkspace(w.id));
                    }
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{w.name}</span>
                  {w.id === active.id && <Check size={14} style={{ color: "var(--accent)" }} />}
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

      <nav className="flex-1 overflow-y-auto px-3 pb-2">
        {(active.role === "client" ? CLIENT_NAV : NAV).map((section, i) => (
          <div key={i} className="mb-5">
            {section.group && (
              <div
                className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-wide"
                style={{ color: "var(--charcoal-400)" }}
              >
                {section.group}
              </div>
            )}
            {section.items.map(({ href, label, icon: Icon }) => {
              const isActive = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  className="relative mb-0.5 flex items-center gap-2.5 px-3 text-sm transition-colors"
                  style={{
                    height: 44,
                    borderRadius: "var(--radius-sm)",
                    color: isActive ? "var(--white)" : "var(--charcoal-400)",
                    background: isActive ? "rgb(240 112 74 / 0.16)" : "transparent",
                    fontWeight: isActive ? 600 : 500,
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.background = "rgb(255 255 255 / 0.05)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.background = "transparent";
                  }}
                >
                  {isActive && (
                    <span
                      className="absolute left-0 top-1/2 h-[18px] w-[3px] -translate-y-1/2 rounded-full"
                      style={{ background: "var(--accent)" }}
                    />
                  )}
                  <Icon size={16} strokeWidth={1.8} />
                  {label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="p-3" style={{ borderTop: "1px solid rgb(255 255 255 / 0.08)" }}>
        <div className="flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-2">
          <span
            className="grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold"
            style={{ background: "var(--charcoal-800)", color: "var(--white)" }}
          >
            {fullName.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-white">{fullName}</div>
            <div className="truncate text-xs capitalize" style={{ color: "var(--charcoal-400)" }}>
              {active.role}
            </div>
          </div>
          <form action={signOut}>
            <button
              className="grid size-7 shrink-0 place-items-center rounded-md transition-colors hover:bg-white/10"
              style={{ color: "var(--charcoal-400)" }}
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut size={15} strokeWidth={1.8} />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
