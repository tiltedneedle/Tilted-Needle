"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Select from "@/components/ui/Select";
import { createContentItem } from "@/app/actions";
import { parseDuration } from "@/lib/format";
import type { Client } from "@/lib/types";

export default function NewContentForm({
  workspaceId,
  clients,
}: {
  workspaceId: string;
  clients: Client[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState("");
  const [subject, setSubject] = useState("");
  const [hook, setHook] = useState("");
  const [length, setLength] = useState("");
  const [producedAt, setProducedAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!title.trim()) return setError("Title is required.");
    setBusy(true);
    setError(null);
    const res = await createContentItem({
      workspaceId,
      clientId: clientId || null,
      title,
      subject: subject.trim() || null,
      hook: hook.trim() || null,
      lengthSeconds: length.trim() ? parseDuration(length) : null,
      producedAt: producedAt || null,
    });
    setBusy(false);
    if (res.error) return setError(res.error);
    setTitle("");
    setSubject("");
    setHook("");
    setLength("");
    setOpen(false);
    startTransition(() => router.refresh());
  }

  if (!open) {
    return (
      <button className="btn-primary mb-4" onClick={() => setOpen(true)}>
        New content
      </button>
    );
  }

  return (
    <div className="card animate-rise mb-4 space-y-2 p-3">
      <div className="flex flex-wrap gap-2">
        <input
          autoFocus
          className="input min-w-[240px] flex-1"
          placeholder="Title, e.g. Youmi Beauty Vlog"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Select
          className="max-w-[190px]"
          value={clientId}
          onChange={setClientId}
          placeholder="No client"
          ariaLabel="Client"
          options={clients
            .filter((c) => !c.is_archived)
            .map((c) => ({ value: c.id, label: c.name }))}
        />
        <input
          type="date"
          className="input max-w-[160px]"
          value={producedAt}
          onChange={(e) => setProducedAt(e.target.value)}
        />
        <input
          className="input max-w-[110px] text-center"
          placeholder="0:38"
          value={length}
          onChange={(e) => setLength(e.target.value)}
          aria-label="Video length"
        />
      </div>

      {/* Subject and Hook are filled ~94% of the time in the current sheet --
          they are the team's manual stand-in for retention data (PRD 3.5). */}
      <input
        className="input"
        placeholder="Subject — what the video is about"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
      />
      <input
        className="input"
        placeholder='Hook — the literal opening line'
        value={hook}
        onChange={(e) => setHook(e.target.value)}
      />

      {error && (
        <p className="text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button className="btn-primary" onClick={create} disabled={busy}>
          {busy ? "Creating…" : "Create"}
        </button>
        <button className="btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
