"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteEntry, updateEntry, startTimer } from "@/app/actions";
import {
  dayKey,
  entrySeconds,
  formatClock,
  formatDayHeading,
  formatDuration,
  formatDurationShort,
} from "@/lib/format";
import type { TimeEntry } from "@/lib/types";

export default function EntryList({
  entries,
  workspaceId,
  contentItems = [],
}: {
  entries: TimeEntry[];
  workspaceId: string;
  contentItems?: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const finished = entries.filter((e) => e.ended_at);

  if (finished.length === 0) {
    return (
      <div className="card p-10 text-center text-sm text-[var(--muted)]">
        No time tracked yet. Start the timer above, or type a duration like
        <span className="mx-1 rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 tabular">
          1:30
        </span>
        to add it manually.
      </div>
    );
  }

  // Group by local day, newest first.
  const groups = new Map<string, TimeEntry[]>();
  for (const e of finished) {
    const key = dayKey(e.started_at);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  async function saveDescription(entry: TimeEntry) {
    const next = draft.trim();
    setEditing(null);
    if (next === entry.description) return;
    await updateEntry(entry.id, { description: next });
    startTransition(() => router.refresh());
  }

  async function resume(entry: TimeEntry) {
    const res = await startTimer({
      workspaceId,
      description: entry.description,
      projectId: entry.project_id,
      taskId: entry.task_id,
      isBillable: entry.is_billable,
    });
    if (!res.error) startTransition(() => router.refresh());
  }

  async function remove(id: string) {
    await deleteEntry(id);
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-5">
      {[...groups.entries()].map(([key, dayEntries]) => {
        const total = dayEntries.reduce((sum, e) => sum + entrySeconds(e), 0);
        return (
          <section key={key}>
            <div className="mb-1.5 flex items-baseline justify-between px-1">
              <h2 className="text-sm font-semibold">{formatDayHeading(key)}</h2>
              <span className="tabular text-sm text-[var(--muted)]">
                {formatDurationShort(total)}
              </span>
            </div>

            <div className="card divide-y divide-[var(--border)] overflow-hidden">
              {dayEntries.map((e) => (
                <div
                  key={e.id}
                  className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--bg-subtle)]"
                >
                  <div className="min-w-0 flex-1">
                    {editing === e.id ? (
                      <input
                        autoFocus
                        className="input py-1"
                        value={draft}
                        onChange={(ev) => setDraft(ev.target.value)}
                        onBlur={() => void saveDescription(e)}
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter") void saveDescription(e);
                          if (ev.key === "Escape") setEditing(null);
                        }}
                      />
                    ) : (
                      <button
                        className="block max-w-full truncate text-left text-sm hover:text-[var(--accent)]"
                        onClick={() => {
                          setEditing(e.id);
                          setDraft(e.description);
                        }}
                      >
                        {e.description || (
                          <span className="text-[var(--muted)]">No description</span>
                        )}
                      </button>
                    )}

                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                      {e.project && (
                        <span className="flex items-center gap-1.5">
                          <span
                            className="size-2 shrink-0 rounded-full"
                            style={{ background: e.project.color }}
                          />
                          <span className="truncate">
                            {e.project.name}
                            {e.task ? `: ${e.task.name}` : ""}
                          </span>
                        </span>
                      )}

                      {/* The join: attaching an entry to content is what makes
                          hours-per-video and cost-per-1k-views possible. */}
                      {contentItems.length > 0 && (
                        <select
                          className="rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-[var(--muted)] transition-colors hover:border-[var(--border)] hover:text-[var(--fg)]"
                          value={e.content_item_id ?? ""}
                          onChange={async (ev) => {
                            await updateEntry(e.id, {
                              contentItemId: ev.target.value || null,
                            });
                            startTransition(() => router.refresh());
                          }}
                          aria-label="Link to content"
                        >
                          <option value="">— no content —</option>
                          {contentItems.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.title}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>

                  <div className="hidden shrink-0 text-xs text-[var(--muted)] sm:block">
                    {formatClock(e.started_at)} – {formatClock(e.ended_at!)}
                  </div>

                  <div className="tabular w-[74px] shrink-0 text-right text-sm font-medium">
                    {formatDuration(entrySeconds(e))}
                  </div>

                  {/* Hover-revealed actions keep the row uncluttered (PRD 8.2). */}
                  <div className="row-actions flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => void resume(e)}
                      title="Resume this entry"
                      className="rounded p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--fg)]"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => void remove(e.id)}
                      title="Delete entry"
                      className="rounded p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--danger)]"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      >
                        <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
