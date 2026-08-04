import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { canManage } from "@/lib/types";
import { dayKey, formatDuration, formatDurationShort } from "@/lib/format";
import type { TimeEntry } from "@/lib/types";

function monthRange(monthParam?: string) {
  const now = new Date();
  const base = monthParam ? new Date(`${monthParam}-01T00:00:00`) : now;
  const anchor = Number.isNaN(base.getTime()) ? now : base;
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
  return { start, end };
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; scope?: string }>;
}) {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;
  const params = await searchParams;

  const { start, end } = monthRange(params.month);
  // Managers can widen scope to the whole team; members always see themselves.
  const teamScope = params.scope === "team" && canManage(session.active.role);

  let query = supabase
    .from("time_entries")
    .select(
      `id, user_id, project_id, task_id, description, started_at, ended_at,
       duration_seconds, is_billable,
       project:projects(id, name, color, client:clients(id, name)),
       task:tasks(id, name)`,
    )
    .eq("workspace_id", ws)
    .gte("started_at", start.toISOString())
    .lt("started_at", end.toISOString())
    .not("ended_at", "is", null);

  if (!teamScope) query = query.eq("user_id", session.userId);

  const { data } = await query;
  const entries = (data ?? []) as unknown as TimeEntry[];

  const total = entries.reduce((s, e) => s + (e.duration_seconds ?? 0), 0);

  // Breakdown by project, and by client, and the most-tracked activities panel.
  const byProject = new Map<string, { name: string; color: string; secs: number }>();
  const byClient = new Map<string, number>();
  const byActivity = new Map<string, { label: string; sub: string; secs: number }>();

  for (const e of entries) {
    const secs = e.duration_seconds ?? 0;
    const pName = e.project?.name ?? "No project";
    const pKey = e.project?.id ?? "none";
    const cur = byProject.get(pKey) ?? {
      name: pName,
      color: e.project?.color ?? "var(--muted)",
      secs: 0,
    };
    cur.secs += secs;
    byProject.set(pKey, cur);

    const cName = e.project?.client?.name ?? "—";
    byClient.set(cName, (byClient.get(cName) ?? 0) + secs);

    // Activity = description + project:task, matching the Clockify panel.
    const label = e.description?.trim() || "No description";
    const sub = e.project
      ? `${e.project.name}${e.task ? `: ${e.task.name}` : ""}`
      : "No project";
    const aKey = `${label}|${sub}`;
    const a = byActivity.get(aKey) ?? { label, sub, secs: 0 };
    a.secs += secs;
    byActivity.set(aKey, a);
  }

  const projectRows = [...byProject.values()].sort((a, b) => b.secs - a.secs);
  const topProject = projectRows[0]?.name ?? "—";
  const topClient =
    [...byClient.entries()].sort((a, b) => b[1] - a[1]).filter(([n]) => n !== "—")[0]?.[0] ??
    "—";
  const activities = [...byActivity.values()].sort((a, b) => b.secs - a.secs).slice(0, 10);

  // Daily bars.
  const days: { key: string; label: string; secs: number }[] = [];
  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    days.push({ key: dayKey(d), label: String(d.getDate()), secs: 0 });
  }
  const dayIndex = new Map(days.map((d, i) => [d.key, i]));
  for (const e of entries) {
    const i = dayIndex.get(dayKey(e.started_at));
    if (i !== undefined) days[i].secs += e.duration_seconds ?? 0;
  }
  const maxDay = Math.max(1, ...days.map((d) => d.secs));

  const prev = new Date(start);
  prev.setMonth(prev.getMonth() - 1);
  const next = new Date(start);
  next.setMonth(next.getMonth() + 1);

  const scopeQs = teamScope ? "&scope=team" : "";

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <PageHeader title="Dashboard">
        <Link href={`/dashboard?month=${monthKey(prev)}${scopeQs}`} className="btn px-2.5 py-1.5">
          ‹
        </Link>
        <span className="min-w-[120px] text-center text-sm">
          {start.toLocaleDateString([], { month: "long", year: "numeric" })}
        </span>
        <Link href={`/dashboard?month=${monthKey(next)}${scopeQs}`} className="btn px-2.5 py-1.5">
          ›
        </Link>
        {canManage(session.active.role) && (
          <Link
            href={`/dashboard?month=${monthKey(start)}${teamScope ? "" : "&scope=team"}`}
            className="btn"
          >
            {teamScope ? "Team" : "Only me"}
          </Link>
        )}
      </PageHeader>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-[var(--muted)]">
            Total time
          </div>
          <div className="tabular mt-1 text-2xl font-semibold">
            {formatDuration(total)}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-[var(--muted)]">
            Top project
          </div>
          <div className="mt-1 truncate text-2xl font-semibold">{topProject}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-[var(--muted)]">
            Top client
          </div>
          <div className="mt-1 truncate text-2xl font-semibold">{topClient}</div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="card p-4">
          <div className="mb-3 text-sm font-medium">Daily activity</div>
          <div className="flex h-44 items-end gap-[3px]">
            {days.map((d) => (
              <div key={d.key} className="group relative flex-1" title={`${d.label}: ${formatDurationShort(d.secs)}`}>
                <div
                  className="w-full rounded-t bg-[var(--accent)] transition-[height] duration-300"
                  style={{
                    height: `${Math.round((d.secs / maxDay) * 160)}px`,
                    minHeight: d.secs ? 2 : 0,
                  }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-[var(--muted)]">
            <span>{days[0]?.label}</span>
            <span>{days[days.length - 1]?.label}</span>
          </div>

          <div className="mt-5 space-y-1.5">
            {projectRows.length === 0 && (
              <p className="py-6 text-center text-sm text-[var(--muted)]">
                No time tracked this month.
              </p>
            )}
            {projectRows.map((p) => (
              <div key={p.name} className="flex items-center gap-3 text-sm">
                <span className="w-40 truncate">{p.name}</span>
                <span className="tabular w-20 text-right text-[var(--muted)]">
                  {formatDuration(p.secs)}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--bg-subtle)]">
                  <div
                    className="h-full rounded-full transition-[width] duration-500"
                    style={{
                      width: `${total ? (p.secs / total) * 100 : 0}%`,
                      background: p.color,
                    }}
                  />
                </div>
                <span className="tabular w-14 text-right text-xs text-[var(--muted)]">
                  {total ? ((p.secs / total) * 100).toFixed(2) : "0.00"}%
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-4">
          <div className="mb-3 text-sm font-medium">Most tracked activities</div>
          {activities.length === 0 && (
            <p className="py-6 text-center text-sm text-[var(--muted)]">Nothing yet.</p>
          )}
          <div className="space-y-2.5">
            {activities.map((a) => (
              <div key={`${a.label}|${a.sub}`} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{a.label}</div>
                  <div className="truncate text-xs text-[var(--muted)]">{a.sub}</div>
                </div>
                <div className="tabular shrink-0 text-sm">{formatDuration(a.secs)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Browser-tab identity; the root layout template appends the app name. */
export const metadata = { title: "Hours" };
