"use client";

import { formatDurationShort } from "@/lib/format";
import { hoursPerThousandViews } from "@/lib/rollup";
import PlatformReach from "@/components/PlatformReach";
import VideoTile, { type TileMember, type TileRole } from "@/components/VideoTile";
import LoadMoreList from "@/components/LoadMoreList";
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
  workspaceId,
  roles,
  members,
  canManage = true,
}: {
  client: ClientSummary;
  videos: VideoSummary[];
  workspaceId: string;
  roles: TileRole[];
  members: TileMember[];
  canManage?: boolean;
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
          <LoadMoreList
            className="card divide-y divide-[var(--border)] overflow-hidden"
            items={inProgress.map((v) => (
              <VideoTile
                key={v.id}
                video={v}
                href={`/content?video=${v.id}&client=${client.id}`}
                workspaceId={workspaceId}
                roles={roles}
                members={members}
                canManage={canManage}
              />
            ))}
          />
        </section>
      )}

      <section>
        <SectionHeading title={`Published (${published.length})`} />
        {published.length === 0 ? (
          <Empty>Nothing has been published for this client yet.</Empty>
        ) : (
          <LoadMoreList
            className="card divide-y divide-[var(--border)] overflow-hidden"
            items={published.map((v) => (
              <VideoTile
                key={v.id}
                video={v}
                href={`/content?video=${v.id}&client=${client.id}`}
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
