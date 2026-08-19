/**
 * Report builders (PRD v0.5 §5).
 *
 * Every function here is PURE: rows in, rows out, no database, no clock, no
 * formatting decisions that depend on where it is called from. That is what
 * makes the reports testable against hand-computed expectations, and what
 * lets the same person-aggregation feed both the Content page's people strip
 * and the Employee report -- two surfaces that must never disagree about how
 * many videos someone worked on.
 *
 * The output is deliberately DATA, not JSX and not functions: a Report is a
 * plain object of strings and numbers, so a server component can hand it
 * straight to a client table without tripping the RSC serialization boundary
 * (functions across that boundary crash at runtime, and only at runtime).
 *
 * The house rule holds throughout: views are never summed across platforms.
 * Reach travels as per-platform chips, including in the totals row, and the
 * CSV flattens one row per entity PER PLATFORM rather than pooling.
 */
import {
  engagementRate,
  totalsByPlatform,
  totalsByPlatformUnique,
  type PlatformTotals,
} from "@/lib/rollup";
import { formatDurationShort } from "@/lib/format";
import type { VideoSummary, ClientSummary } from "@/lib/dashboards";

/* ---- Shared person aggregation ------------------------------------------ */

export type PersonStats = {
  userId: string;
  name: string;
  videosInView: number;
  /**
   * Per-platform totals on their in-view videos -- chips, never summed
   * across platforms.
   *
   * A person's performance IS the performance of the videos they worked on,
   * stated in the platform's own units. This replaced a single boost
   * multiplier ("0.94x"), which compressed all of that into one abstract
   * number nobody could act on: it did not say whether the work reached
   * anyone, and a figure below 1.00 read as a verdict on the person rather
   * than a comparison against an account baseline that shifts under them.
   */
  platforms: { platform: string; views: number; likes: number; comments: number }[];
  /** Content roles they hold on the in-view videos, e.g. ["Editor"]. */
  roles: string[];
  /** How many in-view videos they hold each role on. */
  roleCounts: { role: string; videos: number }[];
  /** Their tracked seconds on the in-view videos. */
  seconds: number;
};

export type AssignmentLite = {
  content_item_id: string;
  user_id: string;
  roleName: string;
  /**
   * The stable key. roleName is a display string an admin can rename, and
   * filtering the URL's `qc` against the words "Quality Control" matches
   * nothing while looking perfectly reasonable -- so anything selecting by
   * role selects on this.
   */
  roleSlug: string;
};

/**
 * What each named person did inside the CURRENT view. `videos` is the
 * already-filtered set, so the answer is always scoped to whatever the
 * filters say -- filter to one client and this is their work for that
 * client, which is the entire point of the People merge (PRD v0.5 §3).
 */
export function personStats(
  people: { userId: string; name: string }[],
  videos: VideoSummary[],
  assignments: AssignmentLite[],
  /** userId -> tracked seconds on the in-view videos. */
  secondsByUser: Map<string, number>,
): PersonStats[] {
  // `scoredByContent` used to be a parameter here and was never once read --
  // left behind when avgBoost was removed. Dropped rather than kept, so the
  // next caller does not thread a Map through three files to satisfy it.
  const viewIds = new Set(videos.map((v) => v.id));
  const videoById = new Map(videos.map((v) => [v.id, v]));
  const inView = assignments.filter((a) => viewIds.has(a.content_item_id));

  return people.map(({ userId, name }) => {
    const theirs = inView.filter((a) => a.user_id === userId);
    const videoIds = [...new Set(theirs.map((a) => a.content_item_id))];

    const perPlatform = new Map<
      string,
      { views: number; likes: number; comments: number }
    >();
    for (const id of videoIds) {
      for (const pl of videoById.get(id)?.platforms ?? []) {
        const cur = perPlatform.get(pl.platform) ?? { views: 0, likes: 0, comments: 0 };
        cur.views += pl.views;
        cur.likes += pl.likes;
        cur.comments += pl.comments;
        perPlatform.set(pl.platform, cur);
      }
    }

    const byRole = new Map<string, Set<string>>();
    for (const a of theirs) {
      if (!byRole.has(a.roleName)) byRole.set(a.roleName, new Set());
      byRole.get(a.roleName)!.add(a.content_item_id);
    }

    return {
      userId,
      name,
      videosInView: videoIds.length,
      platforms: [...perPlatform.entries()]
        .map(([platform, t]) => ({ platform, ...t }))
        .sort((a, b) => b.views - a.views),
      roles: [...byRole.keys()].sort(),
      roleCounts: [...byRole.entries()]
        .map(([role, ids]) => ({ role, videos: ids.size }))
        .sort((a, b) => b.videos - a.videos || a.role.localeCompare(b.role)),
      seconds: secondsByUser.get(userId) ?? 0,
    };
  });
}

/** One role's leaderboard: everyone who held that role on the in-view videos. */
export type RoleTable = {
  roleSlug: string;
  roleName: string;
  /** Only people who actually hold this role here; never a row of zeroes. */
  rows: PersonStats[];
};

/**
 * A leaderboard per role, from data already in memory.
 *
 * The trick is that `personStats` derives its video set from the assignments
 * it is HANDED, so pre-filtering those to one role makes every figure it
 * returns role-scoped. No new query, no new aggregation, and no second
 * definition of "how many videos did this person work on" that could drift
 * out of step with the people strip.
 *
 * ORDERING. Rows sort by videos, then likes, then comments -- all of which
 * are summable across platforms. Views are deliberately NOT the sort key and
 * deliberately not a column: a single "views" number requires pooling a
 * TikTok view and a YouTube view, which are different events, and the whole
 * scoring model exists to stop exactly that. Views still appear, per platform,
 * as chips. Ranking on a number nobody should compute would make the tables
 * look authoritative while being meaningless.
 *
 * People with no credit in a role are dropped rather than listed at zero. A
 * videographer is not "worst editor"; they are not an editor.
 */
export function buildRoleTables(
  rolesInOrder: { slug: string; name: string }[],
  people: { userId: string; name: string }[],
  videos: VideoSummary[],
  assignments: AssignmentLite[],
  secondsByUser: Map<string, number>,
): RoleTable[] {
  return rolesInOrder.map((role) => {
    const forRole = assignments.filter((a) => a.roleSlug === role.slug);
    const rows = personStats(people, videos, forRole, secondsByUser)
      .filter((p) => p.videosInView > 0)
      .sort(
        (a, b) =>
          b.videosInView - a.videosInView ||
          sumLikes(b) - sumLikes(a) ||
          sumComments(b) - sumComments(a) ||
          a.name.localeCompare(b.name),
      );
    return { roleSlug: role.slug, roleName: role.name, rows };
  });
}

/** Likes and comments ARE summable across platforms; views are not. */
function sumLikes(p: PersonStats): number {
  return p.platforms.reduce((s, x) => s + x.likes, 0);
}
function sumComments(p: PersonStats): number {
  return p.platforms.reduce((s, x) => s + x.comments, 0);
}

/* ---- Report shape -------------------------------------------------------- */

export type ReportColumn = {
  key: string;
  label: string;
  /** "platforms" renders reach chips and is what the CSV flattens on. */
  kind: "text" | "number" | "platforms";
  /** Column header tooltip -- where a figure needs a caveat, it gets one. */
  hint?: string;
};

/** `sort` is what ordering uses; `text` is what the eye reads. Kept apart so
    "—" never sorts as a word and "1.2m" never sorts as a string. */
export type ReportCell = { text: string; sort: number | string; tone?: "muted" | "up" };

export type ReportRow = {
  id: string;
  /** Where the row's label links, or null for a label with nowhere to go. */
  href: string | null;
  cells: Record<string, ReportCell>;
  /** Per-platform reach for the chips column and the CSV flattening. */
  platforms: PlatformTotals[];
};

export type Report = {
  key: string;
  title: string;
  note: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Rendered pinned at the bottom; null where a total would be a lie. */
  totals: Omit<ReportRow, "id" | "href"> & { label: string } | null;
  defaultSort: { key: string; dir: "asc" | "desc" };
  csvPrefix: string;
  empty: string;
};

const num = (n: number, tone?: ReportCell["tone"]): ReportCell => ({
  text: n.toLocaleString(),
  sort: n,
  tone,
});
/** An absent figure. `sort` decides where it lands: 0 keeps empties with the
    zeroes, -1 pushes them below real values, "" sorts them first by name. */
const dash = (sort: number | string = -1): ReportCell => ({ text: "—", sort, tone: "muted" });
const dur = (seconds: number): ReportCell =>
  seconds > 0 ? { text: formatDurationShort(seconds), sort: seconds } : dash(0);
const gain = (views: number): ReportCell =>
  views > 0 ? { text: `+${views.toLocaleString()}`, sort: views, tone: "up" } : dash(0);

/** Mean of the per-platform rates -- each computed on its own denominator
    first, so a big platform cannot drag a small one's rate around. */
function avgEngagement(totals: PlatformTotals[]): ReportCell {
  const rates = totals.map(engagementRate).filter((r): r is number => r != null);
  if (rates.length === 0) return dash(-1);
  const avg = rates.reduce((s, r) => s + r, 0) / rates.length;
  return { text: `${(avg * 100).toFixed(2)}%`, sort: avg, tone: "muted" };
}

/* ---- 1. Employee -------------------------------------------------------- */

export function buildEmployeeReport(
  stats: PersonStats[],
  /** The in-view videos, for a totals row that counts each video once. */
  videos: VideoSummary[],
): Report {
  const rows: ReportRow[] = stats.map((p) => ({
    id: p.userId,
    href: `/content?person=${p.userId}`,
    cells: {
      label: { text: p.name, sort: p.name.toLowerCase() },
      videos: p.videosInView > 0 ? num(p.videosInView) : dash(0),
      // Engagement, not a multiplier. Likes and comments ARE summable across
      // platforms in a way views are not -- a like means roughly the same
      // thing everywhere, while a view is counted differently on each -- so
      // these two totals are honest where a pooled view count would not be.
      likes: p.platforms.length
        ? num(p.platforms.reduce((s, x) => s + x.likes, 0))
        : dash(0),
      comments: p.platforms.length
        ? num(p.platforms.reduce((s, x) => s + x.comments, 0))
        : dash(0),
      hours: dur(p.seconds),
      roles: p.roleCounts.length
        ? {
            text: p.roleCounts.map((r) => `${r.role} ${r.videos}`).join(" · "),
            sort: p.roles.join(","),
            tone: "muted",
          }
        : dash(""),
    },
    platforms: totalsByPlatform(
      p.platforms.map((x) => ({ platform: x.platform, views: x.views, likes: 0, comments: 0 })),
    ),
  }));

  return {
    key: "employee",
    title: "Employee report",
    note: "Everything each person did inside the current filters",
    columns: [
      { key: "label", label: "Person", kind: "text" },
      { key: "videos", label: "Videos", kind: "number", hint: "Videos they are credited on, in range" },
      { key: "likes", label: "Likes", kind: "number", hint: "Across every video they are credited on, in range" },
      { key: "comments", label: "Comments", kind: "number", hint: "Across every video they are credited on, in range" },
      { key: "hours", label: "Hours", kind: "number", hint: "Time tracked against these videos" },
      { key: "roles", label: "Roles", kind: "text" },
      { key: "reach", label: "Reach by platform", kind: "platforms" },
    ],
    rows,
    totals: {
      label: "Everyone in view",
      cells: {
        // NOT the sum of the column: a video with three credits would count
        // three times. The honest total is how many distinct videos are in
        // view at all.
        videos: { text: videos.length.toLocaleString(), sort: videos.length },
        // Summed over the VIDEOS in view, not over the person rows: a video
        // with three credits would otherwise have its likes counted three
        // times, and the total would exceed what the platform reports.
        likes: num(videos.reduce((s, v) => s + v.platforms.reduce((t, p) => t + p.likes, 0), 0)),
        comments: num(
          videos.reduce((s, v) => s + v.platforms.reduce((t, p) => t + p.comments, 0), 0),
        ),
        hours: dur(stats.reduce((s, p) => s + p.seconds, 0)),
        roles: dash(""),
      },
      // UNIQUE, because this line is the workspace total. Three Instagram
      // collab posts exist twice -- one row per account that carries them --
      // and summing both copies overstated Instagram reach by 1.37M views,
      // 14.5%. The per-person rows above still use the plain rollup: a collab
      // genuinely does appear on both accounts, and each person's own figure
      // is right.
      platforms: totalsByPlatformUnique(videos.flatMap((v) => v.platforms)),
    },
    defaultSort: { key: "videos", dir: "desc" },
    csvPrefix: "report-employees",
    empty: "Nobody is credited on anything in this view yet.",
  };
}

/* ---- 2. Client ---------------------------------------------------------- */

export function buildClientReport(clients: ClientSummary[], videos: VideoSummary[]): Report {
  // Videos in view whose client is archived or unset get their own row.
  // Without it the client rows sum to less than the videos in view and the
  // gap is invisible -- the reader has no way to know whether 24 videos are
  // missing or simply uncounted. Named, they are a finding.
  const listed = new Set(clients.map((c) => c.id));
  const orphans = videos.filter((v) => !v.clientId || !listed.has(v.clientId));
  const rowsFor: ClientSummary[] = [...clients];
  if (orphans.length > 0) {
    rowsFor.push({
      id: "__unattributed",
      name: "No active client",
      videoCount: orphans.length,
      postCount: orphans.reduce((s, v) => s + v.postCount, 0),
      totals: totalsByPlatform(orphans.flatMap((v) => v.platforms)),
      trackedSeconds: orphans.reduce((s, v) => s + v.trackedSeconds, 0),
      recentGain: orphans.reduce((s, v) => s + (v.recentGain?.views ?? 0), 0),
    });
  }

  const rows: ReportRow[] = rowsFor.map((c) => ({
    id: c.id,
    href: c.id === "__unattributed" ? null : `/content?client=${c.id}`,
    cells: {
      label: { text: c.name, sort: c.name.toLowerCase() },
      videos: c.videoCount > 0 ? num(c.videoCount) : dash(0),
      posts: c.postCount > 0 ? num(c.postCount, "muted") : dash(0),
      engagement: avgEngagement(c.totals),
      gained: gain(c.recentGain),
      hours: dur(c.trackedSeconds),
      // No tracked time is "—", never "0s": a zero here means nobody has
      // booked hours against this client, not that the work took no time.
      perVideo:
        c.videoCount && c.trackedSeconds
          ? {
              text: formatDurationShort(c.trackedSeconds / c.videoCount),
              sort: c.trackedSeconds / c.videoCount,
              tone: "muted",
            }
          : dash(0),
    },
    platforms: c.totals,
  }));

  return {
    key: "client",
    title: "Client report",
    note: "One row per client — reach stays per platform, so no row adds up to a single number",
    columns: [
      { key: "label", label: "Client", kind: "text" },
      { key: "videos", label: "Videos", kind: "number", hint: "Delivered in range" },
      { key: "posts", label: "Posts", kind: "number" },
      { key: "engagement", label: "Engagement", kind: "number", hint: "Mean of each platform's own rate" },
      { key: "gained", label: "Gained", kind: "number", hint: "Views gained inside the selected range" },
      { key: "hours", label: "Hours", kind: "number" },
      {
        key: "perVideo",
        label: "Hours / video",
        kind: "number",
        // Hours per 1k views was the obvious efficiency metric and is exactly
        // the forbidden operation: it needs one pooled view count across
        // platforms. Per video is the same question, honestly answerable.
        hint: "Time invested per delivered video",
      },
      { key: "reach", label: "Reach by platform", kind: "platforms" },
    ],
    rows,
    totals: {
      label: "All clients in view",
      // Over rowsFor, not clients: the catch-all row is part of the view, and
      // a totals line that skipped it would contradict the rows above it.
      cells: {
        videos: num(rowsFor.reduce((s, c) => s + c.videoCount, 0)),
        posts: num(rowsFor.reduce((s, c) => s + c.postCount, 0)),
        engagement: avgEngagement(totalsByPlatformUnique(rowsFor.flatMap((c) => c.totals))),
        gained: gain(rowsFor.reduce((s, c) => s + c.recentGain, 0)),
        hours: dur(rowsFor.reduce((s, c) => s + c.trackedSeconds, 0)),
        perVideo: dash(),
      },
      // See the employees total: workspace-wide lines dedupe, per-client rows
      // do not.
      platforms: totalsByPlatformUnique(rowsFor.flatMap((c) => c.totals)),
    },
    defaultSort: { key: "videos", dir: "desc" },
    csvPrefix: "report-clients",
    empty: "No clients match these filters.",
  };
}

/* ---- 3. Platform -------------------------------------------------------- */

export function buildPlatformReport(
  videos: VideoSummary[],
  /** slug -> display name, so a row reads "YouTube" not "youtube". */
  platformNames: Map<string, string>,
): Report {
  /**
   * THE PLATFORM REPORT IS THE WORKSPACE TOTAL, so it dedupes.
   *
   * This table answers "how much reach did Instagram give us", and a collab
   * post carried by two of our accounts is one post that Instagram served
   * once. Counting both copies overstated Instagram by 1.37M views (14.5%)
   * against a deduped 9.44M, and the row nobody could reconcile against
   * Instagram own figure was this one.
   */
  const totals = totalsByPlatformUnique(videos.flatMap((v) => v.platforms));
  const gainBy = new Map<string, number>();
  const videoCount = new Map<string, number>();
  const top = new Map<string, { id: string; title: string; views: number }>();

  for (const v of videos) {
    for (const g of v.platformGains) {
      gainBy.set(g.platform, (gainBy.get(g.platform) ?? 0) + g.views);
    }
    for (const pl of v.platforms) {
      videoCount.set(pl.platform, (videoCount.get(pl.platform) ?? 0) + 1);
      const best = top.get(pl.platform);
      if (!best || pl.views > best.views) {
        top.set(pl.platform, { id: v.id, title: v.title, views: pl.views });
      }
    }
  }

  const rows: ReportRow[] = totals.map((t) => {
    const best = top.get(t.platform);
    return {
      id: t.platform,
      href: `/content?platform=${t.platform}`,
      cells: {
        label: {
          text: platformNames.get(t.platform) ?? t.platform,
          sort: (platformNames.get(t.platform) ?? t.platform).toLowerCase(),
        },
        videos: num(videoCount.get(t.platform) ?? 0),
        posts: num(t.posts, "muted"),
        // A single platform's own view count -- this is the one place a
        // views column is legitimate, because the row IS the platform.
        views: num(t.views),
        likes: num(t.likes, "muted"),
        comments: num(t.comments, "muted"),
        engagement: avgEngagement([t]),
        gained: gain(gainBy.get(t.platform) ?? 0),
        top: best
          ? { text: `${best.title} · ${best.views.toLocaleString()}`, sort: best.views }
          : dash(0),
      },
      platforms: [t],
    };
  });

  return {
    key: "platform",
    title: "Platform report",
    note: "One row per platform — these rows are the reason totals are never pooled",
    columns: [
      { key: "label", label: "Platform", kind: "text" },
      { key: "videos", label: "Videos", kind: "number", hint: "Videos with at least one post here" },
      { key: "posts", label: "Posts", kind: "number" },
      { key: "views", label: "Views", kind: "number", hint: "This platform's own count — not comparable across rows" },
      { key: "likes", label: "Likes", kind: "number" },
      { key: "comments", label: "Comments", kind: "number" },
      { key: "engagement", label: "Engagement", kind: "number" },
      { key: "gained", label: "Gained", kind: "number", hint: "Views gained inside the selected range" },
      { key: "top", label: "Top video", kind: "text" },
    ],
    rows,
    // No totals row, deliberately: every column that could be summed here
    // would be summing across platforms, which is the one thing this whole
    // model refuses to do. The rows already are the totals.
    totals: null,
    defaultSort: { key: "views", dir: "desc" },
    csvPrefix: "report-platforms",
    empty: "Nothing is published on any platform in this view.",
  };
}

/* ---- CSV ---------------------------------------------------------------- */

/**
 * The export mirrors the screen, flattened one row per entity PER PLATFORM --
 * the same rule the content export already follows. A spreadsheet can then
 * pivot however it likes without ever having been handed a pooled view count
 * it might mistake for reach.
 */
export function reportToCsv(report: Report): { headers: string[]; rows: (string | number)[][] } {
  const scalar = report.columns.filter((c) => c.kind !== "platforms");
  const headers = [...scalar.map((c) => c.label), "Platform", "Views", "Likes", "Comments"];

  const rows: (string | number)[][] = [];
  for (const r of report.rows) {
    const base = scalar.map((c) => r.cells[c.key]?.text ?? "");
    if (r.platforms.length === 0) {
      rows.push([...base, "", "", "", ""]);
      continue;
    }
    for (const p of r.platforms) {
      rows.push([...base, p.platform, p.views, p.likes, p.comments]);
    }
  }
  return { headers, rows };
}
