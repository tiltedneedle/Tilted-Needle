"use client";

import { useState, useTransition } from "react";
import { recordIdeaOutcome } from "@/app/actions";

/**
 * Generated ideas, awaiting a verdict.
 *
 * The verdict is the point. Adoption rate is the cheapest evaluation signal
 * the ideas system has and the only one that arrives within weeks -- and it
 * only exists if declines are recorded, because the not-adopted set is the
 * part that carries the information. So declining is exactly as easy as
 * adopting, and neither asks for confirmation.
 *
 * The evidence badge is data, not decoration: "measured" survived mechanical
 * citation checking against acting/holds findings; "craft" is ordinary
 * short-form convention and says so. The model cannot influence which label
 * appears -- see provenance.ts.
 */

export type IdeaCard = {
  id: string;
  clientName: string;
  title: string;
  premise: string;
  openingLine: string | null;
  evidenceBasis: "measured" | "craft";
  createdAt: string;
  /** Latest disposition, when one exists -- decided ideas render read-only. */
  disposition: "adopted" | "declined" | "expired" | null;
};

export default function IdeaReview({ ideas }: { ideas: IdeaCard[] }) {
  const [decided, setDecided] = useState<Map<string, string>>(new Map());
  const [failed, setFailed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (ideas.length === 0) return null;

  const open = ideas.filter((i) => !i.disposition && !decided.has(i.id));
  const done = ideas.length - open.length;

  const decide = (id: string, disposition: "adopted" | "declined") => {
    startTransition(async () => {
      const res = await recordIdeaOutcome({ suggestionId: id, disposition });
      if (res.error) {
        setFailed(res.error);
        return;
      }
      setFailed(null);
      setDecided((m) => new Map(m).set(id, disposition));
    });
  };

  return (
    <section className="card animate-rise mt-6 p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold">Generated ideas</h2>
        <span className="text-xs text-[var(--muted)]">
          {open.length} awaiting a verdict{done > 0 ? `, ${done} decided` : ""}
        </span>
      </div>

      {failed && (
        <p className="mb-2 text-xs text-[var(--danger)]">
          Could not record that: {failed}
        </p>
      )}

      {open.length === 0 ? (
        <p className="text-xs text-[var(--muted)]">
          Every generated idea has a verdict. New ones appear here when the
          generator runs.
        </p>
      ) : (
        <ul className="space-y-3">
          {open.map((idea) => (
            <li key={idea.id} className="rounded-lg p-3 ring-1 ring-[var(--border)]">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {idea.title}
                    <span
                      className={`ml-2 rounded px-1.5 py-0.5 align-middle text-[10px] uppercase tracking-wide ${
                        idea.evidenceBasis === "measured"
                          ? "text-[var(--success)] ring-1 ring-[var(--success)]"
                          : "text-[var(--muted)] ring-1 ring-[var(--border)]"
                      }`}
                      title={
                        idea.evidenceBasis === "measured"
                          ? "Cites a measured finding from this client's own data; every citation verified in code."
                          : "Craft convention, not evidence from this library — nothing measured supports or contradicts it."
                      }
                    >
                      {idea.evidenceBasis}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">{idea.clientName}</p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    className="btn text-xs"
                    disabled={pending}
                    onClick={() => decide(idea.id, "declined")}
                  >
                    Decline
                  </button>
                  <button
                    className="btn-primary text-xs"
                    disabled={pending}
                    onClick={() => decide(idea.id, "adopted")}
                  >
                    Adopt
                  </button>
                </div>
              </div>
              <p className="mt-2 text-xs leading-relaxed">{idea.premise}</p>
              {idea.openingLine && (
                <p className="mt-1.5 text-xs italic text-[var(--muted)]">
                  Opens: &ldquo;{idea.openingLine}&rdquo;
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
