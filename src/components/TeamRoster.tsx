"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { asMultiplier } from "@/lib/scoring";
import type { RosterRow } from "@/lib/performanceData";

const SORTS = [
  { key: "overall", label: "Score" },
  { key: "name", label: "Name" },
  { key: "workload", label: "Workload" },
] as const;
type SortKey = (typeof SORTS)[number]["key"];

export default function TeamRoster({ rows }: { rows: RosterRow[] }) {
  const [sort, setSort] = useState<SortKey>("overall");

  const sorted = useMemo(() => {
    const copy = [...rows];
    if (sort === "name") copy.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "workload") copy.sort((a, b) => b.ongoingCount - a.ongoingCount);
    else copy.sort((a, b) => (b.overall ?? -99) - (a.overall ?? -99));
    return copy;
  }, [rows, sort]);

  return (
    <section className="mt-8">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Team</h2>
        <div className="flex gap-1">
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
              Sort by {s.label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card p-8 text-center text-sm text-[var(--muted)]">
          No active members yet.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Roles</th>
                <th className="px-3 py-2 text-right font-medium">Overall</th>
                <th className="px-3 py-2 text-right font-medium">Videos</th>
                <th className="px-3 py-2 text-right font-medium">Ongoing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {sorted.map((r) => (
                <tr key={r.userId} className="transition-colors hover:bg-[var(--bg-subtle)]">
                  <td className="px-3 py-2.5">
                    <Link
                      href={`/performance?person=${r.userId}`}
                      className="font-medium transition-colors hover:text-[var(--accent)]"
                    >
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-[var(--muted)]">
                    {r.roles.join(", ") || "—"}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right">
                    {r.overall != null ? `${asMultiplier(r.overall).toFixed(2)}×` : "—"}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right">{r.contentCount}</td>
                  <td className="tabular px-3 py-2.5 text-right">
                    {r.ongoingCount > 0 ? (
                      <span className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5">
                        {r.ongoingCount}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-1.5 text-xs text-[var(--muted)]">
        Ongoing = credited on content that hasn&apos;t been posted anywhere yet.
      </p>
    </section>
  );
}
