"use client";

import Link from "next/link";
import { formatDurationShort } from "@/lib/format";
import { PLATFORM_COLORS } from "@/lib/types";
import { engagementRate, type PlatformTotals } from "@/lib/rollup";

export default function PersonDashboard({
  totals,
  roles,
  trackedSeconds,
  items,
}: {
  totals: PlatformTotals[];
  roles: { name: string; count: number }[];
  trackedSeconds: number;
  items: {
    id: string;
    title: string;
    producedAt: string | null;
    clientName: string | null;
    roles: string[];
    platforms: { platform: string; views: number }[];
  }[];
}) {
  if (items.length === 0) {
    return (
      <div className="card p-10 text-center text-sm text-[var(--muted)]">
        Not credited on any content yet.
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Content credited" value={String(items.length)} />
        <Stat
          label="Time tracked"
          value={trackedSeconds ? formatDurationShort(trackedSeconds) : "—"}
        />
        <Stat
          label="Roles held"
          value={String(roles.length)}
        />
      </div>

      {roles.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-1.5">
          {roles.map((r) => (
            <span
              key={r.name}
              className="rounded bg-[var(--bg-subtle)] px-2 py-0.5 text-xs"
            >
              {r.name}
              <span className="ml-1 text-[var(--muted)]">×{r.count}</span>
            </span>
          ))}
        </div>
      )}

      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Reach on credited content</h2>
        <span className="text-xs text-[var(--muted)]">Per platform, not combined</span>
      </div>

      {totals.length === 0 ? (
        <div className="card mb-6 p-8 text-center text-sm text-[var(--muted)]">
          None of this content has been published yet.
        </div>
      ) : (
        <div className="card mb-2 divide-y divide-[var(--border)] overflow-hidden">
          {totals.map((t) => {
            const eng = engagementRate(t);
            return (
              <div key={t.platform} className="flex flex-wrap items-baseline gap-2 px-3 py-2.5">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: PLATFORM_COLORS[t.platform] ?? "var(--muted)" }}
                />
                <span className="text-sm font-medium capitalize">{t.platform}</span>
                <span className="tabular text-lg font-semibold">
                  {t.views.toLocaleString()}
                </span>
                <span className="text-xs text-[var(--muted)]">views</span>
                <div className="flex-1" />
                {eng != null && (
                  <span className="text-xs text-[var(--muted)]">
                    {(eng * 100).toFixed(2)}% engagement
                  </span>
                )}
                <span className="text-xs text-[var(--muted)]">
                  {t.posts} post{t.posts === 1 ? "" : "s"}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Totals describe the content they worked on, not their personal
          contribution. Attribution needs per-role signals, which are
          owner-only metrics (PRD 4). */}
      <p className="mb-6 text-xs text-[var(--muted)]">
        These are totals for content this person was credited on — shared with
        everyone else credited on it. Separating one person&apos;s contribution
        needs click-through and retention data from a connected account.
      </p>

      <h2 className="mb-2 text-sm font-semibold">Credited content</h2>
      <div className="card divide-y divide-[var(--border)] overflow-hidden">
        {items.map((item) => (
          <Link
            key={item.id}
            href={`/content/${item.id}`}
            className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-[var(--bg-subtle)]"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{item.title}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                {item.clientName && <span>{item.clientName}</span>}
                {item.producedAt && <span>{item.producedAt}</span>}
                {item.roles.length > 0 && <span>{item.roles.join(", ")}</span>}
              </div>
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
                      style={{ background: PLATFORM_COLORS[p.platform] ?? "var(--muted)" }}
                    />
                    <span className="tabular">{p.views.toLocaleString()}</span>
                  </span>
                ))
              )}
            </div>
          </Link>
        ))}
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
