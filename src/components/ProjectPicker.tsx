"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Project, Task } from "@/lib/types";

export type Selection = { projectId: string | null; taskId: string | null };

export default function ProjectPicker({
  projects,
  tasks,
  value,
  onChange,
  compact = false,
}: {
  projects: Project[];
  tasks: Task[];
  value: Selection;
  onChange: (next: Selection) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selectedProject = projects.find((p) => p.id === value.projectId) ?? null;
  const selectedTask = tasks.find((t) => t.id === value.taskId) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.client?.name?.toLowerCase().includes(q),
    );
  }, [projects, query]);

  const label = selectedProject
    ? selectedTask
      ? `${selectedProject.name}: ${selectedTask.name}`
      : selectedProject.name
    : "Project";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-md border border-transparent px-2 py-1.5 text-sm transition-colors hover:border-[var(--border)] hover:bg-[var(--bg-subtle)] ${
          selectedProject ? "" : "text-[var(--muted)]"
        } ${compact ? "max-w-[180px]" : "max-w-[260px]"}`}
      >
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ background: selectedProject?.color ?? "var(--muted)" }}
        />
        <span className="truncate">{label}</span>
      </button>

      {open && (
        <div className="animate-pop panel-shadow absolute left-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--panel)]">
          <div className="border-b border-[var(--border)] p-2">
            <input
              autoFocus
              className="input py-1 text-sm"
              placeholder="Search projects…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="max-h-72 overflow-y-auto py-1">
            <button
              type="button"
              className="w-full px-3 py-1.5 text-left text-sm text-[var(--muted)] transition-colors hover:bg-[var(--bg-subtle)]"
              onClick={() => {
                onChange({ projectId: null, taskId: null });
                setOpen(false);
              }}
            >
              No project
            </button>

            {filtered.length === 0 && (
              <div className="px-3 py-4 text-center text-sm text-[var(--muted)]">
                No projects found
              </div>
            )}

            {filtered.map((p) => {
              const projectTasks = tasks.filter(
                (t) => t.project_id === p.id && !t.is_archived,
              );
              return (
                <div key={p.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--bg-subtle)]"
                    onClick={() => {
                      onChange({ projectId: p.id, taskId: null });
                      setOpen(false);
                    }}
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: p.color }}
                    />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    {p.client?.name && (
                      <span className="shrink-0 truncate text-xs text-[var(--muted)]">
                        {p.client.name}
                      </span>
                    )}
                  </button>

                  {projectTasks.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="w-full py-1 pl-9 pr-3 text-left text-sm text-[var(--muted)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)]"
                      onClick={() => {
                        onChange({ projectId: p.id, taskId: t.id });
                        setOpen(false);
                      }}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
