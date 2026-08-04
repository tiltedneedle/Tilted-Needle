import PageHeader from "@/components/PageHeader";
import ReportView from "@/components/ReportView";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { canManage } from "@/lib/types";
import { addDays, startOfWeek } from "@/lib/format";
import type { Client, Project, TimeEntry } from "@/lib/types";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    client?: string;
    project?: string;
    scope?: string;
  }>;
}) {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;
  const params = await searchParams;

  const defaultFrom = startOfWeek(new Date());
  const from = params.from ? new Date(`${params.from}T00:00:00`) : defaultFrom;
  const to = params.to
    ? addDays(new Date(`${params.to}T00:00:00`), 1)
    : addDays(defaultFrom, 7);

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
    .gte("started_at", from.toISOString())
    .lt("started_at", to.toISOString())
    .not("ended_at", "is", null);

  if (!teamScope) query = query.eq("user_id", session.userId);
  if (params.project) query = query.eq("project_id", params.project);

  const [entriesRes, projectsRes, clientsRes] = await Promise.all([
    query,
    supabase
      .from("projects")
      .select(
        "id, workspace_id, client_id, name, color, is_billable, is_archived, client:clients(id, name)",
      )
      .eq("workspace_id", ws)
      .order("name"),
    supabase
      .from("clients")
      .select("id, workspace_id, name, email, is_archived")
      .eq("workspace_id", ws)
      .order("name"),
  ]);

  let entries = (entriesRes.data ?? []) as unknown as TimeEntry[];

  // Client filter is applied here because PostgREST cannot filter on a nested
  // relation without an inner join that would drop entries with no project.
  if (params.client) {
    entries =
      params.client === "none"
        ? entries.filter((e) => !e.project?.client)
        : entries.filter((e) => e.project?.client?.id === params.client);
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <PageHeader title="Reports" />
      <ReportView
        entries={entries}
        projects={(projectsRes.data ?? []) as unknown as Project[]}
        clients={(clientsRes.data ?? []) as unknown as Client[]}
        canSeeTeam={canManage(session.active.role)}
        initial={{
          from: params.from ?? toInput(from),
          to: params.to ?? toInput(addDays(to, -1)),
          client: params.client ?? "",
          project: params.project ?? "",
          scope: teamScope ? "team" : "me",
        }}
      />
    </div>
  );
}

function toInput(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Browser-tab identity; the root layout template appends the app name. */
export const metadata = { title: "Reports" };
