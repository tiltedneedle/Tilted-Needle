import { operatingZoneLabel } from "@/lib/tz";
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

  const periodStartKey = weekStart.toISOString().slice(0, 10);
  const periodEndKey = addDays(weekStart, 6).toISOString().slice(0, 10);

  const [entriesRes, projectsRes, tasksRes, submissionRes] = await Promise.all([
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
    supabase
      .from("timesheet_submissions")
      .select("id, status, review_note")
      .eq("workspace_id", ws)
      .eq("user_id", session.userId)
      .eq("period_start", periodStartKey)
      .maybeSingle(),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <PageHeader
        title="Timesheet"
        // The zone is named because the week is a SHARED boundary, not the
        // reader's. Someone in London seeing "Mon-Sun" has no way to know
        // whose Monday it is, and a week silently shown in another zone is how
        // an approval ends up covering hours the submitter filed elsewhere.
        subtitle={`Weekly view of your tracked time, grouped by project and task. Weeks run Mon–Sun in ${operatingZoneLabel()} time.`}
      />
      <TimesheetGrid
        weekStartIso={weekStart.toISOString()}
        entries={(entriesRes.data ?? []) as unknown as TimeEntry[]}
        projects={(projectsRes.data ?? []) as unknown as Project[]}
        tasks={(tasksRes.data ?? []) as unknown as Task[]}
        workspaceId={ws}
        periodStart={periodStartKey}
        periodEnd={periodEndKey}
        submission={
          submissionRes.data as { id: string; status: string; review_note: string | null } | null
        }
      />
    </div>
  );
}

/** Browser-tab identity; the root layout template appends the app name. */
export const metadata = { title: "Timesheet" };
