import { PLATFORM_COLORS } from "@/lib/types";
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
      <div className="card p-8 text-center text-sm text-[var(--muted)]">{emptyText}</div>
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
            <div className="flex flex-wrap items-baseline gap-2">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: color }}
              />
              <span className="text-sm font-medium capitalize">{t.platform}</span>
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
          title={`${p.platform}: ${p.views.toLocaleString()} views`}
        >
          <span
            className="size-1.5 rounded-full"
            style={{ background: PLATFORM_COLORS[p.platform] ?? "var(--muted)" }}
          />
          <span className="tabular">{p.views.toLocaleString()}</span>
        </span>
      ))}
    </span>
  );
}
