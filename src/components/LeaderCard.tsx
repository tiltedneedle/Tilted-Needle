"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, Trophy, Eye } from "lucide-react";
import Avatar from "@/components/Avatar";
import {
  LEADER_WINDOWS,
  type LeaderWindow,
  type Leaderboards,
} from "@/lib/leaderboards";

const TOP_N = 3;

/**
 * A leaderboard card: top three, the rest behind a disclosure, and a window
 * switch in the corner.
 *
 * The window switch is deliberately tiny and unlabelled beyond "7d / 30d /
 * 90d / All". It is a lens on one card, not a page filter, and anything
 * larger would compete with the heading for the same two inches.
 *
 * Switching costs no round trip: every window is computed server-side and
 * shipped together, because the expensive half is a workspace read that is
 * already cached and shared with /content.
 */
export default function LeaderCard({
  kind,
  data,
}: {
  kind: "credits" | "views";
  data: Leaderboards;
}) {
  const [win, setWin] = useState<LeaderWindow>("all");
  const [expanded, setExpanded] = useState(false);

  const rows = data[win][kind];
  const shown = expanded ? rows : rows.slice(0, TOP_N);
  const rest = Math.max(0, rows.length - TOP_N);

  const Icon = kind === "credits" ? Trophy : Eye;
  const title = kind === "credits" ? "Most credited" : "Most viewed";

  return (
    <div className="card animate-rise flex flex-col p-4">
      <div className="mb-3 flex items-center gap-2">
        <Icon size={15} className="text-[var(--muted)]" />
        <span className="text-sm font-semibold">{title}</span>
        <div className="flex-1" />
        {/* Corner lens. role=group rather than a radiogroup: these are
            view options on one card, not a form value being submitted. */}
        <div
          className="flex items-center gap-0.5 rounded-full p-0.5"
          style={{ background: "var(--bg-subtle)" }}
          role="group"
          aria-label={`Time window for ${title}`}
        >
          {LEADER_WINDOWS.map((w) => (
            <button
              key={w.key}
              onClick={() => setWin(w.key)}
              aria-pressed={win === w.key}
              className="rounded-full px-1.5 py-0.5 text-[11px] font-medium transition-colors"
              style={{
                background: win === w.key ? "var(--accent)" : "transparent",
                color: win === w.key ? "var(--accent-fg)" : "var(--muted)",
              }}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-[var(--muted)]">
          {kind === "credits"
            ? "Nobody is credited on a video in this window."
            : "No views recorded in this window."}
        </p>
      ) : (
        <>
          <div className="space-y-2.5">
            {shown.map((p) => (
              <Link
                key={p.userId}
                href={`/content?person=${p.userId}`}
                className="group flex items-center gap-2.5"
              >
                <Avatar name={p.name} seed={p.userId} size={26} />
                <span className="min-w-0 flex-1 truncate text-sm transition-colors group-hover:text-[var(--accent)]">
                  {p.name}
                </span>
                <span className="tabular text-sm font-semibold">
                  {kind === "credits" ? (
                    <>
                      {p.videos}
                      <span className="ml-1 text-xs font-normal text-[var(--muted)]">
                        video{p.videos === 1 ? "" : "s"}
                      </span>
                    </>
                  ) : (
                    <>
                      {p.views >= 1000
                        ? `${(p.views / 1000).toFixed(p.views >= 10000 ? 0 : 1)}k`
                        : p.views}
                      <span className="ml-1 text-xs font-normal text-[var(--muted)]">
                        views
                      </span>
                    </>
                  )}
                </span>
              </Link>
            ))}
          </div>

          {rest > 0 && (
            <button
              className="mt-3 flex items-center gap-1 self-start text-xs text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
            >
              {expanded ? "Show less" : `Show ${rest} more`}
              <ChevronDown
                size={12}
                className={`transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
              />
            </button>
          )}
        </>
      )}

      {/* Says what the number IS, because "most credited" and "most viewed"
          are volume and reach -- neither is a judgement of quality, and the
          card should not be read as one. */}
      <p className="mt-3 text-[11px] leading-snug text-[var(--muted)]">
        {kind === "credits"
          ? "Videos worked on. Volume, not quality."
          : "Peak views per video, added up. Never summed across platforms."}
      </p>
    </div>
  );
}
