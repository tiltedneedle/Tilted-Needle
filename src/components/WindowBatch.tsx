"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ListVideo, RefreshCw, X } from "lucide-react";
import { listWindowPosts, scrapePostsNow, type WindowPost } from "@/app/actions";
import { useToast } from "@/components/ui/Toast";

/**
 * Shows which videos an account's sync window actually contains, and refreshes
 * a chosen subset.
 *
 * Data sync could say "144 posts, 30-day window" but not WHICH posts that
 * window covered, so the only way to learn what a refresh was about to do was
 * to run it and read the result afterwards. That is a poor trade when the
 * account is metered, and merely opaque when it is not.
 *
 * Two deliberate choices:
 *
 * - Posts OUTSIDE the window are listed too, dimmed and unchecked, rather than
 *   hidden. A window that silently omits the video you were looking for is
 *   indistinguishable from a video that was never imported, and the two have
 *   different fixes -- widen the window, or add the link.
 *
 * - Everything in-window starts CHECKED. The button's job is "refresh this
 *   batch"; making people select thirty rows to get the default behaviour
 *   would be a worse version of the sync button that already exists.
 */
export default function WindowBatch({
  accountId,
  handle,
}: {
  accountId: string;
  handle: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [posts, setPosts] = useState<WindowPost[] | null>(null);
  const [windowDays, setWindowDays] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function load() {
    setOpen(true);
    setLoading(true);
    const res = await listWindowPosts(accountId);
    setLoading(false);
    if ("error" in res) {
      toast("danger", res.error);
      setOpen(false);
      return;
    }
    setPosts(res.posts);
    setWindowDays(res.windowDays);
    setSelected(new Set(res.posts.filter((p) => p.inWindow).map((p) => p.id)));
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function refreshSelected() {
    if (selected.size === 0) return;
    setBusy(true);
    const res = await scrapePostsNow([...selected]);
    setBusy(false);
    if (res.error) return toast("danger", res.error);
    toast("success", res.summary ?? "Refreshed.");
    startTransition(() => router.refresh());
    // Reload so "last read" reflects what just happened rather than what it
    // said when the panel opened.
    void load();
  }

  const inWindow = posts?.filter((p) => p.inWindow).length ?? 0;
  const outside = (posts?.length ?? 0) - inWindow;

  return (
    <>
      <button
        className="btn py-1 text-xs"
        onClick={() => void load()}
        title={`Show the videos @${handle.replace(/^@/, "")}'s window covers`}
      >
        <ListVideo size={13} strokeWidth={1.8} />
        Videos
      </button>

      {open && (
        <div
          className="fixed inset-0 grid place-items-center p-4"
          style={{ zIndex: "var(--z-modal)", background: "var(--scrim)" }}
          role="dialog"
          aria-modal="true"
          aria-label={`Videos in the sync window for ${handle}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          {/* Chrome tier, applied through the tokens rather than a class:
              .glass-chrome was deleted as dead code, and Popover and Toast --
              the two surfaces this most resembles -- have always styled
              themselves this way. */}
          <div
            className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden"
            style={{
              background: "var(--glass-bg)",
              backdropFilter: "var(--glass-filter)",
              WebkitBackdropFilter: "var(--glass-filter)",
              border: "1px solid var(--rim-line)",
              borderRadius: "var(--radius-lg)",
              boxShadow: "var(--shadow-overlay)",
            }}
          >
            <div className="flex items-start justify-between gap-3 border-b border-[var(--rim-line)] p-4">
              <div>
                <h2 className="text-sm font-semibold">@{handle.replace(/^@/, "")}</h2>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  {loading
                    ? "Reading…"
                    : `${inWindow} in the ${windowDays == null ? "all-time" : `${windowDays}-day`} window` +
                      (outside > 0 ? ` · ${outside} older, not selected` : "")}
                </p>
              </div>
              <button
                className="btn-ghost p-1"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <X size={16} strokeWidth={1.8} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading && <div className="empty m-4">Reading the window…</div>}
              {!loading && posts?.length === 0 && (
                <div className="empty m-4">
                  No videos are linked to this account yet.
                </div>
              )}
              {!loading &&
                posts?.map((p) => (
                  <label
                    key={p.id}
                    className={`flex cursor-pointer items-center gap-3 border-b border-[var(--rim-line)] px-4 py-2.5 transition-colors hover:bg-[var(--bg-subtle)] ${
                      p.inWindow ? "" : "opacity-55"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="size-4 shrink-0 accent-[var(--accent)]"
                      checked={selected.has(p.id)}
                      onChange={() => toggle(p.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{p.title}</span>
                      <span className="text-xs text-[var(--muted)]">
                        {p.postedAt ?? "no date"}
                        {!p.inWindow && " · outside the window"}
                        {p.lastScrapedAt && ` · last read ${p.lastScrapedAt.slice(0, 10)}`}
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-sm">
                      {p.views != null ? p.views.toLocaleString() : "—"}
                    </span>
                  </label>
                ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--rim-line)] p-3">
              <button
                className="btn py-1 text-xs"
                onClick={() => setSelected(new Set(posts?.map((p) => p.id) ?? []))}
                disabled={loading || busy}
              >
                Select all
              </button>
              <button
                className="btn py-1 text-xs"
                onClick={() => setSelected(new Set())}
                disabled={loading || busy}
              >
                Clear
              </button>
              <div className="flex-1" />
              <button
                className="btn-primary py-1.5 text-xs"
                onClick={() => void refreshSelected()}
                disabled={busy || loading || selected.size === 0}
              >
                <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
                {busy ? "Refreshing…" : `Refresh ${selected.size} selected`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
