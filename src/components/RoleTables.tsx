"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import Avatar from "@/components/Avatar";
import PlatformIcon from "@/components/PlatformIcon";
import { formatCount } from "@/lib/format";
import { PLATFORM_LABEL } from "@/lib/types";
import type { RoleTable } from "@/lib/reports";

/**
 * Who does best at what, one board per role.
 *
 * Collapsed to headings by default and mounted only when opened -- five
 * boards expanded at once buries the video list the page is actually for, and
 * the question "who is the best editor" is asked one role at a time.
 *
 * WHAT THESE RANK BY, and why it is not views. Rows sort on videos, then
 * likes, then comments. Likes and comments are summable across platforms; a
 * view is not the same event on TikTok as on YouTube, and pooling them into a
 * single "views" column would produce an authoritative-looking number that
 * means nothing. So views appear per platform as chips and never as a rank.
 * If someone wants a views ranking, the platform filter is the honest way to
 * ask for it -- it reduces the question to one unit.
 *
 * People with no credit in a role are absent, not zero. A videographer is not
 * a bad editor; they are not an editor.
 */
export default function RoleTables({
  tables,
  highlightUserIds = [],
  scopeNote,
}: {
  tables: RoleTable[];
  /** People chosen in the filters; their rows are marked, not isolated. */
  highlightUserIds?: string[];
  /** What population these describe, stated on screen rather than assumed. */
  scopeNote?: string;
}) {
  const [openSection, setOpenSection] = useState(false);

  if (tables.length === 0) return null;
  const highlight = new Set(highlightUserIds);
  const people = new Set(tables.flatMap((t) => t.rows.map((r) => r.userId))).size;
  const marked = tables.reduce(
    (n, t) => n + t.rows.filter((r) => highlight.has(r.userId)).length,
    0,
  );

  /**
   * The SECTION collapses too, not only each role inside it.
   *
   * Five roles collapsed is still five rows of chrome carrying no numbers --
   * a block of headings between the stat cards and the video list, permanently
   * in the way of the thing most people came to read. Closed by default for
   * the same reason each role is: this answers a question you ask
   * occasionally, and it should cost one click to ask rather than a scroll
   * past it every time.
   *
   * The heading keeps its counts while closed, so the section still says what
   * it holds -- a disclosure that hides how much is behind it just makes
   * people open it to find out.
   */
  return (
    <section className="mb-7">
      <button
        type="button"
        className="mb-2 flex w-full flex-wrap items-baseline gap-2 text-left"
        onClick={() => setOpenSection((v) => !v)}
        aria-expanded={openSection}
      >
        <ChevronDown
          size={14}
          className={`shrink-0 self-center text-[var(--muted)] transition-transform duration-150 ${
            openSection ? "rotate-0" : "-rotate-90"
          }`}
        />
        <h2 className="text-sm font-semibold">Who does best, by role</h2>
        <span className="text-xs text-[var(--muted)]">
          {tables.length} role{tables.length === 1 ? "" : "s"} · {people} person
          {people === 1 ? "" : "s"}
          {marked > 0 ? ` · ${marked} in view` : ""}
        </span>
        {scopeNote && (
          <span className="ml-auto text-xs text-[var(--muted)]">{scopeNote}</span>
        )}
      </button>
      {openSection && (
        <div className="animate-rise space-y-2">
          {tables.map((t) => (
            <RoleCard key={t.roleSlug} table={t} highlight={highlight} />
          ))}
        </div>
      )}
    </section>
  );
}

function RoleCard({ table, highlight }: { table: RoleTable; highlight: Set<string> }) {
  const [open, setOpen] = useState(false);
  // Worth surfacing on the closed heading: otherwise every collapsed card
  // looks identical and you have to open all five to find the populated one.
  const marked = table.rows.filter((r) => highlight.has(r.userId)).length;

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-[var(--bg-subtle)]"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <ChevronDown
          size={14}
          className={`shrink-0 text-[var(--muted)] transition-transform duration-150 ${
            open ? "rotate-0" : "-rotate-90"
          }`}
        />
        <span className="text-sm font-medium">{table.roleName}</span>
        <span className="text-xs text-[var(--muted)]">
          {table.rows.length === 0
            ? "nobody credited here"
            : `${table.rows.length} ${table.rows.length === 1 ? "person" : "people"}`}
        </span>
        {marked > 0 && (
          <span className="rounded-full bg-[var(--accent)]/15 px-1.5 py-0.5 text-[11px] font-medium text-[var(--accent)]">
            {marked} selected
          </span>
        )}
      </button>

      {/* Body is not in the DOM until opened -- five boards' worth of rows
          rendered invisibly is a cost paid on every page load for nothing. */}
      {open && (
        <div className="border-t border-[var(--border)]">
          {table.rows.length === 0 ? (
            <p className="px-3 py-4 text-xs text-[var(--muted)]">
              No one is credited in this role on the videos currently in view.
            </p>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {table.rows.map((r, i) => {
                const on = highlight.has(r.userId);
                return (
                  <div
                    key={r.userId}
                    className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 ${
                      on ? "bg-[var(--accent)]/[0.07]" : ""
                    }`}
                  >
                    <span className="tabular w-5 shrink-0 text-xs text-[var(--muted)]">
                      {i + 1}
                    </span>
                    <Avatar name={r.name} seed={r.userId} size={22} />
                    <span
                      className={`min-w-0 flex-1 truncate text-sm ${on ? "font-semibold" : ""}`}
                    >
                      {r.name}
                    </span>
                    <span className="tabular shrink-0 text-xs text-[var(--muted)]">
                      {r.videosInView} video{r.videosInView === 1 ? "" : "s"}
                    </span>
                    {/* Per platform, never pooled. */}
                    <span className="flex shrink-0 flex-wrap justify-end gap-1">
                      {r.platforms.map((p) => (
                        <span
                          key={p.platform}
                          className="flex items-center gap-1 rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-xs"
                          title={`${PLATFORM_LABEL[p.platform] ?? p.platform}: ${p.views.toLocaleString()} views, ${p.likes.toLocaleString()} likes, ${p.comments.toLocaleString()} comments`}
                        >
                          <PlatformIcon platform={p.platform} size={11} />
                          <span className="tabular">{formatCount(p.views)}</span>
                        </span>
                      ))}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
