"use client";

import Link from "next/link";
import { formatDurationShort } from "@/lib/format";
import { asMultiplier, tierFor, TIER_LABELS, type Tier } from "@/lib/scoring";
import { PLATFORM_COLORS } from "@/lib/types";
import PlatformReach from "@/components/PlatformReach";
import { PlatformChips } from "@/components/PlatformReach";
import { Stat, StatGrid, SectionHeading, Empty } from "@/components/Stat";
import type { PersonSummary } from "@/lib/dashboards";

const TIER_CLASS: Record<Tier, string> = {
  top: "text-emerald-500",
  above: "text-emerald-400",
  at: "text-[var(--muted)]",
  below: "text-amber-500",
  insufficient: "text-[var(--muted)] opacity-70",
};

export type CreditedItem = {
  id: string;
  title: string;
  clientName: string | null;
  producedAt: string | null;
  roles: string[];
  platforms: { platform: string; views: number }[];
  trackedSeconds: number;
  isPosted: boolean;
};

/**
 * One employee, in full: their standing per content role, the reach of the
 * work they are credited on, their hours, and every video they touched.
 */
export default function PersonDetail({
  person,
  items,
}: {
  person: PersonSummary;
  items: CreditedItem[];
}) {
  const ongoing = items.filter((i) => !i.isPosted);
  const weeklyCapacity = person.capacityHours;

  return (
    <>
      <StatGrid>
        <Stat
          label="Overall"
          value={person.overall != null ? `${asMultiplier(person.overall).toFixed(2)}×` : "—"}
          hint={
            person.overall != null
              ? "average of their per-role scores"
              : "not enough history yet"
          }
          accent={person.overall != null}
        />
        <Stat
          label="Videos credited"
          value={String(person.videoCount)}
          hint={ongoing.length ? `${ongoing.length} still in progress` : "all published"}
        />
        <Stat
          label="Time tracked"
          value={person.trackedSeconds ? formatDurationShort(person.trackedSeconds) : "—"}
          hint="all recorded work"
        />
        <Stat
          label="This week"
          value={
            person.secondsThisWeek
              ? `${(person.secondsThisWeek / 3600).toFixed(1)}h`
              : "—"
          }
          hint={
            Number.isFinite(weeklyCapacity) && weeklyCapacity > 0
              ? `${((person.secondsThisWeek / 3600 / weeklyCapacity) * 100).toFixed(0)}% of ${weeklyCapacity}h capacity`
              : "no capacity set"
          }
          accent={
            Number.isFinite(weeklyCapacity) &&
            weeklyCapacity > 0 &&
            person.secondsThisWeek / 3600 > weeklyCapacity
          }
        />
      </StatGrid>

      <div className="mb-6 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="rounded bg-[var(--bg-subtle)] px-2 py-1 capitalize">
          {person.workspaceRole}
        </span>
        <span className="rounded bg-[var(--bg-subtle)] px-2 py-1 capitalize">
          {person.seat} seat
        </span>
        <span
          className={`rounded px-2 py-1 ${
            person.isActive
              ? "bg-emerald-500/10 text-emerald-500"
              : "bg-[var(--bg-subtle)] text-[var(--muted)]"
          }`}
        >
          {person.isActive ? "Active" : "Deactivated"}
        </span>
        {person.groups.map((g) => (
          <span key={g} className="rounded bg-[var(--bg-subtle)] px-2 py-1">
            {g}
          </span>
        ))}
      </div>

      {/* Per-role standing. Someone can be a strong editor and an average
          videographer; a single blended number would hide that entirely. */}
      {person.byRole.length > 0 && (
        <section className="mb-7">
          <SectionHeading
            title="Standing by role"
            note="Each role scored separately, on each platform's own baseline"
          />
          <div className="card divide-y divide-[var(--border)] overflow-hidden">
            {person.byRole.map((r) => {
              const anyRankable = r.platforms.some((p) => p.rankable);
              const tier = tierFor(r.overall ?? 0, anyRankable);
              return (
                <div key={r.roleSlug} className="px-3 py-2.5">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-medium">{r.roleName}</span>
                    <span className={`text-sm ${TIER_CLASS[tier]}`}>
                      {TIER_LABELS[tier]}
                    </span>
                    {anyRankable && r.overall != null && (
                      <span className="tabular text-sm text-[var(--muted)]">
                        {asMultiplier(r.overall).toFixed(2)}× overall
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {r.platforms.map((pl) => (
                      <span
                        key={pl.platform}
                        className="flex items-center gap-1.5 rounded bg-[var(--bg-subtle)] px-2 py-0.5 text-xs"
                        title={
                          pl.rankable
                            ? `${pl.platform}: ${asMultiplier(pl.score).toFixed(2)}× from ${pl.n} posts`
                            : `${pl.platform}: only ${pl.n} post${pl.n === 1 ? "" : "s"} — not enough to rank`
                        }
                      >
                        <span
                          className="size-1.5 rounded-full"
                          style={{
                            background: PLATFORM_COLORS[pl.platform] ?? "var(--muted)",
                          }}
                        />
                        <span className="capitalize">{pl.platform}</span>
                        <span className={`tabular ${pl.rankable ? "" : "opacity-60"}`}>
                          {pl.rankable ? `${asMultiplier(pl.score).toFixed(2)}×` : "n/a"}
                        </span>
                        <span className="text-[var(--muted)]">n={pl.n}</span>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="mb-7">
        <SectionHeading title="Reach on credited content" note="Per platform, not combined" />
        <PlatformReach
          totals={person.totals}
          emptyText="None of their credited content has been published yet."
        />
        <p className="mt-1.5 text-xs text-[var(--muted)]">
          These totals belong to the content, shared with everyone else credited
          on it. Isolating one person&apos;s contribution needs click-through and
          retention data from a connected account.
        </p>
      </section>

      {ongoing.length > 0 && (
        <section className="mb-7">
          <SectionHeading title={`In progress (${ongoing.length})`} note="Credited but not posted anywhere yet" />
          <div className="card divide-y divide-[var(--border)] overflow-hidden">
            {ongoing.map((i) => (
              <Link
                key={i.id}
                href={`/content?video=${i.id}`}
                className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-[var(--bg-subtle)]"
              >
                <span className="size-1.5 shrink-0 rounded-full bg-amber-500" />
                <span className="min-w-0 flex-1 truncate text-sm">{i.title}</span>
                <span className="shrink-0 text-xs text-[var(--muted)]">
                  {i.roles.join(", ")}
                </span>
                {i.trackedSeconds > 0 && (
                  <span className="tabular shrink-0 text-xs text-[var(--muted)]">
                    {formatDurationShort(i.trackedSeconds)}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionHeading title={`Credited content (${items.length})`}>
          {/* The same set, on the Content dashboard, where it can be sliced
              by platform and period. */}
          <Link
            href={`/content?person=${person.userId}`}
            className="rounded px-2 py-0.5 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--fg)]"
          >
            Open in Content →
          </Link>
        </SectionHeading>
        {items.length === 0 ? (
          <Empty>Not credited on any content yet.</Empty>
        ) : (
          <div className="card divide-y divide-[var(--border)] overflow-hidden">
            {items.map((i) => (
              <Link
                key={i.id}
                href={`/content?video=${i.id}`}
                className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--bg-subtle)]"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{i.title}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-[var(--muted)]">
                    {i.clientName && <span>{i.clientName}</span>}
                    {i.producedAt && <span>{i.producedAt}</span>}
                    {i.roles.length > 0 && <span>{i.roles.join(", ")}</span>}
                    {i.trackedSeconds > 0 && (
                      <span className="tabular">
                        {formatDurationShort(i.trackedSeconds)} tracked
                      </span>
                    )}
                  </div>
                </div>
                <div className="shrink-0">
                  <PlatformChips platforms={i.platforms} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
