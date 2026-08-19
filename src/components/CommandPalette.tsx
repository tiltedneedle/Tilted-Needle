"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, CornerDownLeft, PlayCircle, Search } from "lucide-react";
import { CLIENT_NAV, MEMBER_NAV, NAV } from "@/components/Sidebar";

/**
 * Jump to anything: ⌘K / Ctrl+K, type, Enter.
 *
 * The one flow a keyboard-first product owes its users. Twenty-plus routes,
 * ten clients and four hundred videos were each reachable only by their own
 * page's controls -- so "open the Entree report" was sidebar → Clients →
 * scan → click, four decisions for a destination the user could already
 * name. A palette makes naming it the whole interaction.
 *
 * Data arrives once per open from /api/palette (session-scoped, RLS does
 * the authz) and filters locally -- a few hundred names, so per-keystroke
 * network would buy latency and a rate-limit surface and nothing else.
 *
 * Deliberately NOT a fuzzy matcher. Substring matching is predictable:
 * every hit visibly contains what was typed, and with a corpus this small
 * clever ranking has nothing to add but surprises.
 */

type Item = {
  key: string;
  label: string;
  hint: string | null;
  href: string;
  kind: "page" | "client" | "video";
};

/* The same nav the sidebar would render for this role. Offering a member
   the manager's pages costs nothing at the server -- auth bounces them --
   but a jump list that names doors you cannot open is a worse experience
   than the sidebar it mirrors, and the two must not disagree. */
const pagesFor = (role: string): Item[] =>
  (role === "client" ? CLIENT_NAV : role === "member" ? MEMBER_NAV : NAV).flatMap((g) =>
    g.items.map((i) => ({
      key: `p:${i.href}`,
      label: i.label,
      hint: g.group,
      href: i.href,
      kind: "page" as const,
    })),
  );

export default function CommandPalette({ role = "owner" }: { role?: string }) {
  const PAGES = useMemo(() => pagesFor(role), [role]);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const [remote, setRemote] = useState<{ clients: Item[]; videos: Item[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  /* Open on ⌘K/Ctrl+K anywhere, and on the custom event the sidebar's
     search affordance fires -- one component, two doors in. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("tn:palette", onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("tn:palette", onOpen);
    };
  }, []);

  /* The workspace's names, fetched on first open and kept for the session.
     Stale-while-open is fine: a rename mid-palette is not a real scenario,
     and reopening refetches nothing because the names barely change. */
  useEffect(() => {
    if (!open || remote) return;
    let dead = false;
    fetch("/api/palette")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (dead || !d) return;
        setRemote({
          clients: (d.clients ?? []).map((c: { id: string; name: string }) => ({
            key: `c:${c.id}`,
            label: c.name,
            hint: "Client",
            href: `/clients/${c.id}`,
            kind: "client" as const,
          })),
          videos: (d.videos ?? []).map((v: { id: string; title: string; client: string | null }) => ({
            key: `v:${v.id}`,
            label: v.title,
            hint: v.client,
            href: `/content?video=${v.id}`,
            kind: "video" as const,
          })),
        });
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [open, remote]);

  useEffect(() => {
    if (open) {
      setQ("");
      setCursor(0);
      // After the portal paints.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = [...PAGES, ...(remote?.clients ?? []), ...(remote?.videos ?? [])];
    if (!needle) {
      // An empty query shows the places, not the library -- pages and
      // clients are a browsable dozen; four hundred videos are not.
      return [...PAGES, ...(remote?.clients ?? [])].slice(0, 12);
    }
    return all.filter((i) => i.label.toLowerCase().includes(needle)).slice(0, 12);
  }, [q, remote]);

  /* Typing reshapes the list, so the highlight resets to the top hit --
     without this it clings to whatever index it last held, which after a
     narrowing keystroke is a different, arbitrary row. */
  useEffect(() => setCursor(0), [q]);

  const go = useCallback(
    (item: Item) => {
      setOpen(false);
      router.push(item.href);
    },
    [router],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter" && results[cursor]) {
      e.preventDefault();
      go(results[cursor]);
    }
  };

  /* Keep the highlighted row in view while arrowing through. */
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  const ICON = { page: Search, client: Briefcase, video: PlayCircle } as const;

  return (
    <div
      className="fixed inset-0 flex items-start justify-center px-4 pt-[14vh]"
      style={{ zIndex: "var(--z-modal)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      {/* Same scrim recipe as the mobile drawer: a wash that pushes the page
          out of focus while leaving it legible as context. */}
      <div
        className="absolute inset-0"
        style={{
          background: "var(--scrim)",
          backdropFilter: "blur(3px)",
          WebkitBackdropFilter: "blur(3px)",
        }}
        onClick={() => setOpen(false)}
      />
      <div
        className="animate-pop relative w-full max-w-lg overflow-hidden rounded-[var(--radius)] border border-[var(--border)] shadow-[var(--shadow-overlay)]"
        style={{ background: "var(--bg-elevated)" }}
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--border)] px-4">
          <Search size={15} className="shrink-0 text-[var(--muted)]" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a page, client or video…"
            className="w-full bg-transparent py-3.5 text-sm outline-none placeholder:text-[var(--muted)]"
            aria-label="Search"
          />
          <kbd className="shrink-0 rounded border border-[var(--border)] px-1.5 py-0.5 text-[10.5px] text-[var(--muted)]">
            esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[46vh] overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-[var(--muted)]">
              Nothing matches &ldquo;{q}&rdquo;
              {!remote && " yet — still loading the workspace"}.
            </div>
          ) : (
            results.map((item, i) => {
              const Icon = ICON[item.kind];
              return (
                <button
                  key={item.key}
                  data-idx={i}
                  onClick={() => go(item)}
                  onMouseMove={() => setCursor(i)}
                  className={`flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-2 text-left text-sm transition-colors ${
                    i === cursor ? "bg-[var(--bg-subtle)]" : ""
                  }`}
                >
                  <Icon size={14} className="shrink-0 text-[var(--muted)]" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.hint && (
                    <span className="shrink-0 text-[11px] text-[var(--muted)]">{item.hint}</span>
                  )}
                  {i === cursor && (
                    <CornerDownLeft size={12} className="shrink-0 text-[var(--muted)]" />
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
