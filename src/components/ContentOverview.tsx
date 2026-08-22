"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { formatDurationShort, gainPerDay } from "@/lib/format";
import { engagementRate } from "@/lib/rollup";
import { datedName, downloadCsv, toCsv } from "@/lib/exportCsv";
import { PlatformChips } from "@/components/PlatformReach";
import VideoTile, { type TileMember, type TileRole } from "@/components/VideoTile";
import LoadMoreList from "@/components/LoadMoreList";
import BulkBar, { type CreditUndo } from "@/components/BulkBar";
import MergeSuggestions from "@/components/MergeSuggestions";
import {
  bulkAssignRole,
  bulkUnassignRole,
  restoreContentClients,
  type ClientAssignment,
} from "@/app/actions";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { Undo2 } from "lucide-react";
import { Empty, SectionHeading } from "@/components/Stat";
import { FILTER_KEYS } from "@/lib/contentFilters";
import type { ClientSummary, VideoSummary } from "@/lib/dashboards";
import type { Account } from "@/lib/types";

const SORTS = [
  { key: "recent", label: "Newest" },
  { key: "views", label: "Reach" },
  { key: "boost", label: "Boost" },
  { key: "growth", label: "Growing" },
  { key: "time", label: "Time spent" },
] as const;
type SortKey = (typeof SORTS)[number]["key"];

const CLIENT_SORTS = [
  { key: "videos", label: "Videos" },
  { key: "reach", label: "Reach" },
  { key: "growth", label: "Growing" },
  { key: "time", label: "Time" },
  { key: "name", label: "Name" },
] as const;
type ClientSortKey = (typeof CLIENT_SORTS)[number]["key"];

/** Highest single-platform view count, used only for ordering within a list. */
function peakViews(v: VideoSummary): number {
  return v.platforms.reduce((m, p) => Math.max(m, p.views), 0);
}

/**
 * One row per video per platform. Flattening this way rather than one row per
 * video with a "total views" column is the whole point: a combined figure
 * across platforms would be meaningless, and a spreadsheet is exactly where
 * someone would be tempted to sum it.
 */
function exportVideos(rows: VideoSummary[]) {
  const out: unknown[][] = [];
  for (const v of rows) {
    if (v.platforms.length === 0) {
      // Twelve cells, matching the header. This row used to push eleven --
      // "Views gained" was written but the empty "Gain window" beside it was
      // not -- so hours slid into the gain column and the status into hours.
      // It affected two videos until the Socials Review backfill landed 158
      // more that have no post, which is exactly the kind of latent bug that
      // stays invisible until the data changes shape underneath it.
      out.push([v.title, v.clientName ?? "", v.producedAt ?? "", "", "", "", "",
        v.bestIndex?.toFixed(2) ?? "", "", "",
        // "no link", not "not posted" -- the export is the version that gets
        // mailed to people, so a claim it cannot support travels furthest.
        (v.trackedSeconds / 3600).toFixed(2), "no link"]);
      continue;
    }
    for (const p of v.platforms) {
      out.push([
        v.title,
        v.clientName ?? "",
        v.producedAt ?? "",
        p.platform,
        p.views,
        p.likes,
        p.comments,
        v.bestIndex?.toFixed(2) ?? "",
        v.recentGain?.views ?? "",
        v.recentGain ? v.recentGain.days.toFixed(1) : "",
        (v.trackedSeconds / 3600).toFixed(2),
        "published",
      ]);
    }
  }
  downloadCsv(
    datedName("content"),
    toCsv(
      ["Video", "Client", "Produced", "Platform", "Views", "Likes", "Comments",
        "Boost index", "Views gained", "Gain window (days)", "Hours tracked", "Status"],
      out,
    ),
  );
}

export default function ContentOverview({
  videos,
  clients,
  workspaceId,
  roles,
  members,
  accounts = [],
  canManage = true,
}: {
  videos: VideoSummary[];
  clients: ClientSummary[];
  workspaceId: string;
  roles: TileRole[];
  members: TileMember[];
  /**
   * Every account in the workspace, so a row with no link can be given one
   * from the list. Optional so the other call sites are untouched; a tile
   * without them simply keeps the old "open the video to add a link" badge.
   */
  accounts?: Account[];
  canManage?: boolean;
}) {
  /**
   * Sort lives in the URL so it survives a refresh and travels in a shared
   * link -- which is what this page already promises about its filters, and
   * what "they should stay on the videos all time" asks for.
   *
   * Written with history.replaceState rather than router.push: Next documents
   * this exactly (app/guides/single-page-applications, "Shallow routing on
   * the client") and its own example is a ?sort= param. pushState and
   * replaceState integrate with the router and sync into useSearchParams, so
   * the URL updates with NO server round-trip. That matters here -- this page
   * re-queries five tables, and paying for that on every click of a purely
   * presentational control would make sorting feel broken.
   *
   * replaceState, not pushState: sorting is not a place you navigated to, and
   * pushState would make Back walk through every sort you tried instead of
   * leaving the page.
   */
  const searchParams = useSearchParams();
  const urlSort = searchParams.get("sort");
  // Unknown values degrade to the default rather than throwing, matching how
  // every other filter param is parsed -- a mangled shared link opens the
  // page, it does not break it.
  const sort: SortKey = SORTS.some((s) => s.key === urlSort)
    ? (urlSort as SortKey)
    : "recent";

  const setSort = useCallback(
    (key: SortKey) => {
      const next = new URLSearchParams(searchParams.toString());
      if (key === "recent") next.delete("sort");
      else next.set("sort", key);
      const qs = next.toString();
      window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
    },
    [searchParams],
  );

  const [clientSort, setClientSort] = useState<ClientSortKey>("videos");
  // Selection is local and deliberately NOT in the URL: it is a scratch pad
  // for one action, not a view worth sharing, and a shared link that arrived
  // with videos pre-selected would be a way to get someone to merge the wrong
  // rows.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Survives the selection being cleared, which is exactly the moment the
  // bulk bar disappears and an undo starts being wanted.
  const [undoMove, setUndoMove] = useState<{
    label: string;
    previous: ClientAssignment[];
  } | null>(null);
  // Same reason as undoMove: a bulk credit clears the selection, the bar goes
  // away with it, and an undo that lived in the bar would leave with it.
  const [undoCredit, setUndoCredit] = useState<CreditUndo | null>(null);

  /**
   * A selection belongs to the list it was made in.
   *
   * Change the client filter and the rows underneath are replaced, but the
   * ticked ids were not -- so the bulk bar went on saying "12 selected" and
   * would credit, move or MERGE twelve videos the user could no longer see.
   * Merge deletes rows, so the worst case is destructive and entirely
   * invisible: nothing on screen belongs to the action being taken.
   *
   * Keyed on the FILTER params only. Sort is in the same query string but
   * reordering a list does not change which videos are in it, and clearing a
   * selection because somebody pressed "Reach" would be its own small
   * betrayal. Rows cannot be the key either: they are a new array every
   * render, and selection would be impossible.
   */
  const filterKey = FILTER_KEYS.map((k) => `${k}=${searchParams.get(k) ?? ""}`).join("&");
  /* Adjusted during render rather than in an effect. The effect version
     committed one frame where the new filter's rows carried the OLD
     selection -- checkboxes ticked on videos that just entered the list --
     before the reset landed. The previous-value comparison re-renders before
     paint, so that frame never exists. */
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setSelected(new Set());
    setUndoMove(null);
    setUndoCredit(null);
  }

  // Clients are ranked on peak single-platform reach rather than a sum, for
  // the same reason nothing else here totals across platforms.
  const sortedClients = useMemo(() => {
    const list = [...clients];
    if (clientSort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    else if (clientSort === "reach")
      list.sort(
        (a, b) =>
          Math.max(0, ...b.totals.map((t) => t.views)) -
          Math.max(0, ...a.totals.map((t) => t.views)),
      );
    else if (clientSort === "growth") list.sort((a, b) => b.recentGain - a.recentGain);
    else if (clientSort === "time") list.sort((a, b) => b.trackedSeconds - a.trackedSeconds);
    else list.sort((a, b) => b.videoCount - a.videoCount);

    /**
     * With a filter applied, clients holding nothing are dropped.
     *
     * Unfiltered, an empty client is real information -- "we have signed
     * Kyoto and published nothing for them yet" is worth seeing, and hiding
     * it would make the roster silently incomplete. So the base case keeps
     * every row.
     *
     * Once a filter narrows the page, the same row means something much
     * weaker: "this client has nothing matching THIS filter", which is true
     * of almost everyone and pushes the one or two clients that do match off
     * the bottom. Selecting a single client is the extreme case -- eight rows
     * of zeroes around the one row you asked for.
     *
     * Note this reads the URL rather than a prop: the filters are already the
     * page's source of truth (they are what makes a view shareable), so
     * deriving from them keeps this in step with any filter added later
     * without threading a new prop through.
     */
    const filtered = FILTER_KEYS.some((k) => {
      const v = searchParams.get(k);
      return v != null && v !== "";
    });
    if (!filtered) return list;
    return list.filter(
      (c) => c.videoCount > 0 || c.postCount > 0 || c.recentGain > 0 || c.trackedSeconds > 0,
    );
  }, [clients, clientSort, searchParams]);

  const rows = useMemo(() => {
    const list = [...videos];
    if (sort === "views") list.sort((a, b) => peakViews(b) - peakViews(a));
    else if (sort === "boost") list.sort((a, b) => (b.bestIndex ?? -1) - (a.bestIndex ?? -1));
    else if (sort === "growth")
      // By RATE, not raw gain. Sorting by the raw number ranked whichever
      // video happened to be measured over the longest gap, because the gap
      // is set by scrape cadence and runs from hours to a fortnight here.
      // Measured on live data: a post gaining 8,937 in 3.4 days (2,641/day)
      // sorted BELOW one gaining 35,736 in 14.1 days (2,543/day). "Growing"
      // now means growing.
      //
      // Rows whose gap is too short to divide sort BELOW every row that has a
      // rate, then among themselves by raw gain. Falling back to the raw
      // number inline put "+600 over 0.2 days" above "+470/day" -- comparing a
      // total against a rate, which is the exact mistake this sort exists to
      // stop. We cannot say those rows are growing faster, so they do not get
      // to claim it.
      list.sort((a, b) => {
        const ra = gainPerDay(a.recentGain);
        const rb = gainPerDay(b.recentGain);
        if (ra != null && rb != null) return rb - ra;
        if (ra != null) return -1;
        if (rb != null) return 1;
        return (b.recentGain?.views ?? -1) - (a.recentGain?.views ?? -1);
      });
    else if (sort === "time") list.sort((a, b) => b.trackedSeconds - a.trackedSeconds);
    else list.sort((a, b) => (b.producedAt ?? "").localeCompare(a.producedAt ?? ""));
    return list;
  }, [videos, sort]);

  return (
    <>
      {clients.length > 0 && (
        <section className="mb-7">
          <SectionHeading
            title="Clients"
            note="Reach shown per platform — never added together"
          >
            {/* py-1, not py-0.5, on every chip in this file and in the video
                row below. At 0.5 these measured 20px tall on a phone, under
                the 24px minimum tap target -- and these are not decoration,
                they are the sort and select controls someone thumbs through
                on the way to a video. 12px text + 4px each side lands exactly
                on 24. Do not shrink them back for density. */}
            <div className="flex flex-wrap items-center gap-1">
              {CLIENT_SORTS.map((s) => (
                <button
                  key={s.key}
                  className={`rounded px-2 py-1 text-xs transition-colors ${
                    clientSort === s.key
                      ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                      : "text-[var(--muted)] hover:bg-[var(--border)]"
                  }`}
                  onClick={() => setClientSort(s.key)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </SectionHeading>
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                    <th className="px-3 py-2 font-medium">Client</th>
                    <th className="px-3 py-2 text-right font-medium">Videos</th>
                    <th className="px-3 py-2 text-right font-medium">Posts</th>
                    <th className="px-3 py-2 text-right font-medium">Engagement</th>
                    <th className="px-3 py-2 text-right font-medium">Growing</th>
                    <th className="px-3 py-2 text-right font-medium">Time</th>
                    <th className="px-3 py-2 text-right font-medium">Reach by platform</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {sortedClients.map((c) => {
                    // Engagement is averaged across platforms, not pooled: each
                    // platform's rate is computed on its own denominator first.
                    const rates = c.totals
                      .map(engagementRate)
                      .filter((r): r is number => r != null);
                    const avg = rates.length
                      ? rates.reduce((s, r) => s + r, 0) / rates.length
                      : null;
                    return (
                      <tr
                        key={c.id}
                        className="transition-colors hover:bg-[var(--bg-subtle)]"
                      >
                        <td className="px-3 py-2.5">
                          <Link
                            href={`/content?client=${c.id}`}
                            className="font-medium transition-colors hover:text-[var(--accent)]"
                          >
                            {c.name}
                          </Link>
                        </td>
                        <td className="tabular px-3 py-2.5 text-right">{c.videoCount}</td>
                        <td className="tabular px-3 py-2.5 text-right text-[var(--muted)]">
                          {c.postCount}
                        </td>
                        <td className="tabular px-3 py-2.5 text-right text-[var(--muted)]">
                          {avg != null ? `${(avg * 100).toFixed(2)}%` : "—"}
                        </td>
                        <td className="tabular px-3 py-2.5 text-right">
                          {c.recentGain > 0 ? (
                            <span className="text-[var(--success)]">
                              +{c.recentGain.toLocaleString()}
                            </span>
                          ) : (
                            <span className="text-[var(--muted)]">—</span>
                          )}
                        </td>
                        <td className="tabular px-3 py-2.5 text-right text-[var(--muted)]">
                          {c.trackedSeconds ? formatDurationShort(c.trackedSeconds) : "—"}
                        </td>
                        <td className="px-3 py-2.5">
                          <PlatformChips
                            platforms={c.totals.map((t) => ({
                              platform: t.platform,
                              views: t.views,
                            }))}
                            emptyText="nothing published"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      <section>
        <SectionHeading title={`Videos (${rows.length})`}>
          <div className="flex flex-wrap items-center gap-1">
            {/* Lives in the row that already exists, beside Export and the
                sorts -- no new page, no new section, no mode to navigate
                into. Turning it off clears the selection, so leaving the mode
                cannot leave a stale selection behind acting on later clicks. */}
            {canManage && (
              <button
                className={`mr-1 rounded px-2 py-1 text-xs transition-colors ${
                  selecting
                    ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                    : "text-[var(--muted)] hover:bg-[var(--border)] hover:text-[var(--fg)]"
                }`}
                onClick={() => {
                  setSelecting((v) => !v);
                  setSelected(new Set());
                }}
                title="Pick several videos to credit, move, or merge together"
              >
                {selecting ? "Done" : "Select"}
              </button>
            )}
            <button
              className="mr-1 rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--fg)]"
              onClick={() => exportVideos(rows)}
              title="Download exactly what is on screen, filters included"
            >
              Export CSV
            </button>
            {SORTS.map((s) => (
              <button
                key={s.key}
                className={`rounded px-2 py-1 text-xs transition-colors ${
                  sort === s.key
                    ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                    : "text-[var(--muted)] hover:bg-[var(--border)]"
                }`}
                onClick={() => setSort(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </SectionHeading>

        {selecting && selected.size > 0 && (
          <BulkBar
            workspaceId={workspaceId}
            selected={[...selected]}
            titles={Object.fromEntries(rows.map((v) => [v.id, v.title]))}
            platformsById={Object.fromEntries(
              rows.map((v) => [v.id, v.platforms.map((p) => p.platform)]),
            )}
            creditsById={Object.fromEntries(rows.map((v) => [v.id, v.credits ?? []]))}
            roles={roles}
            members={members}
            clients={clients.map((c) => ({ id: c.id, name: c.name }))}
            onClear={() => setSelected(new Set())}
            onUndoableMove={setUndoMove}
            onUndoableCredit={setUndoCredit}
          />
        )}

        {undoMove && (
          <UndoMove
            workspaceId={workspaceId}
            undo={undoMove}
            onDismiss={() => setUndoMove(null)}
          />
        )}

        {undoCredit && (
          <UndoCredit
            workspaceId={workspaceId}
            undo={undoCredit}
            onDismiss={() => setUndoCredit(null)}
          />
        )}

        {rows.length === 0 ? (
          <Empty>No videos match these filters.</Empty>
        ) : (
          <LoadMoreList
            resetKey={sort}
            className="card divide-y divide-[var(--border)] overflow-hidden"
            items={rows.map((v) => (
              <VideoTile
                key={v.id}
                video={v}
                href={`/content?video=${v.id}`}
                workspaceId={workspaceId}
                roles={roles}
                members={members}
                canManage={canManage}
                // Only this video's client can own the post. Attaching a link
                // to another client's account would credit their baseline with
                // numbers nobody there produced.
                accounts={accounts.filter((a) => a.client_id === v.clientId)}
                selectable={selecting}
                selected={selected.has(v.id)}
                // A row's credit circles are ALWAYS one video, selection or
                // not. They used to write to the whole selection when the row
                // was ticked, which made the same gesture mean two different
                // things depending on a checkbox -- and made "fix this one
                // video" impossible to do while a batch was up. Everything
                // that acts on the batch is in the bar now.
                onToggleSelect={() =>
                  setSelected((s) => {
                    const next = new Set(s);
                    if (next.has(v.id)) next.delete(v.id);
                    else next.add(v.id);
                    return next;
                  })
                }
              />
            ))}
          />
        )}

        {/* Fed the FILTERED list on purpose. Scoped to what is on screen it
            answers "are there duplicates in what I am looking at"; fed
            everything it would keep proposing merges for a client you are not
            currently looking at, from a panel sitting under their videos. */}
        <MergeSuggestions videos={rows} canManage={canManage} />
      </section>
    </>
  );
}

/**
 * The way back from a bulk move.
 *
 * Deliberately a strip in the page rather than a toast action: a toast is
 * gone in a few seconds, and the moment you realise a move was wrong is
 * usually the moment after you look at the result. This stays until it is
 * used or dismissed.
 *
 * It restores each video to ITS OWN previous client, not to one shared value.
 * A single move can gather videos from several clients, and undoing that to
 * whichever client happened to be first would be a quieter repeat of the bug
 * the undo exists for.
 */
/**
 * The way back from a bulk credit or a bulk removal.
 *
 * It reverses by doing the opposite write over the SAME ids the action
 * reported touching -- not over the selection, which is already gone by now
 * and was never the right set anyway: crediting five videos where two already
 * had the credit inserts three rows, and putting back five would be an edit
 * rather than an undo.
 */
function UndoCredit({
  workspaceId,
  undo,
  onDismiss,
}: {
  workspaceId: string;
  undo: CreditUndo;
  onDismiss: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2 text-xs">
      <span className="min-w-0 flex-1 text-[var(--muted)]">{undo.label}</span>
      <button
        className="btn flex items-center gap-1.5 px-2.5 py-1 text-xs"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const args = {
            workspaceId,
            contentItemIds: undo.ids,
            userId: undo.userId,
            roleId: undo.roleId,
          };
          const res =
            undo.kind === "credited"
              ? await bulkUnassignRole(args)
              : await bulkAssignRole(args);
          setBusy(false);
          if (res.error) return toast("danger", res.error);
          const n =
            undo.kind === "credited"
              ? ((res as { removed?: number }).removed ?? 0)
              : ((res as { added?: number }).added ?? 0);
          toast(
            "success",
            `${n} video${n === 1 ? "" : "s"} put back.`,
          );
          onDismiss();
          router.refresh();
        }}
      >
        <Undo2 size={13} />
        {busy ? "Undoing…" : "Undo"}
      </button>
      <button
        className="rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--fg)]"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        Dismiss
      </button>
    </div>
  );
}

function UndoMove({
  workspaceId,
  undo,
  onDismiss,
}: {
  workspaceId: string;
  undo: { label: string; previous: ClientAssignment[] };
  onDismiss: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2 text-xs">
      <span className="min-w-0 flex-1 text-[var(--muted)]">{undo.label}</span>
      <button
        className="btn flex items-center gap-1.5 px-2.5 py-1 text-xs"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const res = await restoreContentClients({ workspaceId, previous: undo.previous });
          setBusy(false);
          if (res.error) return toast("danger", res.error);
          toast("success", `${res.restored ?? 0} put back.`);
          onDismiss();
          router.refresh();
        }}
      >
        <Undo2 size={13} />
        {busy ? "Undoing…" : "Undo"}
      </button>
      <button
        className="rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--fg)]"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        Dismiss
      </button>
    </div>
  );
}
