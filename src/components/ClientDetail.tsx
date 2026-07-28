"use client";

import Link from "next/link";
import { formatDurationShort } from "@/lib/format";
import { hoursPerThousandViews } from "@/lib/rollup";
import PlatformReach, { PlatformChips } from "@/components/PlatformReach";
import { Stat, StatGrid, SectionHeading, Empty } from "@/components/Stat";
import type { ClientSummary, VideoSummary } from "@/lib/dashboards";

/**
 * One client, in full: what has been delivered for them and how it landed.
 * This is the view that answers "what did you actually get us", so it leads
 * with delivery and reach rather than internal process.
 */
export default function ClientDetail({
  client,
  videos,
}: {
  client: ClientSummary;
  videos: VideoSummary[];
}) {
  const published = videos.filter((v) => v.postCount > 0);
  const inProgress = videos.filter((v) => v.postCount === 0);

  // Best performer by boost index, falling back to raw reach when nothing has
  // enough account history to be scored yet.
  const best =
    [...published].sort((a, b) => (b.bestIndex ?? 0) - (a.bestIndex ?? 0))[0] ?? null;

  return (
    <>
      <StatGrid>
        <Stat
          label="Videos delivered"
          value={String(published.length)}
          hint={inProgress.length ? `${inProgress.length} in progress` : "all published"}
        />
        {/* Post count is deliberately not a stat here -- it is already
            visible per platform in the reach table below, and a client cares
            about what was delivered, not how many rows that made. */}
        <Stat
          label="Time invested"
          value={client.trackedSeconds ? formatDurationShort(client.trackedSeconds) : "—"}
          hint="tracked internally"
        />
        <Stat
          label="Still growing"
          value={client.recentGain > 0 ? `+${client.recentGain.toLocaleString()}` : "—"}
          hint={
            client.recentGain > 0
              ? "views since the last snapshots"
              : "needs two snapshots to compare"
          }
          accent={client.recentGain > 0}
        />
        <Stat
          label="Best performer"
          value={best?.bestIndex != null ? `${best.bestIndex.toFixed(1)}×` : "—"}
          hint={best?.bestIndex != null ? "over account baseline" : "not enough history"}
          accent={best?.bestIndex != null && best.bestIndex >= 2}
        />
      </StatGrid>

      <section className="mb-7">
        <SectionHeading
          title="Delivered reach by platform"
          note="Shown per platform — the counts are different units"
        />
        <PlatformReach totals={client.totals} />
        {client.trackedSeconds > 0 && client.totals.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--muted)]">
            {client.totals.map((t) => {
              const hpk = hoursPerThousandViews(client.trackedSeconds, t.views);
              if (hpk == null) return null;
              return (
                <span key={t.platform} title="Hours of tracked work per 1,000 views">
                  <span className="capitalize">{t.platform}</span>{" "}
                  <span className="tabular text-[var(--fg)]">{hpk.toFixed(2)}</span> h / 1k
                  views
                </span>
              );
            })}
          </div>
        )}
      </section>

      {inProgress.length > 0 && (
        <section className="mb-7">
          <SectionHeading
            title={`In progress (${inProgress.length})`}
            note="Not posted anywhere yet"
          />
          <div className="card divide-y divide-[var(--border)] overflow-hidden">
            {inProgress.map((v) => (
              <Link
                key={v.id}
                href={`/content?video=${v.id}`}
                className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-[var(--bg-subtle)]"
              >
                <span className="size-1.5 shrink-0 rounded-full bg-amber-500" />
                <span className="min-w-0 flex-1 truncate text-sm">{v.title}</span>
                {v.trackedSeconds > 0 && (
                  <span className="tabular shrink-0 text-xs text-[var(--muted)]">
                    {formatDurationShort(v.trackedSeconds)}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionHeading title={`Published (${published.length})`} />
        {published.length === 0 ? (
          <Empty>Nothing has been published for this client yet.</Empty>
        ) : (
          <div className="card divide-y divide-[var(--border)] overflow-hidden">
            {published.map((v) => (
              <Link
                key={v.id}
                href={`/content?video=${v.id}&client=${client.id}`}
                className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--bg-subtle)]"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{v.title}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-xs text-[var(--muted)]">
                    {v.producedAt && <span>{v.producedAt}</span>}
                    {v.lengthSeconds != null && (
                      <span className="tabular">
                        {Math.floor(v.lengthSeconds / 60)}:
                        {String(v.lengthSeconds % 60).padStart(2, "0")}
                      </span>
                    )}
                  </div>
                </div>
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
