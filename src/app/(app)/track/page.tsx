import TimerBar from "@/components/TimerBar";
import EntryList from "@/components/EntryList";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import type { Project, Task, TimeEntry } from "@/lib/types";

const ENTRY_SELECT = `
  id, workspace_id, user_id, project_id, task_id, description,
  started_at, ended_at, duration_seconds, is_billable,
  project:projects(id, name, color, client:clients(id, name)),
  task:tasks(id, name)
`;

export default async function TrackPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;

  const [projectsRes, tasksRes, runningRes, entriesRes] = await Promise.all([
    supabase
      .from("projects")
      .select("id, workspace_id, client_id, name, color, is_billable, is_archived, client:clients(id, name)")
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
      .from("time_entries")
      .select(ENTRY_SELECT)
      .eq("workspace_id", ws)
      .eq("user_id", session.userId)
      .is("ended_at", null)
      .maybeSingle(),
    supabase
      .from("time_entries")
      .select(ENTRY_SELECT)
      .eq("workspace_id", ws)
      .eq("user_id", session.userId)
      .not("ended_at", "is", null)
      .order("started_at", { ascending: false })
      .limit(100),
  ]);

  const projects = (projectsRes.data ?? []) as unknown as Project[];
  const tasks = (tasksRes.data ?? []) as unknown as Task[];
  const running = (runningRes.data ?? null) as unknown as TimeEntry | null;
  const entries = (entriesRes.data ?? []) as unknown as TimeEntry[];

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      {/* Keyed so the bar remounts when the running entry changes, letting its
          state seed from props without a syncing effect. */}
      <TimerBar
        key={running?.id ?? "idle"}
        workspaceId={ws}
        projects={projects}
        tasks={tasks}
        running={running}
      />
      <EntryList entries={entries} workspaceId={ws} />
    </div>
  );
}
