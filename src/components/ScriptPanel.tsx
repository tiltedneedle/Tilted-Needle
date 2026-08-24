"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PenLine } from "lucide-react";
import { saveScript } from "@/app/actions";
import { useToast } from "@/components/ui/Toast";

/**
 * The script: what this video was written to say.
 *
 * IT SITS ABOVE THE TRANSCRIPT AND THAT ORDER IS THE POINT. A script is
 * written before the shoot; a transcript records what came out of it. Reading
 * down the page is reading the video in the order it happened, and the two
 * panels next to each other are what make the gap between plan and delivery
 * visible at all — the line that got cut, the hook rewritten on camera, the
 * CTA nobody remembered to say.
 *
 * Deliberately a plain textarea. Scripts arrive pasted from a doc, and every
 * formatting affordance added here would be one more thing that mangles what
 * was pasted. The body is stored verbatim, whitespace and all.
 */
export default function ScriptPanel({
  workspaceId,
  contentItemId,
  script,
}: {
  workspaceId: string;
  contentItemId: string;
  script: { body: string; updatedAt: string | null; author: string | null } | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(script?.body ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const res = await saveScript({ workspaceId, contentItemId, body: text });
      if (res.error) {
        toast("danger", res.error);
        return;
      }
      toast(
        "success",
        text.trim() ? "Script saved." : "Script cleared — this video has none again.",
      );
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const words = script?.body ? script.body.trim().split(/\s+/).filter(Boolean).length : 0;

  return (
    <section className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <PenLine className="h-4 w-4 shrink-0 self-center text-[var(--muted)]" />
        <h2 className="text-sm font-semibold">Script</h2>
        <span className="text-xs text-[var(--muted)]">
          {script ? `${words} word${words === 1 ? "" : "s"}` : "not written"}
        </span>
        <div className="flex-1" />
        {!editing && (
          <button
            type="button"
            className="text-xs text-[var(--muted)] underline hover:text-[var(--fg)]"
            onClick={() => {
              setText(script?.body ?? "");
              setEditing(true);
            }}
          >
            {script ? "Edit" : "Add a script"}
          </button>
        )}
      </div>

      {editing ? (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            autoFocus
            placeholder="Paste or write what this video is meant to say…"
            className="w-full rounded border border-[var(--border)] bg-[var(--bg-subtle)] p-2 font-mono text-xs leading-relaxed"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className="btn" disabled={busy} onClick={save}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="text-xs text-[var(--muted)] underline hover:text-[var(--fg)]"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setText(script?.body ?? "");
              }}
            >
              Cancel
            </button>
            {/* Emptying the box is how a script is removed, so the box has to
                say so -- otherwise clearing it looks like it failed to save. */}
            <span className="text-xs text-[var(--muted)]">
              Saving an empty script removes it.
            </span>
          </div>
        </>
      ) : script ? (
        <>
          {/* whitespace-pre-wrap: a script's line breaks ARE its structure --
              beats, shot changes, who speaks. Collapsing them would turn a
              shooting document into a paragraph. */}
          <p className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded bg-[var(--bg-subtle)] p-2 font-mono text-xs leading-relaxed">
            {script.body}
          </p>
          {script.updatedAt && (
            <p className="mt-1.5 text-xs text-[var(--muted)]">
              Updated {new Date(script.updatedAt).toLocaleDateString()}
              {script.author ? ` by ${script.author}` : ""}
            </p>
          )}
        </>
      ) : (
        <p className="text-xs text-[var(--muted)]">
          What this video was written to say, before it was shot. Separate from
          the transcript below, which is what it actually said.
        </p>
      )}
    </section>
  );
}
