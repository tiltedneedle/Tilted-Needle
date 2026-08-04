import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import NewModuleForm from "@/components/NewModuleForm";
import { Empty } from "@/components/Stat";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { canManage, type TrainingModule } from "@/lib/types";

/**
 * Training, the index: every course this person can see. For a member that
 * is exactly the modules a manager has assigned to them (RLS makes anything
 * else invisible, the page never filters); for a manager it is the whole
 * catalogue plus each module's headline progress.
 */
export default async function TrainingPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;
  const manages = canManage(session.active.role);

  const [modulesRes, videosRes, assignRes, doneRes] = await Promise.all([
    supabase
      .from("training_modules")
      .select("id, workspace_id, title, description, sort_order, is_archived")
      .eq("workspace_id", ws)
      .order("sort_order")
      .order("created_at"),
    supabase.from("training_videos").select("id, module_id").eq("workspace_id", ws),
    supabase
      .from("training_assignments")
      .select("module_id, user_id")
      .eq("workspace_id", ws),
    supabase
      .from("training_completions")
      .select("video_id, user_id")
      .eq("workspace_id", ws),
  ]);

  const modules = ((modulesRes.data ?? []) as TrainingModule[]).filter(
    (m) => manages || !m.is_archived,
  );
  const videosByModule = new Map<string, string[]>();
  for (const v of (videosRes.data ?? []) as { id: string; module_id: string }[]) {
    if (!videosByModule.has(v.module_id)) videosByModule.set(v.module_id, []);
    videosByModule.get(v.module_id)!.push(v.id);
  }
  const assignments = (assignRes.data ?? []) as { module_id: string; user_id: string }[];
  const doneByUser = new Map<string, Set<string>>();
  for (const c of (doneRes.data ?? []) as { video_id: string; user_id: string }[]) {
    if (!doneByUser.has(c.user_id)) doneByUser.set(c.user_id, new Set());
    doneByUser.get(c.user_id)!.add(c.video_id);
  }

  const active = modules.filter((m) => !m.is_archived);
  const archived = modules.filter((m) => m.is_archived);

  function progressFor(moduleId: string, userId: string) {
    const vids = videosByModule.get(moduleId) ?? [];
    const done = doneByUser.get(userId);
    return {
      total: vids.length,
      done: done ? vids.filter((v) => done.has(v)).length : 0,
    };
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <PageHeader
        title="Training"
        subtitle={
          manages
            ? "Courses for the team — build modules of videos, assign them, and watch completion."
            : "Your assigned courses. Videos unlock in order as you complete them."
        }
      />

      {manages && <NewModuleForm workspaceId={ws} />}

      {active.length === 0 ? (
        <Empty>
          {manages
            ? "No modules yet. Create the first course above."
            : "No training assigned to you yet."}
        </Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {active.map((m) => {
            const total = videosByModule.get(m.id)?.length ?? 0;
            const assigned = assignments.filter((a) => a.module_id === m.id);
            const finished = assigned.filter(
              (a) => total > 0 && progressFor(m.id, a.user_id).done === total,
            ).length;
            const mine = progressFor(m.id, session.userId);
            const mineAssigned = assigned.some((a) => a.user_id === session.userId);
            return (
              <Link
                key={m.id}
                href={`/training/${m.id}`}
                className="card card-interactive animate-rise flex flex-col gap-2 p-4"
              >
                <div className="text-sm font-semibold">{m.title}</div>
                {m.description && (
                  <p className="line-clamp-2 text-xs text-[var(--muted)]">{m.description}</p>
                )}
                <div className="mt-auto flex items-center gap-2 pt-1 text-xs text-[var(--muted)]">
                  <span className="tabular">
                    {total} video{total === 1 ? "" : "s"}
                  </span>
                  {manages && (
                    <span className="tabular">
                      · {assigned.length} assigned · {finished} finished
                    </span>
                  )}
                  {mineAssigned && (
                    <span
                      className={`pill ${
                        total > 0 && mine.done === total
                          ? "pill-success"
                          : mine.done > 0
                            ? "pill-coral"
                            : "pill-neutral"
                      } ml-auto`}
                    >
                      {total > 0 && mine.done === total
                        ? "Completed"
                        : mine.done > 0
                          ? `${mine.done}/${total}`
                          : "Not started"}
                    </span>
                  )}
                </div>
                {mineAssigned && total > 0 && (
                  <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-subtle)]">
                    <div
                      className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300"
                      style={{ width: `${(mine.done / total) * 100}%` }}
                    />
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {manages && archived.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-xs text-[var(--muted)]">
            {archived.length} archived module{archived.length === 1 ? "" : "s"}
          </summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {archived.map((m) => (
              <Link
                key={m.id}
                href={`/training/${m.id}`}
                className="card p-3 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--bg-subtle)]"
              >
                {m.title}
              </Link>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
