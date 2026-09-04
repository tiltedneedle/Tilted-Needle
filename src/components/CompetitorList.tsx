"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Swords } from "lucide-react";
import { addCompetitor, archiveCompetitor } from "@/app/actions";
import { useToast } from "@/components/ui/Toast";
import Select from "@/components/ui/Select";
import { PLATFORM_LABEL } from "@/lib/types";

export type CompetitorRow = {
  id: string;
  platformSlug: string;
  handle: string;
  displayName: string | null;
  note: string | null;
  sampled: number;
  /** Best relative performer among the sampled posts, or null. */
  bestRelIndex: number | null;
  /** Their own median views, and how that compares to the client's. */
  scaleLabel: string;
  scaleComparable: boolean;
  lastScannedAt: string | null;
  lastScanError: string | null;
};

/**
 * Who this client is measured against, listed by hand.
 *
 * On the CLIENT page, not a global one, because a competitor is only ever a
 * competitor OF someone -- the same account can be a rival for one client and
 * irrelevant for another, and a workspace-wide list cannot say that.
 *
 * Every figure shown is RELATIVE TO THAT COMPETITOR'S OWN MEDIAN. Raw view
 * counts are deliberately not the headline: a rival with ten times the
 * followers will always win on raw views, and reading that as "their content
 * is better" is the mistake this whole feature is shaped to avoid.
 */
export default function CompetitorList({
  workspaceId,
  clientId,
  competitors,
  platforms,
  canManage,
}: {
  workspaceId: string;
  clientId: string;
  competitors: CompetitorRow[];
  platforms: { slug: string; name: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState(platforms[0]?.slug ?? "");
  const [handle, setHandle] = useState("");
  const [note, setNote] = useState("");

  const add = () => {
    if (!handle.trim() || !platform) return;
    startTransition(async () => {
      const res = await addCompetitor({
        workspaceId, clientId, platformSlug: platform, handle, note,
      });
      if (res.error) return toast("danger", res.error);
      toast("success", "Competitor added — their recent posts get sampled on the next run.");
      setHandle("");
      setNote("");
      setOpen(false);
      router.refresh();
    });
  };

  const remove = (id: string, label: string) => {
    startTransition(async () => {
      const res = await archiveCompetitor({ workspaceId, competitorId: id });
      if (res.error) return toast("danger", res.error);
      toast("success", `${label} removed from this client's list.`);
      router.refresh();
    });
  };

  return (
    <section className="card p-4">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Swords className="h-4 w-4 text-[var(--muted)]" />
        <h2 className="text-sm font-semibold">Competitors</h2>
        <span className="text-xs text-[var(--muted)]">
          {competitors.length === 0
            ? "none listed"
            : `${competitors.length} listed`}
        </span>
        {canManage && (
          <button
            type="button"
            className="btn ml-auto"
            disabled={pending}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Cancel" : "Add competitor"}
          </button>
        )}
      </div>

      <p className="mb-3 text-xs text-[var(--muted)]">
        Pages worth watching for this client. Sampled posts feed idea
        generation — never this client&apos;s own numbers, and never their
        report.
      </p>

      {open && canManage && (
        <div className="mb-3 flex flex-wrap items-end gap-2 rounded border border-[var(--border)] p-3">
          <div className="min-w-[150px]">
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--muted)]">
              Platform
            </label>
            <Select
              value={platform}
              onChange={setPlatform}
              clearable={false}
              ariaLabel="Competitor platform"
              options={platforms.map((p) => ({ value: p.slug, label: p.name }))}
            />
          </div>
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--muted)]">
              Handle or profile link
            </label>
            {/* Both accepted on purpose: people paste whatever is in their
                address bar, and normaliseHandle reduces a URL, an @handle and
                a bare handle to the same stored value. */}
            <input
              className="input w-full"
              placeholder="@theirhandle  or  https://…"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
            />
          </div>
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--muted)]">
              Why they matter <span className="opacity-60">(optional)</span>
            </label>
            <input
              className="input w-full"
              placeholder="e.g. the format the client keeps asking for"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
            />
          </div>
          <button type="button" className="btn" disabled={pending || !handle.trim()} onClick={add}>
            {pending ? "Adding…" : "Add"}
          </button>
        </div>
      )}

      {competitors.length === 0 ? (
        <p className="text-xs text-[var(--muted)]">
          No competitors listed yet. Add the accounts this client is measured
          against and their breakout posts become material the idea generator
          can cite.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {competitors.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-[var(--border)] pt-2 text-xs first:border-t-0 first:pt-0"
            >
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="text-[var(--muted)]">
                  {PLATFORM_LABEL[c.platformSlug] ?? c.platformSlug}
                </span>
                <span className="truncate font-medium">@{c.handle}</span>
                {c.note && (
                  <span className="truncate text-[var(--muted)]">— {c.note}</span>
                )}
              </span>
              <span className="flex shrink-0 items-baseline gap-3">
                {/* The ratio, never the raw count. See the module header. */}
                {c.bestRelIndex != null && (
                  <span
                    className="tabular text-[var(--muted)]"
                    title="Their best sampled post, against their own median. Comparable across accounts; raw views are not."
                  >
                    best <span className="font-medium text-[var(--fg)]">
                      {c.bestRelIndex.toFixed(1)}×
                    </span> their norm
                  </span>
                )}
                {/* THE SCALE GATE, said out loud. rel_index makes a rival's
                    numbers comparable at any size; it says nothing about
                    whether their tactics transfer. A channel 9,000x larger is
                    not a competitor, it is a different sport -- and without
                    this line it sat in the list looking exactly like a peer. */}
                {c.sampled > 0 && (
                  <span
                    className={`tabular ${c.scaleComparable ? "text-[var(--muted)]" : "text-[var(--danger)]"}`}
                    title={c.scaleComparable
                      ? "Within 10x of this client either way, so their tactics plausibly transfer."
                      : "Outside 10x of this client. Their breakouts are excluded from idea generation — different budget, different formats, different physics."}
                  >
                    {c.scaleLabel}
                    {!c.scaleComparable && " · not used for ideas"}
                  </span>
                )}
                <span className="tabular text-[var(--muted)]">
                  {c.sampled === 0 ? "not sampled yet" : `${c.sampled} sampled`}
                </span>
                {c.lastScanError && (
                  <span
                    className="text-[var(--danger)]"
                    title={c.lastScanError}
                  >
                    scan failed
                  </span>
                )}
                {canManage && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => remove(c.id, `@${c.handle}`)}
                    className="text-[var(--muted)] underline hover:text-[var(--fg)] disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
