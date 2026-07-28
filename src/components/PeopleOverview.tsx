"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatDurationShort } from "@/lib/format";
import { datedName, downloadCsv, toCsv } from "@/lib/exportCsv";
import { asMultiplier, tierFor, TIER_LABELS, type Tier } from "@/lib/scoring";
import { PLATFORM_COLORS } from "@/lib/types";
import { Empty, SectionHeading } from "@/components/Stat";
import type { PeopleOverview as Data } from "@/lib/dashboards";

const TIER_CLASS: Record<Tier, string> = {
  top: "text-emerald-500",
  above: "text-emerald-400",
  at: "text-[var(--muted)]",
  below: "text-amber-500",
  insufficient: "text-[var(--muted)] opacity-70",
};

const SORTS = [
  { key: "score", label: "Score" },
  { key: "name", label: "Name" },
  { key: "workload", label: "Workload" },
  { key: "week", label: "This week" },
  { key: "time", label: "Hours" },
] as const;
type SortKey = (typeof SORTS)[number]["key"];

/**
 * One row per person per content role, because a single blended score across
 * roles is exactly the number this product refuses to present. Sample size
 * travels with every score so a 1.8x from two posts cannot be read as
 * equivalent to a 1.8x from twenty.
 */
function exportPeople(rows: Data["people"]) {
  const out: unknown[][] = [];
  for (const p of rows) {
    const base = [p.name, p.workspaceRole, p.seat, p.isActive ? "active" : "deactivated",
      p.groups.join(" / "), p.videoCount, p.ongoingCount,
      (p.trackedSeconds / 3600).toFixed(2), (p.secondsThisWeek / 3600).toFixed(2),
      p.capacityHours];
    if (p.byRole.length === 0) {
      out.push([...base, "", "", "", ""]);
      continue;
    }
    for (const r of p.byRole) {
      const n = r.platforms.reduce((s, x) => s + x.n, 0);
      out.push([
        ...base,
        r.roleName,
        r.overall != null ? asMultiplier(r.overall).toFixed(2) : "",
        n,
        r.platforms.map((x) => `${x.platform}:${x.rankable ? asMultiplier(x.score).toFixed(2) : "n/a"}`).join(" "),
      ]);
    }
  }
  downloadCsv(
    datedName("people"),
    toCsv(
      ["Name", "Workspace role", "Seat", "Status", "Groups", "Videos", "Ongoing",
        "Hours tracked", "Hours this week", "Weekly capacity", "Content role",
        "Overall", "Sample size", "Per platform"],
      out,
    ),
  );
}

/**
 * Hours logged this week against the weekly capacity. Over-capacity is
 * flagged amber rather than red: it is a signal worth seeing, not an error,
 * and a red row for someone who worked a long week reads as an accusation.
 */
function Utilisation({
  seconds,
  capacityHours,
}: {
  seconds: number;
  capacityHours: number;
}) {
  const hours = seconds / 3600;
  if (!Number.isFinite(capacityHours) || capacityHours <= 0) {
    return (
      <span className="tabular text-xs text-[var(--muted)]">
        {hours > 0 ? `${hours.toFixed(1)}h` : "—"}
      </span>
    );
  }
  const pct = (hours / capacityHours) * 100;
  const over = pct > 100;
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span className="tabular text-xs">
        {hours.toFixed(1)}
        <span className="text-[var(--muted)]">/{capacityHours}h</span>
      </span>
      <span
        className="h-1 w-16 overflow-hidden rounded-full bg-[var(--bg-subtle)]"
        title={`${pct.toFixed(0)}% of weekly capacity`}
      >
        <span
          className={`block h-full rounded-full transition-[width] duration-500 ${
            over ? "bg-amber-500" : "bg-[var(--accent)]"
          }`}
          style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
        />
      </span>
    </span>
  );
}

export default function PeopleOverview({ data }: { data: Data }) {
  const [sort, setSort] = useState<SortKey>("score");

  const rows = useMemo(() => {
    const list = [...data.people];
    if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "workload") list.sort((a, b) => b.ongoingCount - a.ongoingCount);
    else if (sort === "week") list.sort((a, b) => b.secondsThisWeek - a.secondsThisWeek);
    else if (sort === "time") list.sort((a, b) => b.trackedSeconds - a.trackedSeconds);
    else list.sort((a, b) => (b.overall ?? -99) - (a.overall ?? -99));
    return list;
  }, [data.people, sort]);

  return (
    <>
      {/* Ranking is always within a single content role -- an editor is only
          ever compared to other editors, never to a videographer. */}
      {data.roleBoards.length > 0 && (
        <section className="mb-7">
          <SectionHeading
            title="Ranking by role"
            note="Compared only against others in the same role"
          />
          <div className="grid gap-2.5 sm:grid-cols-2">
            {data.roleBoards.map((board) => (
              <div key={board.roleName} className="card overflow-hidden">
                <div className="border-b border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-1.5 text-xs font-semibold">
                  {board.roleName}
                </div>
                <div className="divide-y divide-[var(--border)]">
                  {board.rows.map((r, i) => {
                    const tier = tierFor(r.overall ?? 0, r.overall != null);
                    return (
                      <div key={r.userId} className="flex items-center gap-2 px-3 py-2">
                        <span className="tabular w-4 shrink-0 text-xs text-[var(--muted)]">
                          {i + 1}
                        </span>
                        <Link
                          href={`/team?person=${r.userId}`}
                          className="min-w-0 flex-1 truncate text-sm transition-colors hover:text-[var(--accent)]"
                        >
                          {r.name}
                        </Link>
                        <span className={`text-xs ${TIER_CLASS[tier]}`}>
                          {TIER_LABELS[tier]}
                        </span>
                        <span className="tabular w-14 shrink-0 text-right text-sm">
                          {r.overall != null ? `${asMultiplier(r.overall).toFixed(2)}×` : "—"}
                        </span>
                        <span className="w-10 shrink-0 text-right text-xs text-[var(--muted)]">
                          n={r.n}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionHeading title={`Everyone (${rows.length})`}>
          <div className="flex flex-wrap items-center gap-1">
            <button
              className="mr-1 rounded px-2 py-0.5 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--fg)]"
              onClick={() => exportPeople(rows)}
              title="Download exactly what is on screen, filters included"
            >
              Export CSV
            </button>
            {SORTS.map((s) => (
              <button
                key={s.key}
                className={`rounded px-2 py-0.5 text-xs transition-colors ${
                  sort === s.key
                    ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                    : "text-[var(--muted)] hover:bg-[var(--border)]"
                }`}
                onClick={() => setSort(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </SectionHeading>

        {rows.length === 0 ? (
          <Empty>Nobody to show.</Empty>
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Content roles</th>
                    <th className="px-3 py-2 text-right font-medium">Overall</th>
                    <th className="px-3 py-2 text-right font-medium">Videos</th>
                    <th className="px-3 py-2 text-right font-medium">Ongoing</th>
                    <th className="px-3 py-2 text-right font-medium">This week</th>
                    <th className="px-3 py-2 text-right font-medium">Hours</th>
                    <th className="px-3 py-2 text-right font-medium">Reach</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {rows.map((p) => (
                    <tr
                      key={p.userId}
                      className="transition-colors hover:bg-[var(--bg-subtle)]"
                    >
                      <td className="px-3 py-2.5">
                        <Link
                          href={`/team?person=${p.userId}`}
                          className={`font-medium transition-colors hover:text-[var(--accent)] ${
                            p.isActive ? "" : "line-through opacity-60"
                          }`}
                        >
                          {p.name}
                        </Link>
                        <div className="mt-0.5 flex flex-wrap gap-1 text-[11px] text-[var(--muted)]">
                          <span className="capitalize">{p.workspaceRole}</span>
                          {p.groups.map((g) => (
                            <span
                              key={g}
                              className="rounded bg-[var(--bg-subtle)] px-1 py-px"
                            >
                              {g}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-[var(--muted)]">
                        {p.roles.join(", ") || "—"}
                      </td>
                      <td className="tabular px-3 py-2.5 text-right">
                        {p.overall != null ? `${asMultiplier(p.overall).toFixed(2)}×` : "—"}
                      </td>
                      <td className="tabular px-3 py-2.5 text-right">{p.videoCount}</td>
                      <td className="tabular px-3 py-2.5 text-right">
                        {p.ongoingCount > 0 ? (
                          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-500">
                            {p.ongoingCount}
                          </span>
                        ) : (
                          <span className="text-[var(--muted)]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Utilisation
                          seconds={p.secondsThisWeek}
                          capacityHours={p.capacityHours}
                        />
                      </td>
                      <td className="tabular px-3 py-2.5 text-right text-[var(--muted)]">
                        {p.trackedSeconds ? formatDurationShort(p.trackedSeconds) : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="flex flex-wrap justify-end gap-1">
                          {p.totals.length === 0 ? (
                            <span className="text-xs text-[var(--muted)]">—</span>
                          ) : (
                            p.totals.map((t) => (
                              <span
                                key={t.platform}
                                className="flex items-center gap-1 rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-xs"
                                title={`${t.platform}: ${t.views.toLocaleString()} views on credited content`}
                              >
                                <span
                                  className="size-1.5 rounded-full"
                                  style={{
                                    background:
                                      PLATFORM_COLORS[t.platform] ?? "var(--muted)",
                                  }}
                                />
                                <span className="tabular">
                                  {t.views.toLocaleString()}
                                </span>
                              </span>
                            ))
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <p className="mt-1.5 text-xs text-[var(--muted)]">
          Reach is the reach of content a person is credited on — shared with
          everyone else credited on it, not their individual contribution.
          Ongoing counts credited content not yet posted anywhere. “This week”
          is hours logged since Monday, against their weekly capacity.
        </p>
      </section>
    </>
  );
}
