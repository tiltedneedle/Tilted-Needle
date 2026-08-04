"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";
import {
  addTrainingVideo,
  assignTraining,
  deleteTrainingModule,
  deleteTrainingVideo,
  moveTrainingVideo,
  resetTrainingProgress,
  unassignTraining,
  updateTrainingModule,
} from "@/app/actions";
import { SectionHeading } from "@/components/Stat";
import type { TrainingModule, TrainingVideo } from "@/lib/types";

type Assignment = { id: string; userId: string; name: string };
type Completion = { video_id: string; user_id: string; completed_at: string };
type Member = { userId: string; name: string };

/**
 * The management half of a module: build the video sequence, control who
 * the course is assigned to, and read everyone's progress. Only rendered
 * for managers -- and everything it calls is manager-gated by RLS anyway.
 */
export default function TrainingAdmin({
  workspaceId,
  module: mod,
  videos,
  assignments,
  completions,
  members,
}: {
  workspaceId: string;
  module: TrainingModule;
  videos: TrainingVideo[];
  assignments: Assignment[];
  completions: Completion[];
  members: Member[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [video, setVideo] = useState({ title: "", url: "" });
  const [assignee, setAssignee] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const refresh = () => startTransition(() => router.refresh());

  const unassigned = members.filter((m) => !assignments.some((a) => a.userId === m.userId));

  async function addVideo() {
    const res = await addTrainingVideo({
      workspaceId,
      moduleId: mod.id,
      title: video.title,
      youtubeUrl: video.url,
    });
    if (res.error) return setError(res.error);
    setError(null);
    setVideo({ title: "", url: "" });
    refresh();
  }

  async function addAssignee() {
    if (!assignee) return;
    const res = await assignTraining({ workspaceId, moduleId: mod.id, userId: assignee });
    if (res.error) return setError(res.error);
    setError(null);
    setAssignee("");
    refresh();
  }

  return (
    <div className="space-y-7">
      {error && (
        <p className="text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}

      {/* ---- Videos -------------------------------------------------------- */}
      <section>
        <SectionHeading
          title="Videos"
          note="The order here is the order employees must watch in"
        />
        <div className="card mb-2 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input min-w-[180px] flex-1 py-1.5"
              placeholder="Video title"
              value={video.title}
              onChange={(e) => setVideo({ ...video, title: e.target.value })}
            />
            <input
              className="input min-w-[220px] flex-1 py-1.5"
              placeholder="YouTube URL (watch, youtu.be, or Shorts link)"
              value={video.url}
              onChange={(e) => setVideo({ ...video, url: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addVideo();
              }}
            />
            <button
              className="btn-primary py-1.5"
              onClick={() => void addVideo()}
              disabled={!video.title.trim() || !video.url.trim()}
            >
              Add video
            </button>
          </div>
        </div>
        {videos.length > 0 && (
          <div className="card divide-y divide-[var(--border)] overflow-hidden">
            {videos.map((v, i) => (
              <div key={v.id} className="group flex items-center gap-2 px-3 py-2">
                <span className="tabular w-6 shrink-0 text-xs text-[var(--muted)]">{i + 1}.</span>
                <span className="min-w-0 flex-1 truncate text-sm">{v.title}</span>
                <div className="row-actions flex shrink-0 items-center gap-1">
                  <button
                    className="btn px-1.5 py-1"
                    disabled={i === 0}
                    onClick={async () => {
                      await moveTrainingVideo(v.id, mod.id, "up");
                      refresh();
                    }}
                    aria-label="Move up"
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    className="btn px-1.5 py-1"
                    disabled={i === videos.length - 1}
                    onClick={async () => {
                      await moveTrainingVideo(v.id, mod.id, "down");
                      refresh();
                    }}
                    aria-label="Move down"
                  >
                    <ArrowDown size={13} />
                  </button>
                  <button
                    className="rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--danger)]"
                    onClick={async () => {
                      await deleteTrainingVideo(v.id, mod.id);
                      refresh();
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---- Assignments & progress ---------------------------------------- */}
      <section>
        <SectionHeading
          title="Assigned to"
          note="Only assigned employees can see this module at all"
        />
        <div className="mb-2 flex items-center gap-2">
          <select
            className="input max-w-[220px] py-1.5"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            aria-label="Assign to"
          >
            <option value="">Give access to…</option>
            {unassigned.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => void addAssignee()} disabled={!assignee}>
            Assign
          </button>
        </div>

        {assignments.length === 0 ? (
          <div className="card p-6 text-center text-sm text-[var(--muted)]">
            Nobody has access yet.
          </div>
        ) : (
          <div className="card divide-y divide-[var(--border)] overflow-hidden">
            {assignments.map((a) => {
              const mine = completions.filter((c) => c.user_id === a.userId);
              const doneCount = videos.filter((v) =>
                mine.some((c) => c.video_id === v.id),
              ).length;
              const finished = videos.length > 0 && doneCount === videos.length;
              const last = mine
                .map((c) => c.completed_at)
                .sort()
                .at(-1);
              return (
                <div key={a.id} className="group flex items-center gap-3 px-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm">{a.name}</span>
                  <div className="h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-[var(--bg-subtle)]">
                    <div
                      className="h-full rounded-full transition-[width] duration-300"
                      style={{
                        width: videos.length
                          ? `${(doneCount / videos.length) * 100}%`
                          : "0%",
                        background: finished ? "var(--success)" : "var(--accent)",
                      }}
                    />
                  </div>
                  <span className="tabular w-12 shrink-0 text-right text-xs text-[var(--muted)]">
                    {doneCount}/{videos.length}
                  </span>
                  {finished ? (
                    <span className="pill pill-success shrink-0">Completed</span>
                  ) : (
                    <span className="w-20 shrink-0 text-right text-xs text-[var(--muted)]">
                      {last
                        ? new Date(last).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })
                        : "—"}
                    </span>
                  )}
                  <div className="row-actions flex shrink-0 gap-1">
                    {doneCount > 0 && (
                      <button
                        className="btn px-2 py-1 text-xs"
                        onClick={async () => {
                          await resetTrainingProgress({ moduleId: mod.id, userId: a.userId });
                          refresh();
                        }}
                        title="Wipe this person's progress in this module"
                      >
                        Reset
                      </button>
                    )}
                    <button
                      className="rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--danger)]"
                      onClick={async () => {
                        await unassignTraining(a.id, mod.id);
                        refresh();
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ---- Module controls ------------------------------------------------ */}
      <section className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-4">
        <button
          className="btn py-1.5 text-xs"
          onClick={async () => {
            await updateTrainingModule(mod.id, { isArchived: !mod.is_archived });
            refresh();
          }}
        >
          {mod.is_archived ? "Unarchive module" : "Archive module"}
        </button>
        <div className="flex-1" />
        {confirmDelete ? (
          <span className="flex items-center gap-1 text-xs">
            <span className="text-[var(--muted)]">
              Delete this module, its videos, and all progress?
            </span>
            <button
              className="rounded bg-[var(--danger)] px-2 py-1 text-xs text-[var(--accent-fg)]"
              onClick={async () => {
                const res = await deleteTrainingModule(mod.id);
                if (res.error) {
                  setError(res.error);
                  setConfirmDelete(false);
                  return;
                }
                startTransition(() => router.push("/training"));
              }}
            >
              Delete
            </button>
            <button className="btn px-2 py-1 text-xs" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button
            className="rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--danger)]"
            onClick={() => setConfirmDelete(true)}
          >
            Delete module
          </button>
        )}
      </section>
    </div>
  );
}
