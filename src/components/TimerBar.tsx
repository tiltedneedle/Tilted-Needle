"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ProjectPicker, { type Selection } from "@/components/ProjectPicker";
import { startTimer, stopTimer, createManualEntry } from "@/app/actions";
import { formatDuration, parseDuration } from "@/lib/format";
import type { Project, Task, TimeEntry } from "@/lib/types";

export default function TimerBar({
  workspaceId,
  projects,
  tasks,
  running,
}: {
  workspaceId: string;
  projects: Project[];
  tasks: Task[];
  running: TimeEntry | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // Seeded from the running entry. The parent remounts this component when the
  // running entry changes (keyed on its id), so no syncing effect is needed.
  const [description, setDescription] = useState(running?.description ?? "");
  const [selection, setSelection] = useState<Selection>({
    projectId: running?.project_id ?? null,
    taskId: running?.task_id ?? null,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  const startedAt = running ? new Date(running.started_at).getTime() : null;

  // Tick a clock and derive elapsed from the server-supplied start time.
  // Counting up locally would drift in a backgrounded tab.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const elapsed =
    startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));

  async function onStart() {
    setBusy(true);
    setError(null);
    const res = await startTimer({
      workspaceId,
      description: description.trim(),
      projectId: selection.projectId,
      taskId: selection.taskId,
      isBillable: true,
    });
    setBusy(false);
    if (res.error) return setError(res.error);
    startTransition(() => router.refresh());
  }

  async function onStop() {
    if (!running) return;
    setBusy(true);
    setError(null);
    const res = await stopTimer(running.id);
    setBusy(false);
    if (res.error) return setError(res.error);
    setDescription("");
    setSelection({ projectId: null, taskId: null });
    startTransition(() => router.refresh());
  }

  // "1:30", "1.5", "90m" -> a completed entry ending now.
  async function onAddManual() {
    const seconds = parseDuration(manual);
    if (!seconds) return setError("Enter a duration like 1:30, 1.5 or 90m.");
    setBusy(true);
    setError(null);
    const end = new Date();
    const res = await createManualEntry({
      workspaceId,
      description: description.trim(),
      projectId: selection.projectId,
      taskId: selection.taskId,
      startedAt: new Date(end.getTime() - seconds * 1000).toISOString(),
      endedAt: end.toISOString(),
      isBillable: true,
    });
    setBusy(false);
    if (res.error) return setError(res.error);
    setManual("");
    setDescription("");
    setSelection({ projectId: null, taskId: null });
    startTransition(() => router.refresh());
  }

  const isRunning = !!running;

  return (
    <div className="card sticky top-0 z-20 mb-6 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input min-w-[200px] flex-1 border-transparent bg-transparent focus:border-[var(--border)]"
          placeholder="What are you working on?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isRunning) void onStart();
          }}
        />

        <ProjectPicker
          projects={projects}
          tasks={tasks}
          value={selection}
          onChange={setSelection}
        />

        <div className="h-6 w-px bg-[var(--border)]" />

        {!isRunning && (
          <input
            className="input w-24 border-transparent bg-transparent text-center tabular focus:border-[var(--border)]"
            placeholder="0:00"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void onAddManual();
            }}
            aria-label="Manual duration"
          />
        )}

        <div
          className={`tabular w-[92px] text-center text-lg font-semibold ${
            isRunning ? "text-[var(--accent)]" : "text-[var(--muted)]"
          }`}
        >
          {formatDuration(isRunning ? elapsed : 0)}
        </div>

        {isRunning ? (
          <button
            onClick={onStop}
            disabled={busy}
            className="btn-primary min-w-[84px]"
            style={{ background: "var(--danger)", color: "#fff" }}
          >
            Stop
          </button>
        ) : (
          <button
            onClick={manual.trim() ? onAddManual : onStart}
            disabled={busy}
            className="btn-primary min-w-[84px]"
          >
            {manual.trim() ? "Add" : "Start"}
          </button>
        )}
      </div>

      {error && (
        <p className="mt-2 px-1 text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
