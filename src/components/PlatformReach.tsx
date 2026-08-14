import { PLATFORM_COLORS, PLATFORM_LABEL } from "@/lib/types";
import PlatformIcon from "@/components/PlatformIcon";
import { engagementRate, type PlatformTotals } from "@/lib/rollup";

/**
 * Reach per platform, as bars scaled within each platform's own row rather
 * than against a shared axis. Bars are deliberately not comparable to each
 * other: a TikTok view and a YouTube view are different units, and a single
 * shared axis would silently invite exactly the comparison the whole scoring
 * model exists to prevent (PRD 5 Step 2).
 */
export default function PlatformReach({
  totals,
  emptyText = "Nothing published yet.",
}: {
  totals: PlatformTotals[];
  emptyText?: string;
}) {
  if (totals.length === 0) {
    return (
      <div className="empty">{emptyText}</div>
    );
  }

  const peak = Math.max(...totals.map((t) => t.views), 1);

  return (
    <div className="card divide-y divide-[var(--border)] overflow-hidden">
      {totals.map((t) => {
        const eng = engagementRate(t);
        const color = PLATFORM_COLORS[t.platform] ?? "var(--muted)";
        return (
          <div key={t.platform} className="px-3 py-2.5">
            {/* items-baseline stays: the big view count and the small labels
                beside it are aligned on their baselines, and centring them
                instead would drift the row. The icon opts out with self-center,
                since an SVG's baseline is its bottom edge. */}
            <div className="flex flex-wrap items-baseline gap-2">
              <PlatformIcon platform={t.platform} size={17} className="self-center" />
              {/* PLATFORM_LABEL rather than capitalize: "youtube_shorts"
                  title-cases into "Youtube_shorts", and "TikTok" has a capital
                  in the middle that no CSS transform will find. */}
              <span className="text-sm font-medium">
                {PLATFORM_LABEL[t.platform] ?? t.platform}
              </span>
              <span className="tabular text-lg font-semibold">
                {t.views.toLocaleString()}
              </span>
              <span className="text-xs text-[var(--muted)]">views</span>
              <div className="flex-1" />
              <span className="text-xs text-[var(--muted)]">
                {t.posts} post{t.posts === 1 ? "" : "s"}
              </span>
            </div>

            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--bg-subtle)]">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{
                  width: `${Math.max(2, (t.views / peak) * 100)}%`,
                  background: color,
                  opacity: 0.85,
                }}
              />
            </div>

            <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--muted)]">
              <span>
                Likes <span className="tabular text-[var(--fg)]">{t.likes.toLocaleString()}</span>
              </span>
              <span>
                Comments{" "}
                <span className="tabular text-[var(--fg)]">{t.comments.toLocaleString()}</span>
              </span>
              {eng != null && (
                <span>
                  Engagement{" "}
                  <span className="tabular text-[var(--fg)]">{(eng * 100).toFixed(2)}%</span>
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Compact inline chips, for table rows where a full bar would be too heavy. */
export function PlatformChips({
  platforms,
  emptyText = "not posted",
}: {
  platforms: { platform: string; views: number }[];
  emptyText?: string;
}) {
  if (platforms.length === 0) {
    return <span className="text-xs text-[var(--muted)]">{emptyText}</span>;
  }
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {platforms.map((p) => (
        <span
          key={p.platform}
          className="flex items-center gap-1 rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-xs"
          title={`${PLATFORM_LABEL[p.platform] ?? p.platform}: ${p.views.toLocaleString()} views`}
        >
          {/* Smaller here than in the reach table: a chip sits inside a dense
              table row, and the mark is identification, not decoration. */}
          <PlatformIcon platform={p.platform} size={12} />
          <span className="tabular">{p.views.toLocaleString()}</span>
        </span>
      ))}
    </span>
  );
}
