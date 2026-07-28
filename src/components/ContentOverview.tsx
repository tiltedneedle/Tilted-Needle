"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatDurationShort } from "@/lib/format";
import { engagementRate } from "@/lib/rollup";
import { datedName, downloadCsv, toCsv } from "@/lib/exportCsv";
import { PlatformChips } from "@/components/PlatformReach";
import { Empty, SectionHeading } from "@/components/Stat";
import type { ClientSummary, VideoSummary } from "@/lib/dashboards";

const SORTS = [
  { key: "recent", label: "Newest" },
  { key: "views", label: "Reach" },
  { key: "boost", label: "Boost" },
  { key: "time", label: "Time spent" },
] as const;
type SortKey = (typeof SORTS)[number]["key"];

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
        v.bestIndex?.toFixed(2) ?? "", (v.trackedSeconds / 3600).toFixed(2), "not posted"]);
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
        (v.trackedSeconds / 3600).toFixed(2),
        "published",
      ]);
    }
  }
  downloadCsv(
    datedName("content"),
    toCsv(
      ["Video", "Client", "Produced", "Platform", "Views", "Likes", "Comments",
        "Boost index", "Hours tracked", "Status"],
      out,
    ),
  );
}

export default function ContentOverview({
  videos,
  clients,
}: {
  videos: VideoSummary[];
  clients: ClientSummary[];
}) {
  const [sort, setSort] = useState<SortKey>("recent");

  const rows = useMemo(() => {
    const list = [...videos];
    if (sort === "views") list.sort((a, b) => peakViews(b) - peakViews(a));
    else if (sort === "boost") list.sort((a, b) => (b.bestIndex ?? -1) - (a.bestIndex ?? -1));
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
          />
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                    <th className="px-3 py-2 font-medium">Client</th>
                    <th className="px-3 py-2 text-right font-medium">Videos</th>
                    <th className="px-3 py-2 text-right font-medium">Posts</th>
                    <th className="px-3 py-2 text-right font-medium">Engagement</th>
                    <th className="px-3 py-2 text-right font-medium">Time</th>
                    <th className="px-3 py-2 text-right font-medium">Reach by platform</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {clients.map((c) => {
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
          <div className="card divide-y divide-[var(--border)] overflow-hidden">
            {rows.map((v) => (
              <Link
                key={v.id}
                href={`/content?video=${v.id}`}
                className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--bg-subtle)]"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{v.title}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-[var(--muted)]">
                    {v.clientName && <span>{v.clientName}</span>}
                    {v.producedAt && <span>{v.producedAt}</span>}
                    {v.lengthSeconds != null && (
                      <span className="tabular">
                        {Math.floor(v.lengthSeconds / 60)}:
                        {String(v.lengthSeconds % 60).padStart(2, "0")}
                      </span>
                    )}
                    {v.trackedSeconds > 0 && (
                      <span className="tabular">
                        {formatDurationShort(v.trackedSeconds)} tracked
                      </span>
                    )}
                    {v.postCount === 0 && (
                      <span className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[var(--muted)]">
                        not posted
                      </span>
                    )}
                  </div>
                </div>

                {/* A boost badge only appears once the account has enough
                    history to have a baseline worth beating. */}
                {v.bestIndex != null && v.bestIndex >= 2 && (
                  <span className="tabular shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs font-medium text-emerald-500">
                    {v.bestIndex.toFixed(1)}×
                  </span>
                )}

                <div className="shrink-0">
                  <PlatformChips
                    platforms={v.platforms.map((p) => ({
                      platform: p.platform,
                      views: p.views,
                    }))}
                  />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
