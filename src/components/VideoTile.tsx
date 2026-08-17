"use client";

import Link from "next/link";
import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, Heart, MessageCircle, Plus } from "lucide-react";
import Avatar from "@/components/Avatar";
import PlatformIcon from "@/components/PlatformIcon";
import Popover from "@/components/ui/Popover";
import { assignRole, bulkAssignRole, unassignRole } from "@/app/actions";
import { useToast } from "@/components/ui/Toast";
import { formatCount, formatDurationShort, formatRate, gainPerDay } from "@/lib/format";
import { videoLabel } from "@/lib/contentLabels";
import { PLATFORM_COLORS } from "@/lib/types";
import { totalsByPlatform, type PlatformTotals } from "@/lib/rollup";
import { SHAPE_LABEL, SHAPE_HINT, type LifecycleShape } from "@/lib/lifecycle";

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
  // No rows here means no platform post exists, which is a statement about
  // our records and not about whether the video went out. See VideoTile's
  // badge below.
  emptyText = "no link",
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
  applyToIds,
}: {
  workspaceId: string;
  contentItemId: string;
  roles: TileRole[];
  credits: TileCredit[];
  members: TileMember[];
  canManage?: boolean;
  /**
   * Every video this menu should credit, not just the row it hangs off.
   *
   * Set while a multi-selection is active and THIS row is part of it, so the
   * control people already use -- hover the stack, pick a role, pick a person
   * -- credits the whole selection in one go. The bulk bar could always do
   * this, but it meant learning a second control that asks for the role and
   * the person as two dropdowns; the row menu already knows the role from
   * which circle you opened.
   */
  applyToIds?: string[];
}) {
  const [openRole, setOpenRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  // Points at whichever role's cell currently owns the open menu. Only one
  // can be open, so a single ref attached conditionally is enough -- and the
  // menu must be positioned from THAT cell, not from the whole stack, or it
  // would open under the first role no matter which one was clicked.
  const anchorRef = useRef<HTMLDivElement>(null);

  // Outside-click and Escape moved into Popover. They cannot live here any
  // more: the menu is portalled to <body>, so wrapRef.contains() reports a
  // click on a menu item as OUTSIDE and would close before the click landed.
  const closeMenu = useCallback(() => setOpenRole(null), []);

  function run(fn: () => Promise<{ error?: string }>, success?: string) {
    startTransition(async () => {
      const res = await fn();
      if (res?.error) setError(res.error);
      else {
        setError(null);
        // Only announced for the bulk path. A single credit is confirmed by
        // the avatar appearing in the stack you are already looking at; a
        // toast for that is noise. Twelve rows changing at once is not
        // self-evident and has to say so.
        if (success) toast("success", success);
      }
      setOpenRole(null);
      router.refresh();
    });
  }

  // More than one, because a "selection" of exactly this row is just the
  // ordinary single-video case wearing a checkbox.
  const bulkIds = applyToIds && applyToIds.length > 1 ? applyToIds : null;

  // Collapsed by default into an avatar stack (each circle overlapping the
  // previous by ~70%) so a dense list stays scannable; hovering, tabbing
  // into, or opening any role's menu fans the stack out with the labels --
  // then every circle works exactly as before. Reduced-motion users get the
  // same states without the animation via the global media rule.
  const expanded = openRole !== null;
  return (
    <div
      ref={wrapRef}
      className="group/stack relative flex items-start"
    >
      {roles.map((role, roleIndex) => {
        const holders = credits.filter((c) => c.roleSlug === role.slug);
        const label = SHORT_ROLE[role.slug] ?? role.name;
        const isOpen = openRole === role.slug;
        const lead = holders[0];

        return (
          <div
            key={role.id}
            ref={isOpen ? anchorRef : undefined}
            className={`relative transition-[margin] duration-200 ${
              expanded ? "ml-0" : "-ml-[17px] first:ml-0"
            } group-focus-within/stack:ml-0 group-hover/stack:ml-0`}
            style={{ zIndex: isOpen ? 30 : roles.length - roleIndex }}
          >
            <button
              type="button"
              disabled={!canManage || pending}
              onClick={() => setOpenRole(isOpen ? null : role.slug)}
              className={`flex w-[30px] flex-col items-center gap-0.5 rounded-[8px] px-0.5 py-0.5 transition-[width,background-color] duration-200 group-focus-within/stack:w-[38px] group-hover/stack:w-[38px] ${
                expanded ? "w-[38px]" : ""
              } ${canManage ? "hover:bg-[var(--bg-subtle)]" : "cursor-default"} ${
                isOpen ? "bg-[var(--bg-subtle)]" : ""
              }`}
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
                  // The ring separates overlapped circles in the collapsed
                  // stack -- without it adjacent avatars blur together.
                  <span className="block rounded-full shadow-[0_0_0_2px_var(--panel)]">
                    <Avatar name={lead.userName} seed={lead.userId} size={24} title="" />
                  </span>
                ) : (
                  <span
                    className={`flex size-[24px] items-center justify-center rounded-full border border-dashed border-[var(--border-strong)] bg-[var(--panel)] text-[var(--muted)] shadow-[0_0_0_2px_var(--panel)] ${
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
              {/* Labels exist only in the fanned-out state; collapsed, the
                  stack is identification-by-avatar with tooltips. */}
              <span
                className={`w-full truncate text-center text-[9px] leading-tight transition-[max-height,opacity] duration-200 group-focus-within/stack:max-h-4 group-focus-within/stack:opacity-100 group-hover/stack:max-h-4 group-hover/stack:opacity-100 ${
                  expanded ? "max-h-4 opacity-100" : "max-h-0 overflow-hidden opacity-0"
                } text-[var(--muted)]`}
              >
                {label}
              </span>
            </button>

            {/* Anchored right: the credit row sits at the tile's right edge,
                so a left-anchored menu would hang off the page.

                This is the menu that was CLIPPED rather than merely painted
                under. The list it lives in is a `card ... overflow-hidden`,
                which is what rounds the divided card's corners -- so on the
                last row the menu was cut off with no z-index that could help.
                Portalled, it is not inside that card any more. */}
            {isOpen && canManage && (
              <Popover
                anchorRef={anchorRef}
                onClose={closeMenu}
                align="right"
                role="menu"
                ariaLabel={`${role.name} credits`}
                width={208}
                maxHeight={340}
                className="!py-0"
              >
                {/* The header carries the blast radius. Picking a name here
                    while a selection is live changes every selected video,
                    and a menu that silently does twelve things when it looks
                    like it does one is the kind of control people stop
                    trusting after the first surprise. */}
                <div className="border-b border-[var(--border)] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  {role.name}
                  {bulkIds && (
                    <span className="ml-1 font-medium normal-case tracking-normal text-[var(--accent)]">
                      · all {bulkIds.length} selected
                    </span>
                  )}
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
                          // Removal stays single-video even during a
                          // selection: an assignment id belongs to one video,
                          // and the holders listed here are this row's. Taking
                          // a credit away from twelve videos on one click is a
                          // much worse mistake to make by accident than adding
                          // one, which is idempotent and visible.
                          title={
                            bulkIds
                              ? `Remove ${h.userName} from ${role.name} on this video only`
                              : `Remove ${h.userName} from ${role.name}`
                          }
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
                          run(
                            () =>
                              bulkIds
                                ? bulkAssignRole({
                                    workspaceId,
                                    contentItemIds: bulkIds,
                                    userId: m.userId,
                                    roleId: role.id,
                                  })
                                : assignRole({
                                    workspaceId,
                                    contentItemId,
                                    userId: m.userId,
                                    roleId: role.id,
                                  }),
                            bulkIds
                              ? `${m.name} credited as ${role.name} on ${bulkIds.length} videos.`
                              : undefined,
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
              </Popover>
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

/**
 * The poster frame, and the neutral box it falls back to.
 *
 * The box is always rendered, image or not. That is the point: a video with no
 * thumbnail has to look like a normal member of the list, not like something
 * that failed to load, and a ragged left edge where some rows have an image
 * and others start at the title would be worse than no images at all.
 *
 * 16:9 for every platform, including the vertical ones. A portrait frame at
 * this height would be ~15px wide and identify nothing, and mixing aspect
 * ratios down a list destroys the alignment the gutter exists to create. The
 * image is cropped to fill, which for a vertical video shows its middle band --
 * enough to recognise a clip you made, which is all this is for.
 *
 * The empty box carries the platform's mark. An unmarked grey rectangle is
 * indistinguishable from a broken image, and right now that distinction matters
 * a lot: every Instagram post has no poster frame, because Instagram is the one
 * provider whose thumbnails arrive only on a metered call -- YouTube derives
 * them from the video id and TikTok has a keyless oEmbed, so both are already
 * complete. Without the mark, a third of the list reads as failure rather than
 * as "Instagram, poster pending".
 */
function Thumb({
  src,
  title,
  href,
  platform,
}: {
  src: string | null;
  title: string;
  href: string;
  /** Drives the fallback mark. Null only if a video has no posts at all. */
  platform: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const show = src && !failed;
  return (
    <Link
      href={href}
      // Visible on phones too. It used to be `hidden sm:block`, dropped during
      // the 360px overflow work when the metrics cluster measured 433px inside
      // a 301px card -- but the thumbnail was never the cause of that, and
      // removing it cost the one cue that tells two similarly-titled videos
      // apart at a glance. It is exactly where the fix is least needed and
      // most missed: a phone row shows fewer columns, so the poster frame
      // carries proportionally MORE of the identification.
      //
      // Slightly smaller below sm so it takes 44px of a 360px row rather than
      // 52, and the row still wraps rather than overflowing.
      className="h-[26px] w-[44px] shrink-0 overflow-hidden rounded-[6px] bg-[var(--bg-subtle)] sm:h-[30px] sm:w-[52px]"
      tabIndex={-1}
      aria-hidden="true"
      title={title}
    >
      {show && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          width={52}
          height={30}
          loading="lazy"
          decoding="async"
          // Some CDNs 403 a request that names a referring origin.
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          // A dead or expired URL becomes the empty box rather than the
          // browser's broken-image glyph. Instagram's links are signed and
          // WILL expire, so this is the expected path, not an edge case.
          onError={() => setFailed(true)}
        />
      )}
      {!show && platform && (
        // Muted, not full brand strength: this is a stand-in for artwork, and
        // a saturated logo would pull more attention than the real poster
        // frames it sits beside.
        <span className="grid size-full place-items-center opacity-40">
          <PlatformIcon platform={platform} size={14} />
        </span>
      )}
    </Link>
  );
}

export type TileVideo = {
  id: string;
  title: string;
  clientName?: string | null;
  producedAt?: string | null;
  lengthSeconds?: number | null;
  trackedSeconds?: number;
  platforms: TilePlatform[];
  /** Poster frame, when a platform reported one. Optional and often absent. */
  thumbnailUrl?: string | null;
  /** Platform id of the first post, used only to label caption-less videos. */
  postCode?: string | null;
  postCount?: number;
  bestIndex?: number | null;
  /**
   * views: gained between the last two readings.
   * days: how far apart those two readings were -- NOT a fixed window.
   * staleDays: how long ago the LATEST reading was taken, so a figure
   *   describing a fortnight ago can say so instead of passing as "now".
   */
  recentGain?: { views: number; days: number; staleDays?: number | null } | null;
  credits: TileCredit[];
  /** Roles this person holds, when the tile is shown on someone's own page. */
  ownRoles?: string[];
  /** Liveliest lifecycle shape across this video's platforms (lib/lifecycle). */
  lifecycleShape?: LifecycleShape;
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
  selectable = false,
  selected = false,
  onToggleSelect,
  bulkTargets,
}: {
  video: TileVideo;
  href: string;
  workspaceId: string;
  roles: TileRole[];
  members: TileMember[];
  canManage?: boolean;
  /** Selection mode is on. All three are optional so existing call sites
      are untouched -- the tile renders exactly as before without them. */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  /**
   * The whole current selection, passed only when this row is IN it.
   *
   * That condition is the safety rail. Opening the role menu on a row you
   * have not ticked behaves exactly as it always has and touches that video
   * alone, so a live selection elsewhere on the page cannot turn an ordinary
   * one-video edit into a bulk one.
   */
  bulkTargets?: string[];
}) {
  const v = video;
  const notPosted = (v.postCount ?? v.platforms.length) === 0;

  // Resolved once and used for the link, the checkbox's accessible name and
  // the thumbnail's tooltip, so a caption-less video is described the same way
  // everywhere rather than reading "Untitled" to a screen reader and something
  // else on screen.
  const label = videoLabel(v);

  return (
    // One row: title on the left, numbers and credits on the right. It wraps
    // to two lines only when the viewport genuinely cannot hold both, rather
    // than stacking by default -- a list is read down the titles, and pushing
    // every tile to four lines made 229 videos far longer to scan.
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 transition-colors hover:bg-[var(--bg-subtle)]">
      {/* Sized to the two-line title block already here, so no row grows
          taller -- the whole reason this list is one line per video is that
          229 of them have to stay scannable.

          A plain <img>, not next/image: next/image refuses any host not
          allow-listed in next.config.ts, and these are platform CDNs whose
          hostnames change without notice. ClientImage.tsx made the same call
          for the same reason.

          The box renders whether or not there is a URL, so a missing or
          expired thumbnail looks deliberate rather than broken -- and onError
          clears the src so a dead link degrades to that same box instead of
          a browser's broken-image glyph. */}
      {/* Only rendered in selection mode, so the row keeps its normal shape
          the rest of the time -- a permanently visible checkbox column would
          tax every reading of the list to serve an occasional action. */}
      {selectable && (
        <input
          type="checkbox"
          className="size-4 shrink-0 accent-[var(--accent)]"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={`Select ${label.text}`}
        />
      )}

      {/* The first platform, which for a merged video is the one it was
          originally posted to -- close enough for a stand-in mark, and no
          reason to pick a winner between two when neither has artwork. */}
      <Thumb
        src={v.thumbnailUrl ?? null}
        title={label.text}
        href={href}
        platform={v.platforms[0]?.platform ?? null}
      />

      {/* The 220px floor is what keeps a title readable next to the numbers on
          a real screen, but on a 360px phone it is 60% of the row and forces
          the rest out. Only applied once there is room for it. */}
      <div className="min-w-0 flex-1 sm:min-w-[220px]">
        {/* Muted and italic when it is a stand-in, so the eye reads it as a
            gap to fill rather than as the video's actual name. Forty rows all
            saying "Untitled" looked like data; this looks like a to-do. */}
        <Link
          href={href}
          className={`block truncate text-sm transition-colors hover:text-[var(--accent)] ${
            label.isPlaceholder ? "font-normal italic text-[var(--muted)]" : "font-medium"
          }`}
          title={label.isPlaceholder ? "This post had no caption — open it to add a title" : undefined}
        >
          {label.text}
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
          {/* "not posted" claimed to know something the system does not. All
              it can see is that no link was recorded -- and the videos wearing
              this badge had mostly been posted months before, they just came
              in from a spreadsheet without URLs. */}
          {notPosted && (
            <span
              className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5"
              title="No link recorded. Open the video to add one."
            >
              no link
            </span>
          )}
        </div>
      </div>

      {/* shrink-0 only from sm up. On a phone this cluster measured 433px
          inside a 301px card: the row already wraps, but wrapping an
          unshrinkable block just moves 433px onto its own line, and the card's
          overflow-hidden then CLIPS it -- the credit buttons were not merely
          off-screen, they were unreachable. Allowed to wrap internally
          instead, so the metrics and role pills flow onto extra lines and
          everything stays inside the card. */}
      <div className="ml-auto flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 sm:flex-nowrap sm:shrink-0">
        <PlatformMetrics platforms={v.platforms} />

        {/* Where this sits in its life. Only the shapes that are genuinely
            worth a glance get ink: "long tail" is where most posts end up and
            printing a badge for it on 73 of 202 rows would be noise, not
            information. Absence here means ordinary, never broken.

            "Launching" was dropped from this list. It fired on anything under
            14 days old with a reading taken from publication, which is a
            statement about the video's AGE rather than about how it is doing
            -- and the date is already on the row. So it labelled a large slice
            of recent content with something the reader could see anyway, which
            is the same noise argument that keeps "long tail" out.

            "Rising" stays, because it is earned rather than automatic: it
            means the curve is actually accelerating. The shape itself is still
            computed and still drives sorting and the lifecycle panel -- only
            the badge is gone. */}
        {v.lifecycleShape === "rising" && (
          <span
            className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs font-medium text-emerald-500"
            title={SHAPE_HINT[v.lifecycleShape]}
          >
            {SHAPE_LABEL[v.lifecycleShape]}
          </span>
        )}

        {/* Still gaining views -- the signal a lifetime total cannot show.
            Shown as a RATE, because the raw gain was not comparable between
            rows: the window is whatever gap the sync happened to leave, and
            those run from hours to a fortnight. "+466 /3d" beside "+6 /1d"
            invited exactly the comparison the numbers could not support.

            The old label also rounded the window to whole days, so 26% of
            rows read "/0d" -- a gain over no time at all. */}
        {v.recentGain != null && v.recentGain.views > 0 && (() => {
          const perDay = gainPerDay(v.recentGain);
          const stale = v.recentGain.staleDays != null && v.recentGain.staleDays > 7;
          const title =
            `+${v.recentGain.views.toLocaleString()} views between the last two readings, ` +
            `${v.recentGain.days.toFixed(1)} days apart` +
            (perDay == null
              ? ". Too short a gap to give a daily rate."
              : ` — about ${Math.round(perDay).toLocaleString()} a day.`) +
            (stale ? ` Last read ${Math.round(v.recentGain.staleDays!)} days ago, so this is not current.` : "");
          return (
            <span
              className={`tabular text-xs ${stale ? "text-[var(--muted)]" : "text-emerald-500"}`}
              title={title}
            >
              {perDay == null ? (
                /* No rate available: show the raw gain and say so, rather
                   than inventing a per-day figure from a 20-minute gap. */
                <>+{v.recentGain.views.toLocaleString()}</>
              ) : (
                <>+{formatRate(perDay)}</>
              )}
              {stale && <span className="ml-0.5 opacity-70">·stale</span>}
            </span>
          );
        })()}

        {/* The boost badge lived here. Removed with the rest of the baseline
            model: it measured a video against a median that rises as the
            account grows, so a good video could quietly become a "bad" one
            without changing. The tile shows real reach instead. */}

        <div className="border-l border-[var(--border)] pl-3">
          <RoleCredits
            workspaceId={workspaceId}
            contentItemId={v.id}
            roles={roles}
            credits={v.credits}
            members={members}
            canManage={canManage}
            applyToIds={bulkTargets}
          />
        </div>
      </div>
    </div>
  );
}
