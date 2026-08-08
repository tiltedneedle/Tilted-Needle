import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import ReportView from "@/components/ReportView";
import ReportTable from "@/components/ReportTable";
import ClientInsights from "@/components/ClientInsights";
import FilterBar from "@/components/FilterBar";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { canManage, one } from "@/lib/types";
import { addDays, startOfWeek } from "@/lib/format";
import { parseFilters } from "@/lib/contentFilters";
import { cachedRankings } from "@/lib/cachedRankings";
import { loadContentOverview } from "@/lib/dashboards";
import { secondsByUserOnVideos } from "@/lib/reportData";
import { buildClientEvidence } from "@/lib/analysis/clientEvidence";
import {
  personStats,
  buildEmployeeReport,
  buildClientReport,
  buildPlatformReport,
} from "@/lib/reports";
import type { Client, Project, TimeEntry } from "@/lib/types";

const TABS = [
  { key: "employee", label: "Employees" },
  { key: "client", label: "Clients" },
  { key: "platform", label: "Platforms" },
  { key: "insights", label: "Insights" },
  { key: "time", label: "Time entries" },
] as const;

/**
 * Reports (PRD v0.5 §5): the same question answered three ways -- by person,
 * by client, by platform -- over one shared time range, plus the original
 * time-entries report as a fourth tab.
 *
 * The three content reports read the SAME loader the Content dashboard uses,
 * with the SAME filter parser, so a report can never disagree with the
 * dashboard it was run from. Narrowing here is deliberately the same
 * controls, in the same order-independent model.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;
  const params = await searchParams;
  const tab = TABS.some((t) => t.key === params.report) ? params.report! : "employee";

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <PageHeader
        title="Reports"
        subtitle="Employees, clients, platforms and hours — over any stretch of time."
      />

      <div className="mb-5 flex flex-wrap gap-1 border-b border-[var(--border)]">
        {TABS.map((t) => {
          // Tab switching carries the range and narrowing across, so
          // changing the question does not reset the window you chose.
          const qs = new URLSearchParams();
          for (const [k, v] of Object.entries(params)) {
            if (v && k !== "report") qs.set(k, v);
          }
          qs.set("report", t.key);
          return (
            <Link
              key={t.key}
              href={`/reports?${qs.toString()}`}
              className={`px-3 py-2 text-xs font-medium tracking-wide transition-colors ${
                tab === t.key
                  ? "border-b-2 border-[var(--accent)] text-[var(--fg)]"
                  : "text-[var(--muted)] hover:text-[var(--fg)]"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      {tab === "time" ? (
        <TimeEntriesReport params={params} />
      ) : tab === "insights" ? (
        <InsightsReport />
      ) : (
        <ContentReport tab={tab} params={params} />
      )}
    </div>
  );
}

/* ---- The three content reports ------------------------------------------ */

async function ContentReport({
  tab,
  params,
}: {
  tab: string;
  params: Record<string, string | undefined>;
}) {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;
  const f = parseFilters(params);

  const rankings = await cachedRankings(ws);
  const [overview, membersRes] = await Promise.all([
    loadContentOverview(supabase, ws, rankings, {
      platform: f.platform,
      clientIds: f.clientIds,
      personIds: f.personIds,
      from: f.from,
      to: f.to,
    }),
    supabase
      .from("memberships")
      .select("user_id, is_active, profile:profiles(full_name)")
      .eq("workspace_id", ws)
      .eq("is_active", true),
  ]);

  type Member = {
    user_id: string;
    profile: { full_name: string | null } | { full_name: string | null }[] | null;
  };
  const members = ((membersRes.data ?? []) as unknown as Member[])
    .map((m) => ({ userId: m.user_id, name: one(m.profile)?.full_name ?? "Unknown" }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // A person filter narrows WHO gets a row; without one, everyone active
  // appears, including people with nothing in range -- a zero is a finding,
  // an absent row just reads as missing data.
  const roster = f.personIds.length
    ? members.filter((m) => f.personIds.includes(m.userId))
    : members;

  const report =
    tab === "employee"
      ? buildEmployeeReport(
          personStats(
            roster,
            overview.videos,
            rankings.assignments,
            rankings.scoredByContent,
            await secondsByUserOnVideos(
              supabase,
              ws,
              f.personIds.length ? f.personIds : null,
              overview.videos,
            ),
          ),
          overview.videos,
        )
      : tab === "client"
        ? buildClientReport(
            f.clientIds.length
              ? overview.clients.filter((c) => f.clientIds.includes(c.id))
              : overview.clients,
            overview.videos,
          )
        : buildPlatformReport(
            overview.videos,
            new Map(overview.platformOptions.map((p) => [p.slug, p.name])),
          );

  return (
    <>
      <FilterBar
        basePath="/reports"
        preserveOnClear={["report"]}
        range={{ from: f.from, to: f.to }}
        primaryCount={3}
        filters={[
          {
            key: "client",
            label: "Filter by client",
            allLabel: "All clients",
            multi: true,
            values: f.clientIds,
            options: overview.clients.map((c) => ({ value: c.id, label: c.name })),
          },
          {
            key: "person",
            label: "Filter by person",
            allLabel: "Everyone",
            multi: true,
            values: f.personIds,
            options: members.map((m) => ({ value: m.userId, label: m.name })),
          },
          {
            key: "platform",
            label: "Filter by platform",
            allLabel: "All platforms",
            value: f.platform,
            options: overview.platformOptions.map((p) => ({ value: p.slug, label: p.name })),
          },
        ]}
      />
      <ReportTable report={report} />
    </>
  );
}

/* ---- Insights: what works per client ------------------------------------ */

/**
 * Computed entirely from rows already held -- no model, no network. The AI
 * layer will narrate this table later; the table is the finding, and it is
 * readable on its own so every number can be checked against the sample size
 * printed beside it.
 */
async function InsightsReport() {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;

  const rankings = await cachedRankings(ws);
  const overview = await loadContentOverview(supabase, ws, rankings, {});

  // The opening seconds of each transcript, which is what hook analysis reads.
  // Sliced from the TIMED SEGMENTS rather than the flat text: "the first 15
  // seconds" is a claim about time, and only the segments know when a line was
  // spoken. Videos with no transcript map to null and are excluded from the
  // hook splits entirely -- unobserved is not the same as "did not do it".
  const { data: transcripts } = await supabase
    .from("video_transcripts")
    .select("content_item_id, segments")
    .eq("workspace_id", ws);
  const HOOK_MS = 15_000;
  type TranscriptRow = {
    content_item_id: string;
    segments: { start_ms: number; text: string }[] | null;
  };
  const hookBy = new Map(
    ((transcripts ?? []) as TranscriptRow[]).map((t) => [
      t.content_item_id,
      (t.segments ?? [])
        .filter((sg) => (sg.start_ms ?? 0) < HOOK_MS)
        .map((sg) => sg.text)
        .join(" ")
        .trim(),
    ]),
  );

  // Publish instants live on the posts; P2 began capturing them because the
  // date-only column can never answer a timing question.
  const { data: stamps } = await supabase
    .from("platform_posts")
    .select("content_item_id, posted_at_ts")
    .eq("workspace_id", ws)
    .not("posted_at_ts", "is", null);
  const tsBy = new Map(
    ((stamps ?? []) as { content_item_id: string; posted_at_ts: string }[]).map((r) => [
      r.content_item_id,
      r.posted_at_ts,
    ]),
  );

  const byClient = new Map<string, Parameters<typeof buildClientEvidence>[1]>();
  for (const v of overview.videos) {
    if (!v.clientId) continue;
    if (!byClient.has(v.clientId)) byClient.set(v.clientId, []);
    byClient.get(v.clientId)!.push({
      id: v.id,
      title: v.title,
      clientId: v.clientId,
      bestIndex: v.bestIndex,
      lengthSeconds: v.lengthSeconds,
      postedAtTs: tsBy.get(v.id) ?? null,
      hookText: hookBy.get(v.id) ?? null,
      platforms: v.platforms.map((p) => ({ platform: p.platform, views: p.views })),
    });
  }

  const names = new Map(overview.clients.map((c) => [c.id, c.name]));
  const entries = [...byClient.entries()]
    .map(([clientId, videos]) => ({
      clientId,
      clientName: names.get(clientId) ?? "Unknown client",
      evidence: buildClientEvidence(clientId, videos),
    }))
    // Most characterisable first: a reader wants the clients with findings.
    .sort((a, b) => b.evidence.scoredCount - a.evidence.scoredCount);

  return <ClientInsights entries={entries} />;
}

/* ---- The original time-entries report, unchanged ------------------------ */

async function TimeEntriesReport({
  params,
}: {
  params: Record<string, string | undefined>;
}) {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;

  const defaultFrom = startOfWeek(new Date());
  const from = params.from ? new Date(`${params.from}T00:00:00`) : defaultFrom;
  const to = params.to
    ? addDays(new Date(`${params.to}T00:00:00`), 1)
    : addDays(defaultFrom, 7);

  const teamScope = params.scope === "team" && canManage(session.active.role);

  let query = supabase
    .from("time_entries")
    .select(
      `id, user_id, project_id, task_id, description, started_at, ended_at,
       duration_seconds, is_billable,
       project:projects(id, name, color, client:clients(id, name)),
       task:tasks(id, name)`,
    )
    .eq("workspace_id", ws)
    .gte("started_at", from.toISOString())
    .lt("started_at", to.toISOString())
    .not("ended_at", "is", null);

  if (!teamScope) query = query.eq("user_id", session.userId);
  if (params.project) query = query.eq("project_id", params.project);

  const [entriesRes, projectsRes, clientsRes] = await Promise.all([
    query,
    supabase
      .from("projects")
      .select(
        "id, workspace_id, client_id, name, color, is_billable, is_archived, client:clients(id, name)",
      )
      .eq("workspace_id", ws)
      .order("name"),
    supabase
      .from("clients")
      .select("id, workspace_id, name, email, is_archived")
      .eq("workspace_id", ws)
      .order("name"),
  ]);

  let entries = (entriesRes.data ?? []) as unknown as TimeEntry[];

  // Client filter is applied here because PostgREST cannot filter on a nested
  // relation without an inner join that would drop entries with no project.
  if (params.client) {
    entries =
      params.client === "none"
        ? entries.filter((e) => !e.project?.client)
        : entries.filter((e) => e.project?.client?.id === params.client);
  }

  return (
    <ReportView
      entries={entries}
      projects={(projectsRes.data ?? []) as unknown as Project[]}
      clients={(clientsRes.data ?? []) as unknown as Client[]}
      canSeeTeam={canManage(session.active.role)}
      initial={{
        from: params.from ?? toInput(from),
        to: params.to ?? toInput(addDays(to, -1)),
        client: params.client ?? "",
        project: params.project ?? "",
        scope: teamScope ? "team" : "me",
      }}
    />
  );
}

function toInput(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Browser-tab identity; the root layout template appends the app name. */
export const metadata = { title: "Reports" };
