"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClientRecord } from "@/app/actions";

export default function NewClientForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) return setError("Name is required.");
    setBusy(true);
    setError(null);
    const res = await createClientRecord(workspaceId, name.trim());
    setBusy(false);
    if (res.error) return setError(res.error);
    setName("");
    router.refresh();
  }

  return (
    <div className="mb-4 flex items-start gap-2">
      <div className="flex-1">
        <input
          className="input"
          placeholder="New client name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void create()}
        />
        {error && (
          <p className="mt-1 text-xs text-[var(--danger)]" role="alert">
            {error}
          </p>
        )}
      </div>
      <button className="btn-primary" onClick={create} disabled={busy}>
        Add client
      </button>
    </div>
  );
}
