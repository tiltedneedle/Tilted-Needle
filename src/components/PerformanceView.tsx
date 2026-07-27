"use client";

import Link from "next/link";
import { asMultiplier, tierFor, TIER_LABELS, type Tier } from "@/lib/scoring";
import { PLATFORM_COLORS } from "@/lib/types";
import type { BoostRow, PersonRow } from "@/app/(app)/performance/page";

const TIER_CLASS: Record<Tier, string> = {
  top: "text-emerald-500",
  above: "text-emerald-400",
  at: "text-[var(--muted)]",
  below: "text-amber-500",
  insufficient: "text-[var(--muted)] opacity-70",
};

export default function PerformanceView({
  people,
  boosts,
  scoredPostCount,
  totalPostCount,
}: {
  people: PersonRow[];
  boosts: BoostRow[];
  scoredPostCount: number;
  totalPostCount: number;
}) {
  if (totalPostCount === 0) {
    return (
      <div className="card p-10 text-center text-sm text-[var(--muted)]">
        No posts yet. Add content and record metrics, and scores appear here.
      </div>
    );
  }

  if (scoredPostCount === 0) {
    return (
      <div className="card p-8 text-sm">
        <p className="mb-2 font-medium">Not enough history to score yet.</p>
        <p className="text-[var(--muted)]">
          A post is judged against the posts that came before it on the same
          account, so the first few on any account establish the baseline rather
          than receiving a score. Keep recording metrics and scores will start
          appearing — roughly after the third post per account.
        </p>
      </div>
    );
  }

  const byRole = new Map<string, PersonRow[]>();
  for (const p of people) {
    if (!byRole.has(p.roleName)) byRole.set(p.roleName, []);
    byRole.get(p.roleName)!.push(p);
  }

  return (
    <>
      {boosts.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold">
            Boosting — at least 2× the account baseline
          </h2>
          <div className="card divide-y divide-[var(--border)] overflow-hidden">
            {boosts.slice(0, 10).map((b, i) => (
              <Link
                key={`${b.contentId}-${b.platform}-${i}`}
                href={`/content/${b.contentId}`}
                className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-[var(--bg-subtle)]"
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: PLATFORM_COLORS[b.platform] ?? "var(--muted)" }}
                />
                <span className="min-w-0 flex-1 truncate text-sm">{b.title}</span>
                <span className="tabular text-xs text-[var(--muted)]">
                  {b.views.toLocaleString()} views
                </span>
                <span className="tabular text-sm font-medium text-emerald-500">
                  {b.index.toFixed(1)}×
                </span>
              </Link>
            ))}
          </div>
          {/* Public metrics can say a post boosted, not why. CTR and retention
              are owner-only, so attribution needs a connected account (PRD 4). */}
          <p className="mt-1.5 text-xs text-[var(--muted)]">
            Public metrics show <em>that</em> a post boosted. Explaining why needs
            click-through and retention, which require a connected account.
          </p>
        </section>
      )}

      {people.length === 0 ? (
        <div className="card p-8 text-sm text-[var(--muted)]">
          Posts are scored, but nobody is credited on them yet. Assign roles on a
          content item and per-person scores appear here.
        </div>
      ) : (
        [...byRole.entries()].map(([roleName, rows]) => (
          <section key={roleName} className="mb-6">
            {/* Ranking is within a role only -- editors compete with editors. */}
            <h2 className="mb-2 text-sm font-semibold">{roleName}</h2>
            <div className="card divide-y divide-[var(--border)] overflow-hidden">
              {rows.map((p) => {
                const totalN = p.platforms.reduce((s, x) => s + x.n, 0);
                const anyRankable = p.platforms.some((x) => x.rankable);
                const tier = tierFor(p.overall ?? 0, anyRankable);
                return (
                  <div key={`${p.userId}-${p.roleSlug}`} className="px-3 py-2.5">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-sm font-medium">{p.name}</span>
                      <span className={`text-sm ${TIER_CLASS[tier]}`}>
                        {TIER_LABELS[tier]}
                      </span>
                      {anyRankable && p.overall != null && (
                        <span className="tabular text-sm text-[var(--muted)]">
                          {asMultiplier(p.overall).toFixed(2)}× overall
                        </span>
                      )}
                      <div className="flex-1" />
                      {/* Sample size always shown beside the score. */}
                      <span className="text-xs text-[var(--muted)]">
                        {totalN} post{totalN === 1 ? "" : "s"} across{" "}
                        {p.contributing} platform{p.contributing === 1 ? "" : "s"}
                      </span>
                    </div>

                    {/* The breakdown is never optional: an overall must never
                        stand alone as a blended figure (PRD 5 Step 2). */}
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {p.platforms.map((pl) => (
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
                          <span
                            className={`tabular ${pl.rankable ? "" : "opacity-60"}`}
                          >
                            {pl.rankable
                              ? `${asMultiplier(pl.score).toFixed(2)}×`
                              : "n/a"}
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
        ))
      )}

      <p className="mt-4 text-xs text-[var(--muted)]">
        Scores are relative to each account&apos;s own recent median, so channel
        size does not affect them. Small samples are pulled toward the role
        average until enough posts accumulate.
      </p>
    </>
  );
}
