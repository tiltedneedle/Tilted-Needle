"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import Select from "@/components/ui/Select";
import { dayKey, formatDuration, formatDurationShort } from "@/lib/format";
import type { Client, Project, TimeEntry } from "@/lib/types";

type GroupBy = "project" | "client" | "description" | "task" | "day";

const GROUPS: { value: GroupBy; label: string }[] = [
  { value: "project", label: "Project" },
  { value: "client", label: "Client" },
  { value: "description", label: "Description" },
  { value: "task", label: "Task" },
  { value: "day", label: "Date" },
];

function keyOf(e: TimeEntry, by: GroupBy): string {
  switch (by) {
    case "project":
      return e.project?.name ?? "No project";
    case "client":
      return e.project?.client?.name ?? "Without client";
    case "description":
      return e.description?.trim() || "Without description";
    case "task":
      return e.task?.name ?? "No task";
    case "day":
      return dayKey(e.started_at);
  }
}

export default function ReportView({
  entries,
  projects,
  clients,
  canSeeTeam,
  initial,
}: {
  entries: TimeEntry[];
  projects: Project[];
  clients: Client[];
  canSeeTeam: boolean;
  initial: {
    from: string;
    to: string;
    client: string;
    project: string;
    scope: string;
  };
}) {
  const router = useRouter();

  // Draft filter state. Nothing re-queries until APPLY FILTER is pressed --
  // these queries are expensive and Clockify behaves the same way (PRD 7.3).
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [client, setClient] = useState(initial.client);
  const [project, setProject] = useState(initial.project);
  const [scope, setScope] = useState(initial.scope);

  const [primary, setPrimary] = useState<GroupBy>("project");
  const [secondary, setSecondary] = useState<GroupBy | "none">("description");

  const dirty =
    from !== initial.from ||
    to !== initial.to ||
    client !== initial.client ||
    project !== initial.project ||
    scope !== initial.scope;

  function apply() {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    if (client) qs.set("client", client);
    if (project) qs.set("project", project);
    if (scope === "team") qs.set("scope", "team");
    router.push(`/reports?${qs.toString()}`);
  }

  const total = entries.reduce((s, e) => s + (e.duration_seconds ?? 0), 0);

  const grouped = useMemo(() => {
    const top = new Map<string, { secs: number; sub: Map<string, number> }>();
    for (const e of entries) {
      const k = keyOf(e, primary);
      const node = top.get(k) ?? { secs: 0, sub: new Map<string, number>() };
      const secs = e.duration_seconds ?? 0;
      node.secs += secs;
      if (secondary !== "none") {
        const sk = keyOf(e, secondary);
        node.sub.set(sk, (node.sub.get(sk) ?? 0) + secs);
      }
      top.set(k, node);
    }
    return [...top.entries()].sort((a, b) => b[1].secs - a[1].secs);
  }, [entries, primary, secondary]);

  function exportCsv() {
    const rows = [
      ["Group", "Subgroup", "Duration (h)", "Seconds"],
      ...grouped.flatMap(([k, node]) =>
        secondary === "none"
          ? [[k, "", (node.secs / 3600).toFixed(2), String(node.secs)]]
          : [...node.sub.entries()].map(([sk, s]) => [
              k,
              sk,
              (s / 3600).toFixed(2),
              String(s),
            ]),
      ),
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `report-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="card mb-4 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-[var(--muted)]">
            From
            <input
              type="date"
              className="input mt-1"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="text-xs text-[var(--muted)]">
            To
            <input
              type="date"
              className="input mt-1"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>

          <label className="text-xs text-[var(--muted)]">
            Client
            {/* "Without client" is a REAL third choice here, not the
                absence of a filter, so it stays an explicit option while the
                clear row carries "All clients". */}
            <Select
              className="mt-1 min-w-[150px]"
              value={client}
              onChange={setClient}
              placeholder="All clients"
              ariaLabel="Client"
              options={[
                { value: "none", label: "Without client" },
                ...clients
                  .filter((c) => !c.is_archived)
                  .map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
          </label>

          <label className="text-xs text-[var(--muted)]">
            Project
            <Select
              className="mt-1 min-w-[150px]"
              value={project}
              onChange={setProject}
              placeholder="All projects"
              ariaLabel="Project"
              options={projects
                .filter((p) => !p.is_archived)
                .map((p) => ({ value: p.id, label: p.name }))}
            />
          </label>

          {canSeeTeam && (
            <label className="text-xs text-[var(--muted)]">
              Scope
              <Select
                className="mt-1 min-w-[120px]"
                value={scope}
                onChange={(v) => v && setScope(v)}
                placeholder="Only me"
                ariaLabel="Scope"
                options={[
                  { value: "me", label: "Only me" },
                  { value: "team", label: "Team" },
                ]}
              />
            </label>
          )}

          <div className="flex-1" />

          <button
            className={dirty ? "btn-primary" : "btn"}
            onClick={apply}
            title={dirty ? "Filters changed" : "Re-run report"}
          >
            Apply filter
          </button>
          <button className="btn" onClick={exportCsv}>
            Export CSV
          </button>
        </div>
      </div>

      <div className="card mb-4 flex flex-wrap items-center gap-3 p-3">
        <span className="text-sm text-[var(--muted)]">Total</span>
        <span className="tabular text-xl font-semibold">{formatDuration(total)}</span>
        <div className="flex-1" />
        <label className="text-xs text-[var(--muted)]">
          Group by
          <Select
            className="mt-1 min-w-[130px]"
            value={primary}
            onChange={(v) => v && setPrimary(v as GroupBy)}
            placeholder={GROUPS[0]?.label ?? "Group by"}
            ariaLabel="Group by"
            options={GROUPS.map((g) => ({ value: g.value, label: g.label }))}
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Then by
          {/* "None" is a real choice, not the absence of one, so it is an
              explicit option AND the clear row maps onto it -- an empty
              value would otherwise write "" into a field typed GroupBy. */}
          <Select
            className="mt-1 min-w-[130px]"
            value={secondary}
            onChange={(v) => setSecondary((v || "none") as GroupBy | "none")}
            placeholder="None"
            ariaLabel="Then by"
            options={GROUPS.filter((g) => g.value !== primary).map((g) => ({
              value: g.value,
              label: g.label,
            }))}
          />
        </label>
      </div>

      <div className="card divide-y divide-[var(--border)] overflow-hidden">
        {grouped.length === 0 && (
          <div className="p-10 text-center text-sm text-[var(--muted)]">
            No time entries match these filters.
          </div>
        )}

        {grouped.map(([k, node]) => (
          <div key={k}>
            <div className="flex items-center gap-3 px-3 py-2.5">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{k}</span>
              <div className="h-1.5 w-32 overflow-hidden rounded-full bg-[var(--bg-subtle)]">
                <div
                  className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500"
                  style={{ width: `${total ? (node.secs / total) * 100 : 0}%` }}
                />
              </div>
              <span className="tabular w-12 text-right text-xs text-[var(--muted)]">
                {total ? ((node.secs / total) * 100).toFixed(1) : "0.0"}%
              </span>
              <span className="tabular w-20 text-right text-sm font-medium">
                {formatDuration(node.secs)}
              </span>
            </div>

            {secondary !== "none" && node.sub.size > 0 && (
              <div className="bg-[var(--bg-subtle)] px-3 pb-2">
                {[...node.sub.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([sk, s]) => (
                    <div
                      key={sk}
                      className="flex items-center gap-3 py-1 pl-4 text-sm text-[var(--muted)]"
                    >
                      <span className="min-w-0 flex-1 truncate">{sk}</span>
                      <span className="tabular shrink-0">{formatDurationShort(s)}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
