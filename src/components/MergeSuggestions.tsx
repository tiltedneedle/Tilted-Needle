"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Merge } from "lucide-react";
import PlatformIcon from "@/components/PlatformIcon";
import { useToast } from "@/components/ui/Toast";
import { mergeContentItems } from "@/app/actions";
import {
  findMergeCandidates,
  suggestSurvivor,
  type MergeCandidateVideo,
} from "@/lib/mergeCandidates";

/**
 * "These two look like the same video."
 *
 * The merge machinery has existed since the cross-platform work and on live
 * data had been used exactly zero times, while twenty-six pairs sat unmerged.
 * Building it was never the missing half -- nobody scrolls 286 rows hunting
 * for the Instagram twin of a TikTok from March.
 *
 * Collapsed by default and placed after the list, not before it. This is a
 * tidying job, not the reason anyone opens Content, and a panel proposing
 * twenty-six irreversible-looking actions above the actual page would read as
 * a problem to deal with rather than an offer.
 */
// No workspaceId: merge_content_items resolves the workspace from the survivor
// row and checks membership itself, so passing one here would look like it
// scoped something when it scoped nothing.
export default function MergeSuggestions({
  videos,
  canManage,
}: {
  videos: MergeCandidateVideo[];
  canManage: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // Groups already acted on this render, so a merged pair leaves immediately
  // rather than sitting there looking un-merged until the refresh lands.
  const [done, setDone] = useState<Set<string>>(new Set());

  const groups = useMemo(() => findMergeCandidates(videos), [videos]);
  const remaining = groups.filter((g) => !done.has(g.key));

  if (!canManage || groups.length === 0) return null;

  return (
    <section className="mb-7">
      <button
        className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] px-3 py-2 text-left transition-colors hover:bg-[var(--bg-subtle)]"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <ChevronRight
          size={15}
          className={`shrink-0 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
          style={{ color: "var(--muted)" }}
        />
        <span className="text-sm font-medium">Possible duplicates</span>
        <span className="text-xs text-[var(--muted)]">
          {remaining.length} look like the same video on two platforms
        </span>
      </button>

      {open && (
        <div className="mt-2 card divide-y divide-[var(--border)] overflow-hidden">
          {remaining.length === 0 ? (
            <div className="px-3 py-3 text-xs text-[var(--muted)]">
              Nothing left to review.
            </div>
          ) : (
            remaining.map((g) => {
              const survivor = suggestSurvivor(g);
              return (
                <div key={g.key} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                  <div className="flex shrink-0 items-center gap-1">
                    {g.platforms.map((p) => (
                      <PlatformIcon key={p} platform={p} size={14} />
                    ))}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{g.videos[0]?.title}</div>
                    <div className="truncate text-xs text-[var(--muted)]">
                      {g.clientName ?? "No client"} · {g.videos.length} rows
                    </div>
                  </div>
                  <button
                    className="btn flex shrink-0 items-center gap-1.5 px-2.5 py-1 text-xs"
                    disabled={busy === g.key}
                    title="Combine these into one video, keeping both platforms' numbers"
                    onClick={async () => {
                      setBusy(g.key);
                      const res = await mergeContentItems({
                        survivorId: survivor,
                        loserIds: g.videos.map((v) => v.id).filter((id) => id !== survivor),
                        title: g.videos.find((v) => v.id === survivor)?.title,
                      });
                      setBusy(null);
                      // The database refuses with a sentence written for a
                      // person -- "these are different videos: two of them are
                      // posted to the same account" -- so it is shown as-is.
                      if (res.error) return toast("danger", res.error);
                      setDone((s) => new Set(s).add(g.key));
                      toast("success", "Merged. Undo from the video's History.");
                      router.refresh();
                    }}
                  >
                    <Merge size={13} />
                    {busy === g.key ? "Merging…" : "Merge"}
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}
