"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Anchor } from "lucide-react";
import { setHookType } from "@/app/actions";
import { useToast } from "@/components/ui/Toast";
import { HOOK_TYPES, hookTypeLabel } from "@/lib/analysis/hookTypes";

/**
 * Tag what the first three seconds of this video DO.
 *
 * The verbatim opening line sits directly above the picker, and that
 * adjacency is the point: the tagger is choosing a category for words that
 * are in front of them, not recalling a video they watched last week. When
 * the line is missing the picker still works — some hooks are visual and
 * there is nothing to quote — but the hint text changes to say so, because a
 * blank quote box reads as a loading failure.
 *
 * Untagging is a first-class option rather than a hidden escape. A hook
 * vocabulary is only worth having if wrong calls can be corrected, and if the
 * first click were permanent people would hesitate and tag nothing.
 */
export default function HookTypePanel({
  workspaceId,
  contentItemId,
  hook,
  hookType,
  setAt,
}: {
  workspaceId: string;
  contentItemId: string;
  hook: string | null;
  hookType: string | null;
  setAt: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const current = hookType;

  async function choose(next: string | null) {
    if (next === current) return;
    setBusy(next ?? "__clear");
    try {
      const res = await setHookType({ workspaceId, contentItemId, hookType: next });
      if (res.error) {
        toast("danger", res.error);
        return;
      }
      toast(
        "success",
        next
          ? `Hook tagged as “${hookTypeLabel(next)}”.`
          : "Hook tag cleared — this video is untagged again.",
      );
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="mb-2 flex items-center gap-2">
        <Anchor className="h-4 w-4 text-[var(--muted)]" />
        <h2 className="text-sm font-semibold">Hook</h2>
        {current ? (
          <span className="rounded bg-[var(--accent)] px-1.5 py-0.5 text-xs text-[var(--accent-fg)]">
            {hookTypeLabel(current)}
          </span>
        ) : (
          <span className="text-xs text-[var(--muted)]">not tagged</span>
        )}
      </div>

      {hook?.trim() ? (
        <blockquote className="mb-3 border-l-2 border-[var(--border)] pl-3 text-sm italic text-[var(--muted)]">
          {hook.trim()}
        </blockquote>
      ) : (
        <p className="mb-3 text-xs text-[var(--muted)]">
          No opening line recorded. Tag from the video itself — a hook can be
          entirely visual.
        </p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {HOOK_TYPES.map((h) => {
          const active = current === h.id;
          return (
            <button
              key={h.id}
              type="button"
              title={`${h.hint}\n\ne.g. ${h.example}`}
              disabled={busy !== null}
              onClick={() => choose(h.id)}
              className={`rounded border px-2 py-1 text-xs transition-colors disabled:opacity-50 ${
                active
                  ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]"
                  : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--bg-subtle)]"
              }`}
            >
              {busy === h.id ? "…" : h.label}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-xs text-[var(--muted)]">
          {/* Naming the threshold is the point. Without it a tagger has no way
              to know that tagging six videos buys nothing at all. */}
          Hook performance appears in Insights once a client has 8 videos
          tagged with the same hook.
        </p>
        {current && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => choose(null)}
            className="shrink-0 text-xs text-[var(--muted)] underline hover:text-[var(--fg)] disabled:opacity-50"
          >
            Clear
          </button>
        )}
      </div>

      {setAt && current && (
        <p className="mt-1 text-xs text-[var(--muted)]">
          Tagged {new Date(setAt).toLocaleDateString()}.
        </p>
      )}
    </section>
  );
}
