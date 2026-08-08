"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";
import { saveTranscript } from "@/app/actions";
import { useToast } from "@/components/ui/Toast";

/**
 * The video's transcript, and the way to supply one.
 *
 * Paste is not a fallback here. YouTube returns an empty body to server-side
 * caption requests (proof-of-origin refusal, measured against this library),
 * so pasting is currently the working route into the corpus -- and a pasted
 * transcript feeds search, corpus analysis and briefs identically to a
 * fetched one.
 */
export default function TranscriptPanel({
  workspaceId,
  contentItemId,
  transcript,
}: {
  workspaceId: string;
  contentItemId: string;
  transcript: { fullText: string; source: string; isGenerated: boolean | null } | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const res = await saveTranscript({ workspaceId, contentItemId, text });
      if (res.error) {
        toast("danger", res.error);
        return;
      }
      toast("success", "Transcript saved — it is searchable immediately.");
      setEditing(false);
      setText("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card mb-5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <FileText size={14} />
          Transcript
        </h3>
        {transcript ? (
          <span className="text-xs text-[var(--muted)]">
            {transcript.fullText.split(/\s+/).length.toLocaleString()} words ·{" "}
            {transcript.source === "manual" ? "pasted" : transcript.source}
            {transcript.isGenerated ? " · auto-generated" : ""}
          </span>
        ) : (
          <button
            className="btn px-2.5 py-1 text-xs"
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? "Cancel" : "Paste transcript"}
          </button>
        )}
      </div>

      {transcript && (
        <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-[var(--muted)]">
          {transcript.fullText}
        </p>
      )}

      {!transcript && !editing && (
        <p className="mt-2 text-xs text-[var(--muted)]">
          None yet. YouTube refuses server-side caption requests, so paste one
          here — it becomes searchable across the library immediately, and
          feeds the same analysis a fetched transcript would.
        </p>
      )}

      {editing && (
        <div className="animate-rise mt-3">
          <textarea
            className="input min-h-[140px] w-full text-sm"
            placeholder="Paste the transcript text…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              className="btn px-3 py-1.5 text-xs"
              disabled={busy || text.trim().length < 20}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Save transcript"}
            </button>
            <span className="text-xs text-[var(--muted)]">
              Timings are not inferred — a pasted transcript has no clickable
              timestamps, and inventing them would put false positions on a chart.
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
