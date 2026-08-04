"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProject, createTask, setArchived } from "@/app/actions";
import type { Client, Project, Task } from "@/lib/types";

const COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444",
  "#f59e0b", "#10b981", "#06b6d4", "#3b82f6",
];

export default function ProjectsManager({
  workspaceId,
  projects,
  tasks,
  clients,
  canManage,
}: {
  workspaceId: string;
  projects: Project[];
  tasks: Task[];
  clients: Client[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState<string>("");
  const [color, setColor] = useState(COLORS[0]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [taskName, setTaskName] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects
      .filter((p) => (showArchived ? true : !p.is_archived))
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          p.client?.name?.toLowerCase().includes(q),
      );
  }, [projects, showArchived, query]);

  async function onCreate() {
    if (!name.trim()) return setError("Name is required.");
    setError(null);
    const res = await createProject({
      workspaceId,
      name,
      clientId: clientId || null,
      color,
      isBillable: true,
    });
    if (res.error) return setError(res.error);
    setName("");
    setClientId("");
    setAdding(false);
    startTransition(() => router.refresh());
  }

  async function onAddTask(projectId: string) {
    if (!taskName.trim()) return;
    const res = await createTask(workspaceId, projectId, taskName);
    if (res.error) return setError(res.error);
    setTaskName("");
    startTransition(() => router.refresh());
  }

  async function toggleArchive(p: Project) {
    const res = await setArchived("projects", p.id, !p.is_archived);
    if (res.error) setError(res.error);
    startTransition(() => router.refresh());
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="input max-w-xs"
          placeholder="Search projects…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {/* Active/Archived toggle mirrors the Clockify pickers (PRD 7.3). */}
        <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--muted)]">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived
        </label>
        <div className="flex-1" />
        {canManage && (
          <button className="btn-primary" onClick={() => setAdding((v) => !v)}>
            {adding ? "Cancel" : "New project"}
          </button>
        )}
      </div>

      {adding && (
        <div className="card animate-rise mb-3 flex flex-wrap items-center gap-2 p-3">
          <input
            autoFocus
            className="input max-w-xs"
            placeholder="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void onCreate()}
          />
          <select
            className="input max-w-[190px]"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            <option value="">No client</option>
            {clients
              .filter((c) => !c.is_archived)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
          <div className="flex items-center gap-1">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`size-5 rounded-full transition-transform ${
                  color === c ? "scale-110 ring-2 ring-offset-2 ring-offset-[var(--panel)]" : ""
                }`}
                style={{ background: c }}
                aria-label={`Colour ${c}`}
              />
            ))}
          </div>
          <button className="btn-primary" onClick={onCreate}>
            Create
          </button>
        </div>
      )}

      {error && (
        <p className="mb-3 text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}

      <div className="card divide-y divide-[var(--border)] overflow-hidden">
        {visible.length === 0 && (
          <div className="p-10 text-center text-sm text-[var(--muted)]">
            No projects yet.
          </div>
        )}

        {visible.map((p) => {
          const projectTasks = tasks.filter((t) => t.project_id === p.id);
          const isOpen = expanded === p.id;
          return (
            <div key={p.id}>
              <div className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--bg-subtle)]">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: p.color }}
                />
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setExpanded(isOpen ? null : p.id)}
                >
                  <span
                    className={`text-sm ${p.is_archived ? "line-through opacity-60" : ""}`}
                  >
                    {p.name}
                  </span>
                  {p.client?.name && (
                    <span className="ml-2 text-xs text-[var(--muted)]">
                      {p.client.name}
                    </span>
                  )}
                </button>
                <span className="shrink-0 text-xs text-[var(--muted)]">
                  {projectTasks.length} task{projectTasks.length === 1 ? "" : "s"}
                </span>
                {canManage && (
                  <button
                    className="row-actions rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--fg)]"
                    onClick={() => void toggleArchive(p)}
                  >
                    {p.is_archived ? "Restore" : "Archive"}
                  </button>
                )}
              </div>

              {isOpen && (
                <div className="animate-rise border-t border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2">
                  {projectTasks.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center gap-2 py-1 pl-5 text-sm text-[var(--muted)]"
                    >
                      <span className="size-1.5 rounded-full bg-[var(--muted)]" />
                      {t.name}
                    </div>
                  ))}
                  {canManage && (
                    <div className="mt-1 flex gap-2 pl-5">
                      <input
                        className="input max-w-xs py-1 text-sm"
                        placeholder="Add a task…"
                        value={taskName}
                        onChange={(e) => setTaskName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && void onAddTask(p.id)}
                      />
                      <button className="btn" onClick={() => void onAddTask(p.id)}>
                        Add
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
