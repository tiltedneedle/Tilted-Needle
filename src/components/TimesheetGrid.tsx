"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import ProjectPicker, { type Selection } from "@/components/ProjectPicker";
import { createManualEntry, submitTimesheet } from "@/app/actions";
import {
  addDays,
  dayKey,
  entrySeconds,
  formatDurationShort,
  parseDuration,
} from "@/lib/format";
import type { Project, Task, TimeEntry } from "@/lib/types";

/** One grid row: a project+task pair with a cell per weekday. */
type RowKey = string;

function rowKeyFor(projectId: string | null, taskId: string | null): RowKey {
  return `${projectId ?? "none"}::${taskId ?? "none"}`;
}

type Submission = { id: string; status: string; review_note: string | null } | null;

export default function TimesheetGrid({
  weekStartIso,
  entries,
  projects,
  tasks,
  workspaceId,
  periodStart,
  periodEnd,
  submission,
}: {
  weekStartIso: string;
  entries: TimeEntry[];
  projects: Project[];
  tasks: Task[];
  workspaceId: string;
  periodStart: string;
  periodEnd: string;
  submission: Submission;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const locked = submission?.status === "approved";
  const [adding, setAdding] = useState<Selection>({
    projectId: null,
    taskId: null,
  });
  const [pendingCell, setPendingCell] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const weekStart = new Date(weekStartIso);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // Aggregate entries into project/task rows keyed by day.
  const rows = new Map<
    RowKey,
    {
      projectId: string | null;
      taskId: string | null;
      label: string;
      color: string;
      byDay: Map<string, number>;
    }
  >();

  for (const e of entries) {
    const key = rowKeyFor(e.project_id, e.task_id);
    if (!rows.has(key)) {
      rows.set(key, {
        projectId: e.project_id,
        taskId: e.task_id,
        label: e.project
          ? `${e.project.name}${e.task ? `: ${e.task.name}` : ""}`
          : "No project",
        color: e.project?.color ?? "var(--muted)",
        byDay: new Map(),
      });
    }
    const row = rows.get(key)!;
    const dk = dayKey(e.started_at);
    row.byDay.set(dk, (row.byDay.get(dk) ?? 0) + entrySeconds(e));
  }

  // A row added in this session before any time is logged against it.
  const pendingKey = rowKeyFor(adding.projectId, adding.taskId);
  if (adding.projectId && !rows.has(pendingKey)) {
    const p = projects.find((x) => x.id === adding.projectId);
    const t = tasks.find((x) => x.id === adding.taskId);
    rows.set(pendingKey, {
      projectId: adding.projectId,
      taskId: adding.taskId,
      label: p ? `${p.name}${t ? `: ${t.name}` : ""}` : "No project",
      color: p?.color ?? "var(--muted)",
      byDay: new Map(),
    });
  }

  const rowList = [...rows.entries()];
  const dayTotals = days.map((d) => {
    const dk = dayKey(d);
    return rowList.reduce((sum, [, r]) => sum + (r.byDay.get(dk) ?? 0), 0);
  });
  const weekTotal = dayTotals.reduce((a, b) => a + b, 0);

  async function commitCell(
    projectId: string | null,
    taskId: string | null,
    day: Date,
  ) {
    const seconds = parseDuration(draft);
    setPendingCell(null);
    setDraft("");
    if (!seconds) {
      if (draft.trim()) setError("Enter a duration like 1:30, 1.5 or 90m.");
      return;
    }
    setError(null);
    // Anchor at 9am local so the entry lands on the intended day regardless
    // of timezone, rather than at midnight where it could slip either side.
    const start = new Date(day);
    start.setHours(9, 0, 0, 0);
    const res = await createManualEntry({
      workspaceId,
      description: "",
      projectId,
      taskId,
      startedAt: start.toISOString(),
      endedAt: new Date(start.getTime() + seconds * 1000).toISOString(),
      isBillable: true,
    });
    if (res.error) return setError(res.error);
    startTransition(() => router.refresh());
  }

  const prevWeek = dayKey(addDays(weekStart, -7));
  const nextWeek = dayKey(addDays(weekStart, 7));

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link href={`/timesheet?week=${prevWeek}`} className="btn px-2.5 py-1.5">
          ‹
        </Link>
        <Link href="/timesheet" className="btn px-3 py-1.5">
          This week
        </Link>
        <Link href={`/timesheet?week=${nextWeek}`} className="btn px-2.5 py-1.5">
          ›
        </Link>
        <span className="ml-1 text-sm text-[var(--muted)]">
          {weekStart.toLocaleDateString([], { day: "numeric", month: "short" })} –{" "}
          {addDays(weekStart, 6).toLocaleDateString([], {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </span>
        <div className="flex-1" />
        <span className="text-sm">
          Week total{" "}
          <span className="tabular font-semibold">
            {formatDurationShort(weekTotal)}
          </span>
        </span>

        {/* Approving a week is what actually locks it (via is_period_locked
            in RLS) -- this button and badge are the front end of that,
            not a separate source of truth. */}
        {submission?.status === "approved" ? (
          <span className="rounded bg-emerald-500/15 px-2 py-1 text-xs text-emerald-500">
            Approved — locked
          </span>
        ) : submission?.status === "submitted" ? (
          <span className="rounded bg-amber-500/15 px-2 py-1 text-xs text-amber-500">
            Submitted, awaiting review
          </span>
        ) : (
          <button
            className="btn px-2.5 py-1.5 text-xs"
            disabled={submitting || weekTotal === 0}
            onClick={async () => {
              setSubmitting(true);
              const res = await submitTimesheet({ workspaceId, periodStart, periodEnd });
              setSubmitting(false);
              if (res.error) return setError(res.error);
              startTransition(() => router.refresh());
            }}
          >
            {submitting ? "Submitting…" : "Submit for approval"}
          </button>
        )}
      </div>

      {submission?.status === "rejected" && submission.review_note && (
        <p className="mb-2 rounded-md border border-[var(--danger)]/25 bg-[var(--danger-100)] px-3 py-2 text-sm text-[var(--danger)]">
          Rejected: {submission.review_note}
        </p>
      )}

      {error && (
        <p className="mb-2 text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}

      {locked && (
        <p className="mb-2 text-xs text-[var(--muted)]">
          This week is approved and locked. Entries cannot be added or edited
          here until a manager reopens it.
        </p>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]">
              <th className="px-3 py-2 text-left font-medium">Project</th>
              {days.map((d) => (
                <th key={d.toISOString()} className="px-2 py-2 text-center font-medium">
                  <div>{d.toLocaleDateString([], { weekday: "short" })}</div>
                  <div className="text-[11px] normal-case opacity-70">
                    {d.getDate()}
                  </div>
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-[var(--border)]">
            {rowList.length === 0 && (
              <tr>
                <td
                  colSpan={9}
                  className="px-3 py-10 text-center text-sm text-[var(--muted)]"
                >
                  Nothing tracked this week. Pick a project below to start filling
                  the grid.
                </td>
              </tr>
            )}

            {rowList.map(([key, row]) => {
              const rowTotal = [...row.byDay.values()].reduce((a, b) => a + b, 0);
              return (
                <tr key={key} className="transition-colors hover:bg-[var(--bg-subtle)]">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: row.color }}
                      />
                      <span className="truncate">{row.label}</span>
                    </div>
                  </td>

                  {days.map((d) => {
                    const dk = dayKey(d);
                    const cellId = `${key}|${dk}`;
                    const secs = row.byDay.get(dk) ?? 0;
                    return (
                      <td key={dk} className="px-1 py-1 text-center">
                        {pendingCell === cellId ? (
                          <input
                            autoFocus
                            className="input tabular w-[68px] px-1 py-1 text-center"
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={() => void commitCell(row.projectId, row.taskId, d)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter")
                                void commitCell(row.projectId, row.taskId, d);
                              if (e.key === "Escape") {
                                setPendingCell(null);
                                setDraft("");
                              }
                            }}
                          />
                        ) : (
                          <button
                            className="tabular w-[68px] rounded px-1 py-1.5 transition-colors enabled:hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-70"
                            disabled={locked}
                            title={locked ? "This week is approved and locked." : undefined}
                            onClick={() => {
                              if (locked) return;
                              setPendingCell(cellId);
                              setDraft("");
                            }}
                          >
                            {secs ? formatDurationShort(secs) : (
                              <span className="text-[var(--muted)]">–</span>
                            )}
                          </button>
                        )}
                      </td>
                    );
                  })}

                  <td className="tabular px-3 py-2 text-right font-medium">
                    {rowTotal ? formatDurationShort(rowTotal) : "–"}
                  </td>
                </tr>
              );
            })}
          </tbody>

          <tfoot>
            <tr className="border-t border-[var(--border)] font-medium">
              <td className="px-3 py-2 text-[var(--muted)]">Total</td>
              {dayTotals.map((t, i) => (
                <td key={i} className="tabular px-1 py-2 text-center">
                  {t ? formatDurationShort(t) : "–"}
                </td>
              ))}
              <td className="tabular px-3 py-2 text-right">
                {formatDurationShort(weekTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {!locked && (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-sm text-[var(--muted)]">Add row:</span>
          <ProjectPicker
            projects={projects}
            tasks={tasks}
            value={adding}
            onChange={setAdding}
          />
        </div>
      )}
    </>
  );
}
