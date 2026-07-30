"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, Heart, MessageCircle, Plus } from "lucide-react";
import Avatar from "@/components/Avatar";
import { assignRole, unassignRole } from "@/app/actions";
import { formatCount, formatDurationShort } from "@/lib/format";
import { PLATFORM_COLORS } from "@/lib/types";
import { totalsByPlatform, type PlatformTotals } from "@/lib/rollup";

export type TileRole = { id: string; slug: string; name: string };
export type TileMember = { userId: string; name: string };

/** One person credited in one role on one video. */
export type TileCredit = {
  assignmentId: string;
  roleSlug: string;
  userId: string;
  userName: string;
};

export type TilePlatform = {
  platform: string;
  views: number;
  likes: number;
  comments: number;
};

/**
 * Shorter labels than the role names, because five of them sit under five
 * 26px circles. Keyed by slug so a renamed role keeps its short form, and
 * falls back to the role's own name for anything a workspace has added.
 */
const SHORT_ROLE: Record<string, string> = {
  idea: "Idea",
  script: "Script",
  videographer: "Camera",
  editor: "Editor",
  qc: "QC",
};

/* ---- Metrics ------------------------------------------------------------- */

function Metric({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Eye;
  value: number;
  label: string;
}) {
  return (
    <span
      className="tabular flex items-center gap-1 text-[var(--muted)]"
      title={`${value.toLocaleString()} ${label}`}
    >
      <Icon size={12} strokeWidth={1.9} className="opacity-70" />
      <span className="text-[var(--fg)]">{formatCount(value)}</span>
    </span>
  );
}

/**
 * Views, likes and comments -- one line per platform, never pooled.
 *
 * Rows arriving here are one-per-post, so a video cross-posted twice to the
 * same account contributes two of them; they are summed *within* a platform
 * (same unit, legitimately additive) and never across (PRD 5 Step 2).
 */
export function PlatformMetrics({
  platforms,
  emptyText = "not posted",
}: {
  platforms: TilePlatform[];
  emptyText?: string;
}) {
  const totals: PlatformTotals[] = totalsByPlatform(platforms);

  if (totals.length === 0) {
    return <span className="text-xs text-[var(--muted)]">{emptyText}</span>;
  }

  // One line per platform, stacked when a video is cross-posted. Stacking
  // rather than wrapping side by side keeps each platform's three figures
  // together, so no one reads a like count against the wrong platform.
  return (
    <div className="flex flex-col items-end gap-1">
      {totals.map((t) => (
        <span key={t.platform} className="flex items-center gap-2 text-xs">
          <span className="flex items-center gap-1">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: PLATFORM_COLORS[t.platform] ?? "var(--muted)" }}
            />
            <span className="capitalize text-[var(--muted)]">{t.platform}</span>
          </span>
          <Metric icon={Eye} value={t.views} label={`views on ${t.platform}`} />
          <Metric icon={Heart} value={t.likes} label={`likes on ${t.platform}`} />
          <Metric icon={MessageCircle} value={t.comments} label={`comments on ${t.platform}`} />
        </span>
      ))}
    </div>
  );
}

/* ---- Credits ------------------------------------------------------------- */

/**
 * The five production roles as five circles, assignable in place.
 *
 * Every role gets a slot whether or not anyone holds it: an empty dashed
 * circle is the prompt that gets it filled, and the roles having 0% fill rate
 * in the old spreadsheet (PRD 3.5) is exactly the problem this is here to fix.
 *
 * Read-only for members without manage rights -- the circles still render, so
 * everyone can see who did what.
 */
export function RoleCredits({
  workspaceId,
  contentItemId,
  roles,
  credits,
  members,
  canManage = true,
}: {
  workspaceId: string;
  contentItemId: string;
  roles: TileRole[];
  credits: TileCredit[];
  members: TileMember[];
  canManage?: boolean;
}) {
  const [openRole, setOpenRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);

  // Click-outside and Escape both close the menu. Without this the popover
  // survives navigation-by-click and hangs over the next row.
  useEffect(() => {
    if (!openRole) return;
    function onDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpenRole(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenRole(null);
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openRole]);

  function run(fn: () => Promise<{ error?: string }>) {
    startTransition(async () => {
      const res = await fn();
      if (res?.error) setError(res.error);
      else setError(null);
      setOpenRole(null);
      router.refresh();
    });
  }

  return (
    <div ref={wrapRef} className="relative flex items-start gap-0.5">
      {roles.map((role) => {
        const holders = credits.filter((c) => c.roleSlug === role.slug);
        const label = SHORT_ROLE[role.slug] ?? role.name;
        const isOpen = openRole === role.slug;
        const lead = holders[0];

        return (
          <div key={role.id} className="relative">
            <button
              type="button"
              disabled={!canManage || pending}
              onClick={() => setOpenRole(isOpen ? null : role.slug)}
              className={`flex w-[38px] flex-col items-center gap-0.5 rounded-[8px] px-0.5 py-0.5 transition-colors ${
                canManage ? "hover:bg-[var(--bg-subtle)]" : "cursor-default"
              } ${isOpen ? "bg-[var(--bg-subtle)]" : ""}`}
              title={
                holders.length
                  ? `${role.name}: ${holders.map((h) => h.userName).join(", ")}`
                  : `${role.name}: unassigned`
              }
              aria-label={
                holders.length
                  ? `${role.name}: ${holders.map((h) => h.userName).join(", ")}`
                  : `${role.name}: unassigned`
              }
            >
              <span className="relative">
                {lead ? (
                  <Avatar name={lead.userName} seed={lead.userId} size={24} title="" />
                ) : (
                  <span
                    className={`flex size-[24px] items-center justify-center rounded-full border border-dashed border-[var(--border-strong)] text-[var(--muted)] ${
                      canManage ? "" : "opacity-60"
                    }`}
                  >
                    <Plus size={11} strokeWidth={2} />
                  </span>
                )}
                {/* More than one person can hold a role on the same video. */}
                {holders.length > 1 && (
                  <span className="absolute -bottom-0.5 -right-1 rounded-full bg-[var(--panel)] px-1 text-[9px] font-semibold text-[var(--muted)] shadow-[0_0_0_1px_var(--border)]">
                    +{holders.length - 1}
                  </span>
                )}
              </span>
              <span
                className={`w-full truncate text-center text-[9px] leading-tight ${
                  lead ? "text-[var(--muted)]" : "text-[var(--muted)] opacity-70"
                }`}
              >
                {label}
              </span>
            </button>

            {/* Anchored right: the credit row sits at the tile's right edge,
                so a left-anchored menu would hang off the page. */}
            {isOpen && canManage && (
              <div className="absolute right-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--bg-elevated)] shadow-[var(--shadow-card-hover)]">
                <div className="border-b border-[var(--border)] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  {role.name}
                </div>

                {holders.length > 0 && (
                  <div className="border-b border-[var(--border)] py-1">
                    {holders.map((h) => (
                      <div
                        key={h.assignmentId}
                        className="flex items-center gap-2 px-2.5 py-1"
                      >
                        <Avatar name={h.userName} seed={h.userId} size={20} />
                        <span className="min-w-0 flex-1 truncate text-xs">
                          {h.userName}
                        </span>
                        <button
                          type="button"
                          className="rounded px-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--danger)]"
                          onClick={() => run(() => unassignRole(h.assignmentId))}
                          title={`Remove ${h.userName} from ${role.name}`}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="max-h-52 overflow-y-auto py-1">
                  {members
                    .filter((m) => !holders.some((h) => h.userId === m.userId))
                    .map((m) => (
                      <button
                        key={m.userId}
                        type="button"
                        className="flex w-full items-center gap-2 px-2.5 py-1 text-left transition-colors hover:bg-[var(--bg-subtle)]"
                        onClick={() =>
                          run(() =>
                            assignRole({
                              workspaceId,
                              contentItemId,
                              userId: m.userId,
                              roleId: role.id,
                            }),
                          )
                        }
                      >
                        <Avatar name={m.name} seed={m.userId} size={20} />
                        <span className="min-w-0 flex-1 truncate text-xs">{m.name}</span>
                      </button>
                    ))}
                  {members.every((m) => holders.some((h) => h.userId === m.userId)) && (
                    <div className="px-2.5 py-1.5 text-xs text-[var(--muted)]">
                      Everyone is already credited here.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {error && (
        <span className="self-center text-xs text-[var(--danger)]" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/* ---- The tile ------------------------------------------------------------ */

export type TileVideo = {
  id: string;
  title: string;
  clientName?: string | null;
  producedAt?: string | null;
  lengthSeconds?: number | null;
  trackedSeconds?: number;
  platforms: TilePlatform[];
  postCount?: number;
  bestIndex?: number | null;
  recentGain?: { views: number; days: number } | null;
  credits: TileCredit[];
  /** Roles this person holds, when the tile is shown on someone's own page. */
  ownRoles?: string[];
};

/**
 * One video, everywhere a video is listed.
 *
 * Deliberately one component rather than a variant per page: the Content
 * dashboard, a client's delivered list and a person's credited list were all
 * showing the same video with different amounts of the truth on it. Sharing
 * the tile is what keeps "one place each figure lives" (PRD 1.1) true as
 * these lists drift apart.
 *
 * The row is a div, not a link: the credit circles are buttons, and a button
 * inside an anchor is invalid markup that swallows its own clicks. The title
 * carries the navigation instead.
 */
export default function VideoTile({
  video,
  href,
  workspaceId,
  roles,
  members,
  canManage = true,
}: {
  video: TileVideo;
  href: string;
  workspaceId: string;
  roles: TileRole[];
  members: TileMember[];
  canManage?: boolean;
}) {
  const v = video;
  const notPosted = (v.postCount ?? v.platforms.length) === 0;

  return (
    // One row: title on the left, numbers and credits on the right. It wraps
    // to two lines only when the viewport genuinely cannot hold both, rather
    // than stacking by default -- a list is read down the titles, and pushing
    // every tile to four lines made 229 videos far longer to scan.
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 transition-colors hover:bg-[var(--bg-subtle)]">
      <div className="min-w-[220px] flex-1">
        <Link
          href={href}
          className="block truncate text-sm font-medium transition-colors hover:text-[var(--accent)]"
        >
          {v.title}
        </Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--muted)]">
          {v.clientName && <span className="truncate">{v.clientName}</span>}
          {v.producedAt && <span>{v.producedAt}</span>}
          {v.lengthSeconds != null && (
            <span className="tabular">
              {Math.floor(v.lengthSeconds / 60)}:
              {String(v.lengthSeconds % 60).padStart(2, "0")}
            </span>
          )}
          {!!v.trackedSeconds && v.trackedSeconds > 0 && (
            <span className="tabular">{formatDurationShort(v.trackedSeconds)} tracked</span>
          )}
          {v.ownRoles && v.ownRoles.length > 0 && (
            <span className="text-[var(--fg)]">{v.ownRoles.join(", ")}</span>
          )}
          {notPosted && (
            <span className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5">not posted</span>
          )}
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-3">
        <PlatformMetrics platforms={v.platforms} />

        {/* Still gaining views -- the signal a lifetime total cannot show. */}
        {v.recentGain != null && v.recentGain.views > 0 && (
          <span
            className="tabular text-xs text-emerald-500"
            title={`Views gained over the ${v.recentGain.days.toFixed(0)} day(s) between the last two snapshots`}
          >
            +{v.recentGain.views.toLocaleString()}
            <span className="ml-0.5 opacity-70">/{v.recentGain.days.toFixed(0)}d</span>
          </span>
        )}

        {/* A boost badge only appears once the account has enough history to
            have a baseline worth beating. */}
        {v.bestIndex != null && v.bestIndex >= 2 && (
          <span className="tabular rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs font-medium text-emerald-500">
            {v.bestIndex.toFixed(1)}×
          </span>
        )}

        <div className="border-l border-[var(--border)] pl-3">
          <RoleCredits
            workspaceId={workspaceId}
            contentItemId={v.id}
            roles={roles}
            credits={v.credits}
            members={members}
            canManage={canManage}
          />
        </div>
      </div>
    </div>
  );
}
