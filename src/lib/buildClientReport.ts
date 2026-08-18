import "server-only";
import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/selectAll";
import { selectIn } from "@/lib/selectIn";
import { PLATFORM_LABEL } from "@/lib/types";
import {
  deltaPct,
  pickTopVideos,
  platformNarrative,
  reportBlockers,
  type ReportPeriod,
  type ReportPost,
  type TopVideo,
  type UnmeasurableVideo,
  type ReportBlocker,
} from "@/lib/clientReport";

/**
 * Assemble one client's monthly report from everything the system can prove.
 *
 * The division of labour here is deliberate: this file does I/O and nothing
 * else interesting, and every judgement -- which videos are the month's best,
 * what sentence describes the month, when to refuse -- lives in clientReport.ts
 * where it is pure and tested against the real documents.
 *
 * WHAT IT WILL NOT DO is fill a gap. Half of a full client report is audience
 * data no public API serves and Instagram never will: followers, reach,
 * demographics, traffic sources. Those come from account_metrics, typed by a
 * person and confirmed. Where a period has not been entered, the section says
 * so. A generated report that quietly prints zeros for the numbers nobody
 * entered is worse than no report, because it looks finished.
 */

export type ReportPlatformSection = {
  platform: string;
  platformLabel: string;
  handle: string;
  /** Null when nobody has confirmed a period for this account. */
  metrics: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    followers: number | null;
    subscribers: number | null;
    netFollowers: number | null;
    netSubscribers: number | null;
    reach: number | null;
    profileViews: number | null;
    interactions: number | null;
  } | null;
  /** Percentage change in views against the previous period, or null. */
  viewsDeltaPct: number | null;
  narrative: string;
  top: TopVideo[];
  unmeasurable: UnmeasurableVideo[];
  /** Videos the system holds for this account inside the period. */
  candidateCount: number;
};

export type ClientReport = {
  clientName: string;
  period: ReportPeriod;
  periodLabel: string;
  sections: ReportPlatformSection[];
  blockers: ReportBlocker[];
  /**
   * The cross-platform total the owner's own reports print.
   *
   * Carried because it is their established format, and fenced because the
   * app refuses it everywhere else: platforms count a view differently -- a
   * Short at once, YouTube long-form at 30 seconds -- so this is a sum of
   * things measured on different scales. It travels with the caveat attached
   * so no renderer can print the figure without it.
   */
  combined: {
    views: number | null;
    likes: number | null;
    caveat: string;
  };
  /** Stated on the document, because views and likes have different dates. */
  likesCaveat: string;
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Last day of a month, without constructing a date in the wrong zone. */
function monthEnd(year: number, month1: number): string {
  const last = new Date(Date.UTC(year, month1, 0)).getUTCDate();
  return `${year}-${String(month1).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

export function monthPeriod(year: number, month1: number): { period: ReportPeriod; label: string } {
  return {
    period: {
      start: `${year}-${String(month1).padStart(2, "0")}-01`,
      end: monthEnd(year, month1),
    },
    label: `${MONTHS[month1 - 1]} ${year}`,
  };
}

export async function buildClientReport(
  workspaceId: string,
  clientId: string,
  year: number,
  month1: number,
): Promise<ClientReport | null> {
  const supabase = await createClient();
  const { period, label } = monthPeriod(year, month1);

  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .eq("id", clientId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!client) return null;

  const { data: accountRows } = await supabase
    .from("accounts")
    .select("id, platform_slug, handle, last_discovered_at")
    .eq("client_id", clientId)
    .eq("is_archived", false)
    .order("platform_slug");
  const accounts = (accountRows ?? []) as {
    id: string;
    platform_slug: string;
    handle: string;
    last_discovered_at: string | null;
  }[];

  // Confirmed periods only. A draft is a number nobody has stood behind, and
  // the whole point of the two-step is that it does not reach a client.
  const { data: metricRows } = await supabase
    .from("account_metrics")
    .select("*")
    .in("account_id", accounts.length ? accounts.map((a) => a.id) : ["none"])
    .eq("status", "confirmed")
    .lte("period_start", period.end)
    .gte("period_end", period.start);
  const metricsByAccount = new Map(
    ((metricRows ?? []) as Record<string, unknown>[]).map((m) => [m.account_id as string, m]),
  );

  // The immediately preceding confirmed period per account, for the deltas.
  const { data: priorRows } = await supabase
    .from("account_metrics")
    .select("account_id, period_end, views")
    .in("account_id", accounts.length ? accounts.map((a) => a.id) : ["none"])
    .eq("status", "confirmed")
    .lt("period_start", period.start)
    .order("period_end", { ascending: false });
  const priorByAccount = new Map<string, number | null>();
  for (const r of (priorRows ?? []) as { account_id: string; views: number | null }[]) {
    if (!priorByAccount.has(r.account_id)) priorByAccount.set(r.account_id, r.views);
  }

  // Posts and their readings. Chunked because .in() writes every id into the
  // query string, and a busy client crosses the gateway's URL limit.
  const { data: postRows } = await selectAll(() =>
    supabase
      .from("platform_posts")
      .select(
        "id, content_item_id, account_id, posted_at, posted_at_ts, content:content_items(title), metrics:post_current_metrics(likes)",
      )
      .in("account_id", accounts.length ? accounts.map((a) => a.id) : ["none"])
      .order("id"),
  );
  const posts = (postRows ?? []) as unknown as {
    id: string;
    content_item_id: string;
    account_id: string;
    posted_at: string | null;
    posted_at_ts: string | null;
    content: { title: string } | { title: string }[] | null;
    metrics: { likes: number | null } | { likes: number | null }[] | null;
  }[];

  const { data: snapRows } = await selectIn(
    posts.map((p) => p.id),
    (chunk) =>
      supabase
        .from("post_snapshots")
        .select("platform_post_id, captured_at, views")
        .in("platform_post_id", chunk)
        .order("captured_at"),
  );
  const snapsByPost = new Map<string, { capturedAt: string; views: number | null }[]>();
  for (const s of (snapRows ?? []) as {
    platform_post_id: string;
    captured_at: string;
    views: number | null;
  }[]) {
    const list = snapsByPost.get(s.platform_post_id) ?? [];
    list.push({ capturedAt: s.captured_at, views: s.views });
    snapsByPost.set(s.platform_post_id, list);
  }

  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  const num = (m: Record<string, unknown> | undefined, k: string): number | null => {
    const v = m?.[k];
    return typeof v === "number" ? v : null;
  };

  const sections: ReportPlatformSection[] = accounts.map((a) => {
    const m = metricsByAccount.get(a.id);
    const mine: ReportPost[] = posts
      .filter((p) => p.account_id === a.id)
      .map((p) => ({
        postId: p.id,
        contentItemId: p.content_item_id,
        platform: a.platform_slug,
        title: one(p.content)?.title ?? "",
        // posted_at is a UTC date slice and disagrees with the real instant
        // for 103 of 443 live posts, five of them across a month boundary.
        postedAtTs: p.posted_at_ts ?? (p.posted_at ? `${p.posted_at}T00:00:00Z` : null),
        likes: one(p.metrics)?.likes ?? 0,
        snapshots: snapsByPost.get(p.id) ?? [],
      }));

    const { top, unmeasurable } = pickTopVideos(mine, period, 3);
    const views = num(m, "views");
    const viewsDeltaPct = deltaPct(views, priorByAccount.get(a.id) ?? null);
    const isYouTube = a.platform_slug.startsWith("youtube");

    return {
      platform: a.platform_slug,
      platformLabel: PLATFORM_LABEL[a.platform_slug] ?? a.platform_slug,
      handle: a.handle,
      metrics: m
        ? {
            views,
            likes: num(m, "likes"),
            comments: num(m, "comments"),
            followers: num(m, "followers"),
            subscribers: num(m, "subscribers"),
            netFollowers: num(m, "net_followers"),
            netSubscribers: num(m, "net_subscribers"),
            reach: num(m, "reach"),
            profileViews: num(m, "profile_views"),
            interactions: num(m, "interactions"),
          }
        : null,
      viewsDeltaPct,
      narrative: platformNarrative({
        platformLabel: PLATFORM_LABEL[a.platform_slug] ?? a.platform_slug,
        views,
        likes: num(m, "likes"),
        netFollowers: isYouTube ? num(m, "net_subscribers") : num(m, "net_followers"),
        followerNoun: isYouTube ? "subscribers" : "followers",
        viewsDeltaPct,
      }),
      top,
      unmeasurable,
      candidateCount: mine.length,
    };
  });

  const confirmedHandles = accounts.filter((a) => metricsByAccount.has(a.id)).map((a) => a.handle);
  const blockers = reportBlockers({
    period,
    accounts: accounts.map((a) => ({
      handle: a.handle,
      platform: a.platform_slug,
      lastDiscoveredAt: a.last_discovered_at,
    })),
    confirmedHandles,
  });

  const entered = sections.filter((s) => s.metrics);
  const sum = (pick: (s: ReportPlatformSection) => number | null): number | null => {
    const vals = entered.map(pick).filter((n): n is number => n != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };

  return {
    clientName: client.name as string,
    period,
    periodLabel: label,
    sections,
    blockers,
    combined: {
      views: sum((s) => s.metrics?.views ?? null),
      likes: sum((s) => s.metrics?.likes ?? null),
      caveat:
        "Combined across platforms. Each platform counts a view on its own terms — a Short counts one immediately, YouTube long-form at 30 seconds — so this total adds figures measured on different scales. Per-platform numbers above are the comparable ones.",
    },
    likesCaveat:
      "View counts are as at the end of the period. Like counts are current: the system records a history of views only, so there is no like figure for a past date.",
  };
}
