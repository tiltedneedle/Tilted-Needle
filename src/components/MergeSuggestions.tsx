"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Merge, Undo2 } from "lucide-react";
import PlatformIcon from "@/components/PlatformIcon";
import { useToast } from "@/components/ui/Toast";
import { mergeContentItems, undoContentMerge } from "@/app/actions";
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
  // group key -> the merge id the database handed back.
  //
  // Keeping the id rather than just "this one is done" is what makes the undo
  // reachable at all. undo_content_merge and its server action both existed
  // already and nothing called either, so merge -- the most destructive action
  // in the product -- was advertised as reversible while being one-way.
  const [done, setDone] = useState<Map<string, string>>(new Map());

  const groups = useMemo(() => findMergeCandidates(videos), [videos]);
  // Merged groups stay in the list showing an Undo, rather than vanishing.
  // A row that disappears the instant you act on it is exactly the row you
  // cannot get back when you realise it was the wrong call.
  const remaining = groups.filter((g) => !done.has(g.key) || done.get(g.key));

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
        {/* Counts what is still UNMERGED. Merged rows stay listed so their
            Undo stays reachable, but they are no longer work to do. */}
        <span className="text-xs text-[var(--muted)]">
          {groups.filter((g) => !done.has(g.key)).length} look like the same video on two platforms
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
                  {done.has(g.key) ? (
                    <button
                      className="flex shrink-0 items-center gap-1.5 rounded px-2.5 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--fg)]"
                      disabled={busy === g.key}
                      title="Split these back into separate videos"
                      onClick={async () => {
                        const mergeId = done.get(g.key);
                        if (!mergeId) return;
                        setBusy(g.key);
                        const res = await undoContentMerge(mergeId);
                        setBusy(null);
                        if (res.error) return toast("danger", res.error);
                        setDone((m) => {
                          const next = new Map(m);
                          next.delete(g.key);
                          return next;
                        });
                        toast("success", "Split back into separate videos.");
                        router.refresh();
                      }}
                    >
                      <Undo2 size={13} />
                      {busy === g.key ? "Undoing…" : "Merged · Undo"}
                    </button>
                  ) : (
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
                        // person -- "these are different videos: two of them
                        // are posted to the same account" -- so it is shown
                        // as-is.
                        if (res.error) return toast("danger", res.error);
                        if (!res.mergeId) {
                          // No id means no way back, so say that rather than
                          // offering an Undo that would do nothing.
                          toast("warning", "Merged, but this one cannot be undone.");
                          router.refresh();
                          return;
                        }
                        setDone((m) => new Map(m).set(g.key, res.mergeId as string));
                        toast("success", "Merged.");
                        router.refresh();
                      }}
                    >
                      <Merge size={13} />
                      {busy === g.key ? "Merging…" : "Merge"}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}
