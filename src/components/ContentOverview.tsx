"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatDurationShort } from "@/lib/format";
import { engagementRate } from "@/lib/rollup";
import { datedName, downloadCsv, toCsv } from "@/lib/exportCsv";
import { PlatformChips } from "@/components/PlatformReach";
import VideoTile, { type TileMember, type TileRole } from "@/components/VideoTile";
import LoadMoreList from "@/components/LoadMoreList";
import { Empty, SectionHeading } from "@/components/Stat";
import type { ClientSummary, VideoSummary } from "@/lib/dashboards";

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
      out.push([v.title, v.clientName ?? "", v.producedAt ?? "", "", "", "", "",
        v.bestIndex?.toFixed(2) ?? "", v.recentGain ?? "",
        (v.trackedSeconds / 3600).toFixed(2), "not posted"]);
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
  canManage = true,
}: {
  videos: VideoSummary[];
  clients: ClientSummary[];
  workspaceId: string;
  roles: TileRole[];
  members: TileMember[];
  canManage?: boolean;
}) {
  const [sort, setSort] = useState<SortKey>("recent");
  const [clientSort, setClientSort] = useState<ClientSortKey>("videos");

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
    return list;
  }, [clients, clientSort]);

  const rows = useMemo(() => {
    const list = [...videos];
    if (sort === "views") list.sort((a, b) => peakViews(b) - peakViews(a));
    else if (sort === "boost") list.sort((a, b) => (b.bestIndex ?? -1) - (a.bestIndex ?? -1));
    else if (sort === "growth")
      list.sort((a, b) => (b.recentGain?.views ?? -1) - (a.recentGain?.views ?? -1));
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
            <div className="flex flex-wrap items-center gap-1">
              {CLIENT_SORTS.map((s) => (
                <button
                  key={s.key}
                  className={`rounded px-2 py-0.5 text-xs transition-colors ${
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
                            <span className="text-emerald-500">
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
            <button
              className="mr-1 rounded px-2 py-0.5 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--fg)]"
              onClick={() => exportVideos(rows)}
              title="Download exactly what is on screen, filters included"
            >
              Export CSV
            </button>
            {SORTS.map((s) => (
              <button
                key={s.key}
                className={`rounded px-2 py-0.5 text-xs transition-colors ${
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
              />
            ))}
          />
        )}
      </section>
    </>
  );
}
