import PageHeader from "@/components/PageHeader";
import TimesheetGrid from "@/components/TimesheetGrid";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { addDays, startOfWeek } from "@/lib/format";
import type { Project, Task, TimeEntry } from "@/lib/types";

export default async function TimesheetPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;

  const params = await searchParams;
  const anchor = params.week ? new Date(`${params.week}T00:00:00`) : new Date();
  const weekStart = startOfWeek(Number.isNaN(anchor.getTime()) ? new Date() : anchor);
  const weekEnd = addDays(weekStart, 7);

  const [entriesRes, projectsRes, tasksRes] = await Promise.all([
    supabase
      .from("time_entries")
      .select(
        `id, workspace_id, user_id, project_id, task_id, description,
         started_at, ended_at, duration_seconds, is_billable,
         project:projects(id, name, color, client:clients(id, name)),
         task:tasks(id, name)`,
      )
      .eq("workspace_id", ws)
      .eq("user_id", session.userId)
      .gte("started_at", weekStart.toISOString())
      .lt("started_at", weekEnd.toISOString())
      .not("ended_at", "is", null),
    supabase
      .from("projects")
      .select(
        "id, workspace_id, client_id, name, color, is_billable, is_archived, client:clients(id, name)",
      )
      .eq("workspace_id", ws)
      .eq("is_archived", false)
      .order("name"),
    supabase
      .from("tasks")
      .select("id, workspace_id, project_id, name, status, is_archived")
      .eq("workspace_id", ws)
      .eq("is_archived", false)
      .order("name"),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <PageHeader
        title="Timesheet"
        subtitle="Weekly view of your tracked time, grouped by project and task."
      />
      <TimesheetGrid
        weekStartIso={weekStart.toISOString()}
        entries={(entriesRes.data ?? []) as unknown as TimeEntry[]}
        projects={(projectsRes.data ?? []) as unknown as Project[]}
        tasks={(tasksRes.data ?? []) as unknown as Task[]}
        workspaceId={ws}
      />
    </div>
  );
}
