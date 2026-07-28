"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatDurationShort } from "@/lib/format";
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
  { key: "time", label: "Hours" },
] as const;
type SortKey = (typeof SORTS)[number]["key"];

export default function PeopleOverview({ data }: { data: Data }) {
  const [sort, setSort] = useState<SortKey>("score");
  const [showInactive, setShowInactive] = useState(false);

  const rows = useMemo(() => {
    let list = data.people.filter((p) => showInactive || p.isActive);
    list = [...list];
    if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "workload") list.sort((a, b) => b.ongoingCount - a.ongoingCount);
    else if (sort === "time") list.sort((a, b) => b.trackedSeconds - a.trackedSeconds);
    else list.sort((a, b) => (b.overall ?? -99) - (a.overall ?? -99));
    return list;
  }, [data.people, sort, showInactive]);

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
            <label className="mr-2 flex cursor-pointer items-center gap-1.5 text-xs text-[var(--muted)]">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
              />
              Show deactivated
            </label>
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
          Ongoing counts credited content not yet posted anywhere.
        </p>
      </section>
    </>
  );
}
