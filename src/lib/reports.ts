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
import { engagementRate, totalsByPlatform, type PlatformTotals } from "@/lib/rollup";
import { formatDurationShort } from "@/lib/format";
import type { VideoSummary, ClientSummary } from "@/lib/dashboards";

/* ---- Shared person aggregation ------------------------------------------ */

export type PersonStats = {
  userId: string;
  name: string;
  videosInView: number;
  /** Per-platform reach on their in-view videos -- chips, never summed. */
  platforms: { platform: string; views: number }[];
  /** Mean boost index across the scored posts of their in-view videos. */
  avgBoost: number | null;
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
  scoredByContent: Map<string, { index: number }[]>,
  /** userId -> tracked seconds on the in-view videos. */
  secondsByUser: Map<string, number>,
): PersonStats[] {
  const viewIds = new Set(videos.map((v) => v.id));
  const videoById = new Map(videos.map((v) => [v.id, v]));
  const inView = assignments.filter((a) => viewIds.has(a.content_item_id));

  return people.map(({ userId, name }) => {
    const theirs = inView.filter((a) => a.user_id === userId);
    const videoIds = [...new Set(theirs.map((a) => a.content_item_id))];

    const perPlatform = new Map<string, number>();
    const boosts: number[] = [];
    for (const id of videoIds) {
      for (const pl of videoById.get(id)?.platforms ?? []) {
        perPlatform.set(pl.platform, (perPlatform.get(pl.platform) ?? 0) + pl.views);
      }
      for (const s of scoredByContent.get(id) ?? []) boosts.push(s.index);
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
        .map(([platform, views]) => ({ platform, views }))
        .sort((a, b) => b.views - a.views),
      avgBoost: boosts.length ? boosts.reduce((s, x) => s + x, 0) / boosts.length : null,
      roles: [...byRole.keys()].sort(),
      roleCounts: [...byRole.entries()]
        .map(([role, ids]) => ({ role, videos: ids.size }))
        .sort((a, b) => b.videos - a.videos || a.role.localeCompare(b.role)),
      seconds: secondsByUser.get(userId) ?? 0,
    };
  });
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
      boost:
        p.avgBoost != null
          ? { text: `${p.avgBoost.toFixed(2)}×`, sort: p.avgBoost }
          : dash(-1),
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
      { key: "boost", label: "Avg boost", kind: "number", hint: "Mean multiplier across their scored posts here" },
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
        boost: dash(),
        hours: dur(stats.reduce((s, p) => s + p.seconds, 0)),
        roles: dash(""),
      },
      platforms: totalsByPlatform(videos.flatMap((v) => v.platforms)),
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
        engagement: avgEngagement(totalsByPlatform(rowsFor.flatMap((c) => c.totals))),
        gained: gain(rowsFor.reduce((s, c) => s + c.recentGain, 0)),
        hours: dur(rowsFor.reduce((s, c) => s + c.trackedSeconds, 0)),
        perVideo: dash(),
      },
      platforms: totalsByPlatform(rowsFor.flatMap((c) => c.totals)),
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
  const totals = totalsByPlatform(videos.flatMap((v) => v.platforms));
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
