"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  BarChart3,
  BookOpen,
  Briefcase,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Code2,
  CreditCard,
  FileText,
  Folder,
  Gauge,
  GraduationCap,
  Grid2x2,
  LayoutGrid,
  ListChecks,
  LogOut,
  Percent,
  PlayCircle,
  Receipt,
  RefreshCw,
  ShieldCheck,
  Tag,
  Upload,
  Users,
  Search as SearchIcon,
} from "lucide-react";
import Popover from "@/components/ui/Popover";
import type { ComponentType } from "react";
import { switchWorkspace, signOut } from "@/app/actions";
import ThemeToggle from "@/components/ui/ThemeToggle";
import GlassToggle from "@/components/ui/GlassToggle";
import type { WorkspaceSummary } from "@/lib/workspace";

type IconType = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;

/**
 * A client user is an external party. They get one destination; every other
 * route would 404 or come back empty under the Phase 5 policies anyway, and
 * showing links to pages they cannot open reads as broken.
 */
export const CLIENT_NAV = [
  {
    group: "Your account",
    items: [{ href: "/portal", label: "Overview", icon: BarChart3 as IconType }],
  },
];

/**
 * A plain member's nav mirrors exactly what the layout guard lets them
 * open -- their own day-to-day surface. Showing the manager dashboards
 * here would just bounce them back to Home.
 */
export const MEMBER_NAV = [
  {
    group: "My work",
    items: [
      { href: "/home", label: "Home", icon: LayoutGrid as IconType },
      { href: "/todos", label: "To-dos", icon: ListChecks as IconType },
      { href: "/training", label: "Training", icon: GraduationCap as IconType },
      { href: "/guidelines", label: "Guidelines", icon: BookOpen as IconType },
    ],
  },
  {
    group: "Time",
    items: [
      { href: "/track", label: "Time Tracker", icon: Clock as IconType },
      { href: "/timesheet", label: "Timesheet", icon: Grid2x2 as IconType },
      { href: "/dashboard", label: "Hours", icon: BarChart3 as IconType },
      { href: "/time-off", label: "Time off", icon: Calendar as IconType },
    ],
  },
];

/**
 * The dashboards lead, because they are what the tool is for. Content is THE
 * performance surface -- clients, people, and time ranges are all filters on
 * one view since the People merge (PRD v0.5); Clients drills the other way,
 * from one client down to one channel's own chart. Everything below them is
 * the supporting machinery that feeds them.
 */
/** Exported for the command palette, which is the same map with a keyboard. */
export const NAV = [
  {
    group: "Dashboards",
    items: [
      { href: "/home", label: "Home", icon: LayoutGrid as IconType },
      { href: "/content", label: "Content", icon: PlayCircle as IconType },
      { href: "/clients", label: "Clients", icon: Briefcase as IconType },
      // Sits with the dashboards rather than under Manage: it is read during
      // the work (an editor mid-timeline needs the CTA) not while configuring
      // the workspace, and it is scoped per client exactly like Clients is.
      { href: "/guidelines", label: "Guidelines", icon: BookOpen as IconType },
    ],
  },
  {
    // Approvals and Time off live here rather than in their own "Team"
    // group -- everything here is the same underlying concept anyway: a
    // person's own tracked hours and leave.
    group: "Track",
    items: [
      // First in the group: it is the first thing an employee opens each
      // morning -- "what am I doing today."
      { href: "/todos", label: "To-dos", icon: ListChecks as IconType },
      { href: "/training", label: "Training", icon: GraduationCap as IconType },
      { href: "/track", label: "Time Tracker", icon: Clock as IconType },
      { href: "/timesheet", label: "Timesheet", icon: Grid2x2 as IconType },
      { href: "/dashboard", label: "Hours", icon: Gauge as IconType },
      { href: "/reports", label: "Reports", icon: BarChart3 as IconType },
      // The client-facing document, as opposed to /reports which is the
      // internal analysis. It sat unreachable behind a typed URL until now.
      { href: "/reports/client", label: "Client report", icon: FileText as IconType },
      { href: "/approvals", label: "Approvals", icon: CheckCircle2 as IconType },
      { href: "/time-off", label: "Time off", icon: Calendar as IconType },
    ],
  },
  {
    group: "Billing",
    items: [
      { href: "/invoices", label: "Invoices", icon: Receipt as IconType },
      { href: "/expenses", label: "Expenses", icon: CreditCard as IconType },
      { href: "/rates", label: "Rates", icon: Percent as IconType },
    ],
  },
  {
    // Setup and configuration, folded into one group rather than split
    // across "Manage" and "Admin" -- neither name told you which of the
    // two an item like Kiosks or Developers belonged in.
    group: "Manage",
    items: [
      { href: "/team-admin", label: "Team admin", icon: Users as IconType },
      // Accounts folded into Data sync: one object, one screen. The route
      // still exists and redirects, because links to it are out there.
      { href: "/data", label: "Data sync", icon: RefreshCw as IconType },
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
  onNavigate,
}: {
  workspaces: WorkspaceSummary[];
  active: WorkspaceSummary;
  fullName: string;
  /** Set when rendered inside the mobile drawer, so tapping a link closes it. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  // Anchored to the BUTTON, not its wrapper: the wrapper carries p-3, so
  // measuring it would render the panel flush to the sidebar edges instead of
  // inset by 12px the way the original left-3/right-3 panel was.
  const switcherRef = useRef<HTMLButtonElement>(null);

  /* The nav is TALLER THAN THE VIEWPORT and nothing said so.
     Measured on a 1440x900 laptop: 1274px of navigation in a 637px column,
     so Billing and Manage -- eight destinations -- sat below the fold with
     no edge, no shadow and no scrollbar until the pointer entered. A menu
     that hides half of itself and looks complete is worse than a long one.
     A fade at whichever edge has more behind it is the smallest honest
     affordance; it disappears at the ends so it never lies about content
     that is not there. */
  const navRef = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const measure = () => {
      const more = el.scrollHeight - el.clientHeight;
      setEdges({
        top: el.scrollTop > 4,
        // 4px of slack: sub-pixel layout leaves a fraction of a pixel of
        // "scrollable" on containers that are actually full.
        bottom: more > 4 && el.scrollTop < more - 4,
      });
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, []);
  const closeSwitcher = useCallback(() => setOpen(false), []);

  return (
    <aside
      className="flex h-dvh w-60 shrink-0 flex-col"
      style={{ background: "var(--sidebar-bg)", color: "var(--sidebar-fg)" }}
    >
      {/* Workspace switcher: the team runs several workspaces, so this is a
          high-frequency control, not a settings-page afterthought (PRD 7.1). */}
      <div className="relative p-3">
        <button
          ref={switcherRef}
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
            style={{ color: "var(--sidebar-muted)" }}
          />
        </button>

        {open && (
          // The invisible full-screen backdrop that used to catch outside
          // clicks is gone: Popover handles that, and the backdrop sat at
          // z-10 where a portalled panel would have been above it anyway.
          <Popover
            anchorRef={switcherRef}
            onClose={closeSwitcher}
            matchWidth
            ariaLabel="Switch workspace"
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
                  {w.id === active.id && <Check size={14} style={{ color: "var(--sidebar-accent)" }} />}
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
          </Popover>
        )}
      </div>

      {/* The palette's visible door. The shortcut is the fast path, but a
          shortcut nobody can discover is a secret, not a feature -- this row
          is how anyone learns ⌘K exists. */}
      <div className="px-3 pb-1">
        <button
          onClick={() => window.dispatchEvent(new Event("tn:palette"))}
          className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-white/5"
          style={{ color: "var(--sidebar-muted)" }}
        >
          <SearchIcon size={14} className="shrink-0" />
          <span className="flex-1">Search</span>
          <kbd className="rounded border border-white/15 px-1.5 py-0.5 text-[10.5px]">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* Pointer-transparent, so the fade can never eat a click on the
            item it is drawing attention to. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-5 transition-opacity duration-200"
          style={{
            opacity: edges.top ? 1 : 0,
            background: "linear-gradient(to bottom, var(--sidebar-bg), transparent)",
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-6 transition-opacity duration-200"
          style={{
            opacity: edges.bottom ? 1 : 0,
            background: "linear-gradient(to top, var(--sidebar-bg), transparent)",
          }}
        />
      <nav ref={navRef} className="flex-1 overflow-y-auto px-3 pb-2">
        {(active.role === "client"
          ? CLIENT_NAV
          : active.role === "member"
            ? MEMBER_NAV
            : NAV
        ).map((section, i) => (
          <div key={i} className="mb-5">
            {section.group && (
              <div
                className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-wide"
                style={{ color: "var(--sidebar-muted)" }}
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
                  onClick={onNavigate}
                  className="relative mb-0.5 flex items-center gap-2.5 px-3 text-sm transition-colors"
                  style={{
                    height: 44,
                    borderRadius: "var(--radius-sm)",
                    color: isActive ? "var(--sidebar-fg)" : "var(--sidebar-muted)",
                    // A wash rather than a fill, and the accent rail below
                    // does the actual work of saying "you are here". A solid
                    // red block for every visited page would make the nav the
                    // loudest thing on screen, which it never is in a product
                    // that trusts you to know where you are.
                    // Derived from the token, not a literal. This was
                    // rgb(229 72 77 / 0.12) -- the pre-claret --red-bright --
                    // so the active nav wash kept pointing at the retired
                    // signal red after the palette moved, and matched neither
                    // accent token. A hardcoded colour cannot follow a rename.
                    background: isActive
                      ? "color-mix(in srgb, var(--sidebar-accent) 12%, transparent)"
                      : "transparent",
                    fontWeight: isActive ? 600 : 500,
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.background = "var(--on-dark-hover)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.background = "transparent";
                  }}
                >
                  {isActive && (
                    <span
                      className="absolute left-0 top-1/2 h-[18px] w-[3px] -translate-y-1/2 rounded-full"
                      style={{ background: "var(--sidebar-accent)" }}
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
      </div>

      <div className="p-3" style={{ borderTop: "1px solid var(--on-dark-active)" }}>
        <div className="mb-2 flex items-center justify-between px-2">
          <span
            className="text-[11px] font-medium uppercase tracking-wide"
            style={{ color: "var(--sidebar-muted)" }}
          >
            Theme
          </span>
          <ThemeToggle />
        </div>
        {/* Directly under Theme, because they are the same kind of decision --
            how the product looks to this person on this screen -- and someone
            who came here to turn the brightness down should not have to guess
            that transparency lives somewhere else. */}
        <div className="mb-2 flex items-center justify-between px-2">
          <span
            className="text-[11px] font-medium uppercase tracking-wide"
            style={{ color: "var(--sidebar-muted)" }}
          >
            Glass
          </span>
          <GlassToggle />
        </div>
        <div className="flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-2">
          <span
            className="grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold"
            style={{ background: "var(--charcoal-800)", color: "var(--white)" }}
          >
            {fullName.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-white">{fullName}</div>
            <div className="truncate text-xs capitalize" style={{ color: "var(--sidebar-muted)" }}>
              {active.role}
            </div>
          </div>
          <form action={signOut}>
            <button
              className="grid size-7 shrink-0 place-items-center rounded-md transition-colors hover:bg-white/10"
              style={{ color: "var(--sidebar-muted)" }}
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
