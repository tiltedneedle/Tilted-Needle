import "server-only";
import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/selectAll";
import { selectIn } from "@/lib/selectIn";
import { PLATFORM_LABEL } from "@/lib/types";
import { operatingDate } from "@/lib/tz";
import { asTemplate, type ReportTemplate } from "@/lib/reportTemplates";
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
 * person and confirmed. Where a period has not been entered this returns null
 * for those fields, and the DOCUMENT then draws nothing at all -- no tile, no
 * chart, no page. A client should never receive a sheet whose content is a
 * note about our own missing data, and a zero is a claim nobody can support.
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
  /**
   * Videos PUBLISHED in this period, per our records.
   *
   * It used to be `mine.length` -- every post the account has ever had -- and
   * the document printed it as "N videos published on Instagram this period".
   * For an account with three years of history that sentence was wrong by
   * two orders of magnitude, on a page going to the client.
   */
  publishedCount: number;
  /** Everything the system holds for this account, of any age. */
  candidateCount: number;
  /**
   * Ranked distributions -- ages, locations, traffic sources, content mix.
   *
   * Empty means "not recorded this cycle", and the document draws nothing
   * rather than an empty chart: a client should never receive a page whose
   * content is a note about our own missing data.
   */
  breakdowns: {
    kind: string;
    label: string;
    value: number | null;
    rank: number;
    unit: string;
    annotation: string | null;
  }[];
};

export type ClientReport = {
  clientName: string;
  /** Which design this client receives. Only ever changes the CSS. */
  template: ReportTemplate;
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

/**
 * A label for any range, month-shaped or not.
 *
 * A whole calendar month gets its month name, because that is what the cover
 * of every report the agency sends actually says. Anything else prints its
 * real dates rather than being rounded to the month it mostly overlaps -- the
 * live Entree report runs 30 June to 30 July and calling that "July" on the
 * section headers would misstate a third of it.
 */
export function labelForPeriod(period: ReportPeriod): string {
  const [ys, ms, ds] = period.start.split("-").map(Number);
  const [ye, me, de] = period.end.split("-").map(Number);
  const lastDay = new Date(Date.UTC(ys, ms, 0)).getUTCDate();
  const wholeMonth = ys === ye && ms === me && ds === 1 && de === lastDay;
  if (wholeMonth) return `${MONTHS[ms - 1]} ${ys}`;
  const short = (y: number, m: number, d: number) => `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`;
  return `${short(ys, ms, ds)} – ${short(ye, me, de)}`;
}

export async function buildClientReport(
  workspaceId: string,
  clientId: string,
  period: ReportPeriod,
): Promise<ClientReport | null> {
  const supabase = await createClient();
  const label = labelForPeriod(period);

  const { data: client } = await supabase
    .from("clients")
    .select("id, name, report_template")
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

  // The ranked distributions hanging off those periods. Rank comes from the
  // stored order, never recomputed from value -- five search queries can all
  // sit at 0.2% and their order still means something.
  const periodIds = ((metricRows ?? []) as { id: string }[]).map((m) => m.id);
  const { data: breakdownRows } = periodIds.length
    ? await supabase
        .from("account_breakdowns")
        .select("account_metric_id, kind, label, value, rank, unit, annotation")
        .in("account_metric_id", periodIds)
        .order("rank")
    : { data: [] };
  const breakdownsByPeriod = new Map<string, ReportPlatformSection["breakdowns"]>();
  for (const b of (breakdownRows ?? []) as {
    account_metric_id: string;
    kind: string;
    label: string;
    value: number | null;
    rank: number;
    unit: string;
    annotation: string | null;
  }[]) {
    const list = breakdownsByPeriod.get(b.account_metric_id) ?? [];
    list.push({
      kind: b.kind,
      label: b.label,
      value: b.value,
      rank: b.rank,
      unit: b.unit,
      annotation: b.annotation,
    });
    breakdownsByPeriod.set(b.account_metric_id, list);
  }

  /**
   * The immediately preceding confirmed period per account, for the deltas.
   *
   * It must END before this one opens. Filtering on period_START alone let a
   * period that merely began earlier but still overlaps count as "prior" --
   * and the clearest case is a period matching ITSELF: a report run for
   * 30 June - 30 July finds the 1 - 31 July row, whose period_start is later,
   * fine -- but a report run for a range starting mid-period finds the very
   * row it is reporting on, and every delta prints "+0.0% vs previous period".
   * A change of exactly zero is a claim, and it is the one number nobody
   * questions.
   */
  const { data: priorRows } = await supabase
    .from("account_metrics")
    .select("account_id, period_end, views")
    .in("account_id", accounts.length ? accounts.map((a) => a.id) : ["none"])
    .eq("status", "confirmed")
    .lt("period_end", period.start)
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
    // Resolved HERE, so the pure ranking code compares like with like. Its
    // period bounds are operating-timezone days; an instant sliced in UTC is a
    // different calendar and put five live posts in the wrong month.
    list.push({ capturedAt: operatingDate(new Date(s.captured_at)), views: s.views });
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
        // The publish DAY in operating time, not a raw instant: the ranking
        // compares it against period bounds that are operating-timezone days.
        // A UTC slice is a different calendar and moved five live posts into
        // the wrong month.
        postedAtTs: p.posted_at_ts
          ? operatingDate(new Date(p.posted_at_ts))
          : (p.posted_at ? p.posted_at.slice(0, 10) : null),
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
      publishedCount: mine.filter(
        (v) => v.postedAtTs != null && v.postedAtTs >= period.start && v.postedAtTs <= period.end,
      ).length,
      breakdowns: m ? (breakdownsByPeriod.get(m.id as string) ?? []) : [],
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
    template: asTemplate((client as { report_template?: unknown }).report_template),
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
