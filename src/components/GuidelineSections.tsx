"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { saveSection, addSection, deleteSection } from "@/app/(app)/guidelines/actions";
import type { GuidelineSection } from "@/lib/guidelines";

/**
 * The written half of a client's guideline.
 *
 * Every section stays visible even when empty. A blank "Filming guidelines"
 * is information -- it says nobody has written one yet -- and hiding it would
 * make an incomplete guide look finished, which is exactly the failure the
 * page exists to prevent.
 *
 * Editing is per-section rather than one big form: two people can be filling
 * in different sections of the same client at once without overwriting each
 * other, and a save only ever carries the section you touched.
 */
export default function GuidelineSections({
  clientId,
  sections,
  canManage,
}: {
  clientId: string;
  sections: GuidelineSection[];
  canManage: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();

  async function submitNew() {
    if (!newTitle.trim()) return;
    setBusy(true);
    const res = await addSection(clientId, newTitle);
    setBusy(false);
    if (res.error) return setError(res.error);
    setNewTitle("");
    setAdding(false);
    startTransition(() => router.refresh());
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Guideline
        </h2>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-[var(--muted)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)]"
          >
            <Plus size={13} /> Add section
          </button>
        )}
      </div>

      {adding && (
        <div className="mb-3 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] p-3">
          <input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitNew();
              if (e.key === "Escape") { setAdding(false); setNewTitle(""); }
            }}
            placeholder="Section name, e.g. Sponsorship rules"
            className="flex-1 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--input-bg)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
          />
          <button
            onClick={submitNew}
            disabled={busy || !newTitle.trim()}
            className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
          >
            Add
          </button>
          <button
            onClick={() => { setAdding(false); setNewTitle(""); }}
            className="rounded-[var(--radius-sm)] px-2 py-1.5 text-sm text-[var(--muted)] hover:bg-[var(--bg-subtle)]"
          >
            Cancel
          </button>
        </div>
      )}

      {error && (
        <p className="mb-3 text-xs text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}

      <div className="space-y-2.5">
        {sections.map((s) => (
          <SectionCard key={s.id} section={s} canManage={canManage} />
        ))}
      </div>
    </section>
  );
}

function SectionCard({
  section,
  canManage,
}: {
  section: GuidelineSection;
  canManage: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(section.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();

  const empty = !section.body || !section.body.trim();

  async function save() {
    setBusy(true);
    const res = await saveSection(section.id, draft);
    setBusy(false);
    if (res.error) return setError(res.error);
    setError(null);
    setEditing(false);
    startTransition(() => router.refresh());
  }

  async function remove() {
    setBusy(true);
    const res = await deleteSection(section.id);
    setBusy(false);
    if (res.error) return setError(res.error);
    startTransition(() => router.refresh());
  }

  return (
    <div
      id={`section-${section.id}`}
      className="group rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] p-4 transition-shadow hover:shadow-[var(--shadow-card)]"
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold">{section.title}</h3>
        <div className="flex shrink-0 items-center gap-1">
          {!editing && (
            <button
              onClick={() => { setDraft(section.body ?? ""); setEditing(true); }}
              className="rounded-md p-1.5 text-[var(--muted)] opacity-0 transition-opacity hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)] focus:opacity-100 group-hover:opacity-100"
              title="Edit this section"
              aria-label={`Edit ${section.title}`}
            >
              <Pencil size={13} />
            </button>
          )}
          {!editing && canManage && (
            <button
              onClick={remove}
              disabled={busy}
              className="rounded-md p-1.5 text-[var(--muted)] opacity-0 transition-opacity hover:bg-[var(--danger)]/10 hover:text-[var(--danger)] focus:opacity-100 group-hover:opacity-100"
              title="Delete this section"
              aria-label={`Delete ${section.title}`}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <div>
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setEditing(false); setDraft(section.body ?? ""); }
              // Cmd/Ctrl+Enter saves -- these bodies run to several paragraphs
              // and plain Enter has to stay a newline.
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
            }}
            rows={Math.max(6, draft.split("\n").length + 1)}
            className="w-full resize-y rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--input-bg)] p-3 text-sm leading-relaxed outline-none focus:border-[var(--accent)]"
            placeholder="Nothing written yet."
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={save}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-fg)] disabled:opacity-50"
            >
              <Check size={13} /> {busy ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => { setEditing(false); setDraft(section.body ?? ""); }}
              className="flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--bg-subtle)]"
            >
              <X size={13} /> Cancel
            </button>
            <span className="text-[11px] text-[var(--muted)]">⌘↵ to save</span>
          </div>
        </div>
      ) : empty ? (
        <button
          onClick={() => setEditing(true)}
          className="w-full rounded-[var(--radius-sm)] border border-dashed border-[var(--border-strong)] px-3 py-3 text-left text-xs text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--fg)]"
        >
          Nothing written yet — click to add.
        </button>
      ) : (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--fg)]">
          {section.body}
        </p>
      )}

      {error && (
        <p className="mt-2 text-xs text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
