import Link from "next/link";
import Avatar from "@/components/Avatar";
import { SectionHeading } from "@/components/Stat";
import { formatCount, formatDurationShort } from "@/lib/format";
import { PLATFORM_COLORS, PLATFORM_LABEL } from "@/lib/types";

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

            {/* Their actual reach, per platform, in each platform's own
                units. This replaced a single boost multiplier: one abstract
                number that never said whether the work reached anyone, and
                that read as a verdict on the person whenever it fell below
                1.00. Rows rather than chips because likes and comments
                belong beside the views they came from -- and still never
                added across platforms, where a view is not the same thing. */}
            {p.platforms.length === 0 ? (
              <p className="mt-3 text-xs text-[var(--muted)]">
                Nothing published in this view yet.
              </p>
            ) : (
              <div className="mt-3 space-y-1.5 border-t border-[var(--border)] pt-2.5">
                {p.platforms.map((pl) => (
                  <div key={pl.platform} className="flex items-baseline gap-2 text-xs">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: PLATFORM_COLORS[pl.platform] ?? "var(--muted)" }}
                    />
                    {/* PLATFORM_LABEL, not the raw slug with `capitalize`.
                        CSS capitalisation cannot know that youtube_shorts is
                        two words, so this rendered "Youtube_shorts" -- and
                        got "Youtube" and "Tiktok" wrong in the same breath,
                        since neither capitalises at the letter CSS does.

                        w-24 with truncate, not w-16 with shrink-0. The label
                        is fixed-width so the figures beside it line up in a
                        column, but a fixed width that cannot shrink and
                        cannot clip does not contain anything: "Youtube_shorts"
                        simply drew straight over the number to its right, so
                        the row read "Youtube_shor117k". Truncate is what makes
                        the width a real boundary; w-24 is wide enough that
                        the longest real label, "YouTube Shorts", does not
                        need it. */}
                    <span
                      className="w-24 shrink-0 truncate text-[var(--muted)]"
                      title={PLATFORM_LABEL[pl.platform] ?? pl.platform}
                    >
                      {PLATFORM_LABEL[pl.platform] ?? pl.platform}
                    </span>
                    <span className="tabular font-semibold">
                      {formatCount(pl.views)}
                    </span>
                    <span className="text-[var(--muted)]">views</span>
                    <span className="flex-1" />
                    <span className="tabular text-[var(--muted)]">
                      {formatCount(pl.likes)} likes
                    </span>
                    <span className="tabular text-[var(--muted)]">
                      {formatCount(pl.comments)} comments
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
