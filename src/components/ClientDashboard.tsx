"use client";

import Link from "next/link";
import { formatDurationShort } from "@/lib/format";
import { PLATFORM_COLORS } from "@/lib/types";
import {
  engagementRate,
  hoursPerThousandViews,
  type PlatformTotals,
} from "@/lib/rollup";

export default function ClientDashboard({
  clientId,
  totals,
  itemCount,
  trackedSeconds,
  items,
  readOnly = false,
}: {
  /** Used to build the video link back into the dashboard's own filters. */
  clientId?: string;
  totals: PlatformTotals[];
  itemCount: number;
  trackedSeconds: number;
  items: {
    id: string;
    title: string;
    producedAt: string | null;
    platforms: { platform: string; views: number }[];
  }[];
  /** Client-facing: hides internal figures and the links into staff pages. */
  readOnly?: boolean;
}) {
  if (itemCount === 0) {
    return (
      <div className="card p-10 text-center text-sm text-[var(--muted)]">
        No content assigned to this client yet.
      </div>
    );
  }

  const totalPosts = totals.reduce((s, t) => s + t.posts, 0);

  return (
    <>
      <div
        className={`mb-4 grid gap-3 ${readOnly ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3"}`}
      >
        <Stat label="Videos delivered" value={String(itemCount)} />
        <Stat label="Posts published" value={String(totalPosts)} />
        {/* Internal hours never appear in the client-facing view. */}
        {!readOnly && (
          <Stat
            label="Time invested"
            value={trackedSeconds ? formatDurationShort(trackedSeconds) : "—"}
          />
        )}
      </div>

      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Delivered reach by platform</h2>
        <span className="text-xs text-[var(--muted)]">
          Shown per platform — the counts are different units
        </span>
      </div>

      {totals.length === 0 ? (
        <div className="card mb-6 p-8 text-center text-sm text-[var(--muted)]">
          Nothing published yet.
        </div>
      ) : (
        <div className="card mb-6 divide-y divide-[var(--border)] overflow-hidden">
          {totals.map((t) => {
            const eng = engagementRate(t);
            const hpk = hoursPerThousandViews(trackedSeconds, t.views);
            return (
              <div key={t.platform} className="px-3 py-2.5">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{
                      background: PLATFORM_COLORS[t.platform] ?? "var(--muted)",
                    }}
                  />
                  <span className="text-sm font-medium capitalize">
                    {t.platform}
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
                <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--muted)]">
                  <span>
                    Likes <span className="tabular">{t.likes.toLocaleString()}</span>
                  </span>
                  <span>
                    Comments{" "}
                    <span className="tabular">{t.comments.toLocaleString()}</span>
                  </span>
                  {eng != null && (
                    <span>
                      Engagement{" "}
                      <span className="tabular">{(eng * 100).toFixed(2)}%</span>
                    </span>
                  )}
                  {!readOnly && hpk != null && (
                    <span title="Hours of tracked work per 1,000 views on this platform">
                      Hours / 1k views{" "}
                      <span className="tabular">{hpk.toFixed(2)}</span>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!readOnly && (
        <p className="-mt-4 mb-6 text-xs text-[var(--muted)]">
          Hours per 1,000 views divides this client&apos;s total tracked time by
          each platform&apos;s reach. It becomes cost per 1,000 views once cost
          rates exist.
        </p>
      )}
      {readOnly && <div className="mb-6" />}

      <h2 className="mb-2 text-sm font-semibold">Content</h2>
      <div className="card divide-y divide-[var(--border)] overflow-hidden">
        {items.map((item) => {
          const inner = (
            <>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{item.title}</div>
                {item.producedAt && (
                  <div className="text-xs text-[var(--muted)]">{item.producedAt}</div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {item.platforms.length === 0 ? (
                  <span className="text-xs text-[var(--muted)]">not posted</span>
                ) : (
                  item.platforms.map((p) => (
                    <span
                      key={p.platform}
                      className="flex items-center gap-1 rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-xs"
                      title={`${p.platform}: ${p.views.toLocaleString()} views`}
                    >
                      <span
                        className="size-1.5 rounded-full"
                        style={{
                          background: PLATFORM_COLORS[p.platform] ?? "var(--muted)",
                        }}
                      />
                      <span className="tabular">{p.views.toLocaleString()}</span>
                    </span>
                  ))
                )}
              </div>
            </>
          );

          // Clients have no content detail page to open -- that view carries
          // credits and internal notes.
          return readOnly ? (
            <div key={item.id} className="flex items-center gap-3 px-3 py-2">
              {inner}
            </div>
          ) : (
            <Link
              key={item.id}
              href={`/content?video=${item.id}${clientId ? `&client=${clientId}` : ""}`}
              className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-[var(--bg-subtle)]"
            >
              {inner}
            </Link>
          );
        })}
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className="tabular mt-0.5 text-xl font-semibold">{value}</div>
    </div>
  );
}
