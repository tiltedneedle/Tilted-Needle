"use client";

import { useActionState } from "react";
import { createWorkspaceAction, type ActionState } from "@/app/actions";

const initial: ActionState = {};

export default function WorkspaceForm() {
  const [state, formAction, pending] = useActionState(
    createWorkspaceAction,
    initial,
  );

  return (
    <form action={formAction} className="space-y-3">
      <input
        className="input"
        name="name"
        required
        autoFocus
        placeholder="e.g. Tilted Needle London"
      />
      {state.error && (
        <p
          className="rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-400"
          role="alert"
        >
          {state.error}
        </p>
      )}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "Creating…" : "Create workspace"}
      </button>
    </form>
  );
}
