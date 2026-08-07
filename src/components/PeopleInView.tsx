import Link from "next/link";
import Avatar from "@/components/Avatar";
import { PlatformChips } from "@/components/PlatformReach";
import { SectionHeading } from "@/components/Stat";
import { formatDurationShort } from "@/lib/format";

import type { PersonStats } from "@/lib/reports";

/**
 * PRD v0.5 §3: the person-shaped mirror of the client summary. Every
 * number here describes the CURRENT INTERSECTION -- filter to EuroEyes
 * and Usama's card is Usama-on-EuroEyes, not Usama globally; that is the
 * entire point of the merge. Plain multipliers only: the tier vocabulary
 * is removed by request, the number is the information.
 */
export default function PeopleInView({ people }: { people: PersonStats[] }) {
  if (people.length === 0) return null;

  return (
    <section className="mb-7">
      <SectionHeading
        title="People in view"
        note="Numbers describe the current filters — their work inside this view only"
      />
      <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {people.map((p) => (
          <div key={p.userId} className="card animate-rise p-4">
            <div className="flex items-center gap-2.5">
              <Avatar name={p.name} seed={p.userId} size={28} />
              <Link
                href={`/content?person=${p.userId}`}
                className="min-w-0 flex-1 truncate text-sm font-semibold transition-colors hover:text-[var(--accent)]"
                title="Just this person, across everything"
              >
                {p.name}
              </Link>
              {p.avgBoost != null && (
                <span
                  className="tabular shrink-0 text-sm font-semibold"
                  title="Average boost across their scored posts in this view"
                >
                  {p.avgBoost.toFixed(2)}×
                </span>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
              <span>
                <span className="tabular text-lg font-semibold">{p.videosInView}</span>{" "}
                <span className="text-xs text-[var(--muted)]">
                  video{p.videosInView === 1 ? "" : "s"}
                </span>
              </span>
              {p.seconds > 0 && (
                <span>
                  <span className="tabular font-medium">{formatDurationShort(p.seconds)}</span>{" "}
                  <span className="text-xs text-[var(--muted)]">tracked</span>
                </span>
              )}
            </div>

            {p.roles.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {p.roles.map((r) => (
                  <span key={r} className="pill pill-neutral">
                    {r}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-2.5">
              <PlatformChips platforms={p.platforms} emptyText="nothing published in view" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
