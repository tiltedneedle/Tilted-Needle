import PageHeader from "@/components/PageHeader";
import ProjectsManager from "@/components/ProjectsManager";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { canManage } from "@/lib/types";
import type { Client, Project, Task } from "@/lib/types";

export default async function ProjectsPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;

  const [projectsRes, tasksRes, clientsRes] = await Promise.all([
    supabase
      .from("projects")
      .select(
        "id, workspace_id, client_id, name, color, is_billable, is_archived, client:clients(id, name)",
      )
      .eq("workspace_id", ws)
      .order("name"),
    supabase
      .from("tasks")
      .select("id, workspace_id, project_id, name, status, is_archived")
      .eq("workspace_id", ws)
      .order("name"),
    supabase
      .from("clients")
      .select("id, workspace_id, name, email, is_archived").is("deleted_at", null)
      .eq("workspace_id", ws)
      .order("name"),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <PageHeader
        title="Projects"
        subtitle="Projects group tracked time. Tasks break them into production stages."
      />
      <ProjectsManager
        workspaceId={ws}
        projects={(projectsRes.data ?? []) as unknown as Project[]}
        tasks={(tasksRes.data ?? []) as unknown as Task[]}
        clients={(clientsRes.data ?? []) as unknown as Client[]}
        canManage={canManage(session.active.role)}
      />
    </div>
  );
}
