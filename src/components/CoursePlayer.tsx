"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Lock, PlayCircle } from "lucide-react";
import { completeTrainingVideo } from "@/app/actions";
import { embedFor } from "@/lib/videoEmbed";
import type { TrainingVideo } from "@/lib/types";

/**
 * The course itself: one embedded player and the ordered video list.
 * Sequential by design -- a video is only clickable once everything before
 * it is complete, exactly like any course platform. Managers preview freely
 * (no locks), but marking complete still only ever writes the caller's own
 * progress, in order, via the server action.
 */
export default function CoursePlayer({
  workspaceId,
  moduleId,
  videos,
  myDone,
  canManage,
  selfAssigned,
}: {
  workspaceId: string;
  moduleId: string;
  videos: TrainingVideo[];
  myDone: string[];
  canManage: boolean;
  /** Completion only applies to people the course is assigned to -- a
      manager previewing an unassigned course gets no completion button
      (RLS would refuse the write anyway; this keeps the UI honest). */
  selfAssigned: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // null = follow the course: show the first incomplete video.
  const [picked, setPicked] = useState<string | null>(null);

  const done = useMemo(() => new Set(myDone), [myDone]);
  const firstIncomplete = videos.findIndex((v) => !done.has(v.id));
  const allDone = videos.length > 0 && firstIncomplete === -1;

  const current =
    (picked && videos.find((v) => v.id === picked)) ||
    (allDone ? videos[videos.length - 1] : videos[firstIncomplete]) ||
    null;

  if (videos.length === 0) {
    return (
      <div className="card p-8 text-center text-sm text-[var(--muted)]">
        No videos in this module yet.
      </div>
    );
  }

  const embed = current ? embedFor("youtube", current.youtube_url, null) : null;
  const currentIndex = current ? videos.findIndex((v) => v.id === current.id) : -1;
  const canComplete =
    selfAssigned && current && !done.has(current.id) && currentIndex === firstIncomplete;

  async function markDone() {
    if (!current) return;
    setBusy(true);
    const res = await completeTrainingVideo({
      workspaceId,
      moduleId,
      videoId: current.id,
    });
    setBusy(false);
    if (res.error) return setError(res.error);
    setError(null);
    setPicked(null); // follow the course to the next video
    startTransition(() => router.refresh());
  }

  return (
    <div className="mb-7">
      {allDone && (
        <div className="mb-3 flex items-center gap-2 rounded-md bg-[var(--success-100)] px-3 py-2 text-sm text-[var(--success)]">
          <CheckCircle2 size={16} /> Module completed — every video watched.
        </div>
      )}

      {current && (
        <>
          <div
            className="card mb-2 overflow-hidden"
            style={{ aspectRatio: "16 / 9" }}
          >
            {embed ? (
              <iframe
                key={current.id}
                src={embed.src}
                className="h-full w-full border-0"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
                title={current.title}
              />
            ) : (
              <div className="grid h-full place-items-center text-sm text-[var(--muted)]">
                This video&apos;s URL could not be embedded.
              </div>
            )}
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">
              {currentIndex + 1}. {current.title}
            </span>
            <div className="flex-1" />
            {done.has(current.id) ? (
              <span className="pill pill-success">Completed</span>
            ) : canComplete ? (
              <button className="btn-primary py-1.5" onClick={() => void markDone()} disabled={busy}>
                {busy ? "Saving…" : "Mark as completed"}
              </button>
            ) : (
              <span className="text-xs text-[var(--muted)]">
                {!selfAssigned
                  ? "Preview — assign yourself to take this course"
                  : "Locked until the previous videos are done"}
              </span>
            )}
          </div>
          {error && (
            <p className="mb-3 text-sm text-[var(--danger)]" role="alert">
              {error}
            </p>
          )}
        </>
      )}

      <div className="card divide-y divide-[var(--border)] overflow-hidden">
        {videos.map((v, i) => {
          const isDone = done.has(v.id);
          const isCurrent = current?.id === v.id;
          const unlocked = isDone || i === firstIncomplete || canManage;
          return (
            <button
              key={v.id}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors enabled:hover:bg-[var(--bg-subtle)] disabled:cursor-not-allowed"
              disabled={!unlocked}
              onClick={() => setPicked(v.id)}
              style={{ background: isCurrent ? "var(--bg-subtle)" : undefined }}
              aria-current={isCurrent ? "true" : undefined}
            >
              {isDone ? (
                <CheckCircle2 size={16} className="shrink-0" style={{ color: "var(--success)" }} />
              ) : unlocked ? (
                <PlayCircle size={16} className="shrink-0" style={{ color: "var(--accent)" }} />
              ) : (
                <Lock size={14} className="shrink-0 text-[var(--muted)]" />
              )}
              <span
                className={`min-w-0 flex-1 truncate text-sm ${
                  unlocked ? "" : "text-[var(--muted)]"
                } ${isCurrent ? "font-semibold" : ""}`}
              >
                {i + 1}. {v.title}
              </span>
              {isDone && <span className="text-xs text-[var(--muted)]">done</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
