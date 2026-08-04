"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTrainingModule } from "@/app/actions";

/** Inline course creation -- lands straight on the new module to add videos. */
export default function NewModuleForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <div className="mb-5">
        <button className="btn-primary py-1.5" onClick={() => setOpen(true)}>
          New module
        </button>
      </div>
    );
  }

  async function submit() {
    setBusy(true);
    const res = await createTrainingModule({
      workspaceId,
      title,
      description: description || null,
    });
    setBusy(false);
    if (res.error) return setError(res.error);
    startTransition(() => router.push(`/training/${res.id}`));
  }

  return (
    <div className="card animate-rise mb-5 space-y-2 p-3">
      <input
        className="input"
        placeholder="Module title — e.g. Editing onboarding"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
      />
      <textarea
        className="input min-h-[60px]"
        placeholder="What this course covers (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      {error && (
        <p className="text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button className="btn-primary py-1.5" onClick={() => void submit()} disabled={busy}>
          Create
        </button>
        <button className="btn py-1.5" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
