import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import LineChart from "@/components/LineChart";
import { Stat, StatGrid, SectionHeading, Empty } from "@/components/Stat";
import VideoTile from "@/components/VideoTile";
import { canManage, PLATFORM_COLORS } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { loadChannelDashboard } from "@/lib/channelDashboard";
import { loadMemberOptions, loadRoles } from "@/lib/dashboards";

const PLATFORM_LABEL: Record<string, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
};

/**
 * One channel's own dashboard: total reach, a reach-over-time curve
 * reconstructed from every one of its videos' snapshots, and the video list
 * behind that curve. This is the "select whichever channel" view -- scoped
 * to a single account, so unlike the Content dashboard it is safe to sum
 * views across its videos: there is only one platform's unit in play.
 */
export default async function ChannelDashboardPage({
  params,
}: {
  params: Promise<{ id: string; accountId: string }>;
}) {
  const { id, accountId } = await params;
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;

  const manages = canManage(session.active.role);
  const [data, workspaceRoles, memberOptions] = await Promise.all([
    loadChannelDashboard(supabase, ws, accountId),
    loadRoles(supabase, ws),
    loadMemberOptions(supabase, ws),
  ]);
  if (!data || data.account.clientId !== id) notFound();

  const { account, totals, series, videos } = data;
  const engagement =
    totals.views > 0 ? ((totals.likes + totals.comments) / totals.views) * 100 : null;

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <Link
        href={`/clients/${id}`}
        className="mb-3 inline-block text-sm text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
      >
        ← {account.clientName ?? "Client"}
      </Link>

      <PageHeader
        title={account.displayName || `@${account.handle.replace(/^@/, "")}`}
        subtitle={`${PLATFORM_LABEL[account.platformSlug] ?? account.platformSlug} · @${account.handle.replace(/^@/, "")}`}
      >
        <span
          className="flex items-center gap-1.5 rounded bg-[var(--bg-subtle)] px-2 py-1 text-xs"
        >
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ background: PLATFORM_COLORS[account.platformSlug] ?? "var(--muted)" }}
          />
          {PLATFORM_LABEL[account.platformSlug] ?? account.platformSlug}
        </span>
      </PageHeader>

      {account.lastSyncError && (
        <div className="mb-4 rounded-md border border-[var(--danger)]/25 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
          {account.lastSyncError}
        </div>
      )}

      <StatGrid>
        <Stat label="Total views" value={totals.views.toLocaleString()} hint="across all tracked videos" />
        <Stat label="Videos tracked" value={String(totals.videos)} />
        <Stat
          label="Engagement"
          value={engagement != null ? `${engagement.toFixed(2)}%` : "—"}
          hint="likes + comments / views"
        />
        <Stat
          label="Last synced"
          value={
            account.lastSyncedAt
              ? new Date(account.lastSyncedAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })
              : "—"
          }
          hint={account.lastSyncedAt ? new Date(account.lastSyncedAt).toLocaleTimeString() : "never"}
        />
      </StatGrid>

      <section className="mb-7">
        <SectionHeading
          title="Reach over time"
          note="Running total across every tracked video on this channel"
        />
        <LineChart data={series} label="Total views" />
      </section>

      <section>
        <SectionHeading title={`Videos (${videos.length})`} />
        {videos.length === 0 ? (
          <Empty>No videos tracked on this channel yet.</Empty>
        ) : (
          <div className="card divide-y divide-[var(--border)] overflow-hidden">
            {videos.map((v) => (
              <VideoTile
                key={v.postId}
                href={`/content?video=${v.id}`}
                workspaceId={ws}
                roles={workspaceRoles}
                members={memberOptions}
                canManage={manages}
                video={{
                  id: v.id,
                  title: v.title,
                  producedAt: v.producedAt,
                  // One account, so one platform -- the tile still shows it
                  // per platform rather than as a bare figure.
                  platforms: [
                    {
                      platform: account.platformSlug,
                      views: v.views,
                      likes: v.likes,
                      comments: v.comments,
                    },
                  ],
                  postCount: 1,
                  credits: v.credits,
                }}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
