import { OPERATING_TZ, formatInstant } from "@/lib/tz";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import HomeTodoList from "@/components/HomeTodoList";
import LeaderCard from "@/components/LeaderCard";
import { buildLeaderboards } from "@/lib/buildLeaderboards";
import CountUp from "@/components/CountUp";
import Sparkline from "@/components/viz/Sparkline";
import MiniBars from "@/components/viz/MiniBars";
import ProgressRing from "@/components/viz/ProgressRing";
import { Stat, StatGrid, SectionHeading, Empty } from "@/components/Stat";
import {
  Briefcase,
  CheckCircle2,
  Clapperboard,
  Clock,
  GraduationCap,
  ListChecks,
  RefreshCw,
  TrendingUp,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { startOfWeek } from "@/lib/dashboards";
import {
  loadArchivedClientItemIds,
  loadWeekHoursByDay,
} from "@/lib/homeData";
import { loadReachCards } from "@/lib/reachCards";
import { cachedRankings } from "@/lib/cachedRankings";
// asMultiplier is deliberately no longer imported. /home was the last surface
// rendering exp(score) as a "1.02x" verdict on a person; the function stays in
// scoring.ts because it is a tested primitive of the model, but nothing in the
// product displays it any more.
import { formatCount, formatDurationShort } from "@/lib/format";
import {
  canManage,
  one,
  CHART_COLORS,
  PLATFORM_COLORS,
  PLATFORM_LABEL,
  type Todo,
  type TrainingModule,
} from "@/lib/types";

/** Browser-tab identity; the root layout template appends the app name. */
export const metadata = { title: "Home" };

/** The company runs on Dubai time; "today" must not roll over at UTC midnight. */
function todayDubai(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: OPERATING_TZ }).format(new Date());
}

function greetingDubai(): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: OPERATING_TZ,
      hour: "2-digit",
      hour12: false,
    }).format(new Date()),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * Home -- the landing page after sign-in, shaped by role.
 *
 * A manager gets the command center: how reach is moving per platform,
 * how today's sheet and this week's hours are going, what's growing,
 * who's performing, and whether the data pipeline is healthy -- maximum
 * state of the business, one screen, no clicking around. A member gets
 * their day: tasks, training, their week, their standing.
 *
 * Charts follow the house dataviz rules: one series per axis (platforms
 * are small multiples, never summed), ink-colored text, thin marks,
 * hover layers, entrance-only motion that reduced-motion flattens.
 */
export default async function HomePage() {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;
  const manages = canManage(session.active.role);
  const today = todayDubai();
  const firstName = session.fullName.split(" ")[0] || session.fullName;

  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: OPERATING_TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  /* ---- Manager: the command center --------------------------------------- */
  if (manages) {
    // PRD v0.5 §9: Home is the picture of the business as it stands, so an
    // archived client's back catalogue is excluded from every aggregate
    // below. Nothing is deleted -- /content?client=… still has all of it.
    const archivedItemIds = await loadArchivedClientItemIds(supabase, ws);
    const [
      peopleRes,
      clientsRes,
      videosRes,
      todosRes,
      accountsRes,
      reach,
      weekHours,
      rankings,
      trainingModulesRes,
      trainingVideosRes,
      trainingAssignRes,
      trainingDoneRes,
    ] = await Promise.all([
      supabase
        .from("memberships")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", ws)
        .eq("is_active", true),
      supabase
        .from("clients")
        .select("id", { count: "exact", head: true }).is("deleted_at", null)
        .eq("workspace_id", ws)
        .eq("is_archived", false),
      supabase
        .from("content_items")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", ws),
      supabase
        .from("todos")
        .select(
          "id, workspace_id, user_id, client_id, assigned_on, description, is_done, done_at, profile:profiles!todos_user_id_fkey(full_name)",
        )
        .eq("workspace_id", ws)
        .eq("assigned_on", today)
        .order("created_at"),
      supabase
        .from("accounts")
        .select("last_synced_at, last_sync_error")
        .eq("workspace_id", ws)
        .eq("is_archived", false)
        .eq("sync_enabled", true),
      loadReachCards(ws, archivedItemIds),
      loadWeekHoursByDay(supabase, ws, startOfWeek()),
      cachedRankings(ws),
      supabase
        .from("training_modules")
        .select("id")
        .eq("workspace_id", ws)
        .eq("is_archived", false),
      supabase.from("training_videos").select("id, module_id").eq("workspace_id", ws),
      supabase.from("training_assignments").select("module_id, user_id").eq("workspace_id", ws),
      supabase.from("training_completions").select("video_id, user_id").eq("workspace_id", ws),
    ]);

    // The count query is unfiltered (a head count cannot express "except
    // these ids"), so the exclusion is applied here -- exact, and one query
    // cheaper than asking the database to do it.
    const activeVideoCount = Math.max(0, (videosRes.count ?? 0) - archivedItemIds.size);
    const { momentum, movers } = reach;

    const todos = (todosRes.data ?? []) as unknown as Todo[];
    const done = todos.filter((t) => t.is_done).length;

    const byPerson = new Map<string, { name: string; total: number; done: number }>();
    for (const t of todos) {
      const name = one(t.profile)?.full_name ?? "Unknown";
      if (!byPerson.has(t.user_id)) byPerson.set(t.user_id, { name, total: 0, done: 0 });
      const p = byPerson.get(t.user_id)!;
      p.total++;
      if (t.is_done) p.done++;
    }
    const sheet = [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name));

    // Pipeline health, at a glance.
    const accounts = (accountsRes.data ?? []) as {
      last_synced_at: string | null;
      last_sync_error: string | null;
    }[];
    const lastSync = accounts
      .map((a) => a.last_synced_at)
      .filter((t): t is string => !!t)
      .sort()
      .at(-1);
    const syncErrors = accounts.filter((a) => a.last_sync_error).length;

    // Training pulse: how much of everything assigned is complete.
    const activeModules = new Set(
      ((trainingModulesRes.data ?? []) as { id: string }[]).map((m) => m.id),
    );
    const videosByModule = new Map<string, string[]>();
    for (const v of (trainingVideosRes.data ?? []) as { id: string; module_id: string }[]) {
      if (!videosByModule.has(v.module_id)) videosByModule.set(v.module_id, []);
      videosByModule.get(v.module_id)!.push(v.id);
    }
    const doneByUser = new Map<string, Set<string>>();
    for (const c of (trainingDoneRes.data ?? []) as { video_id: string; user_id: string }[]) {
      if (!doneByUser.has(c.user_id)) doneByUser.set(c.user_id, new Set());
      doneByUser.get(c.user_id)!.add(c.video_id);
    }
    let unitsTotal = 0;
    let unitsDone = 0;
    for (const a of (trainingAssignRes.data ?? []) as { module_id: string; user_id: string }[]) {
      if (!activeModules.has(a.module_id)) continue;
      const vids = videosByModule.get(a.module_id) ?? [];
      unitsTotal += vids.length;
      const mine = doneByUser.get(a.user_id);
      if (mine) unitsDone += vids.filter((v) => mine.has(v)).length;
    }

    // Who is credited on the most videos. This replaced a "top performers"
    // list ranked by exp(score) -- the boost multiplier -- which was removed
    // everywhere else in the product and survived only here.
    //
    // The objection to it is the one recorded on PeopleInView: it is a single
    // abstract number that never says whether the work reached anyone, and it
    // reads as a verdict on a person the moment it falls below 1.00. Ranking
    // colleagues by a figure like that on the first screen they see each
    // morning is the worst possible place for it.
    //
    // A credit count claims much less, and all of what it claims is true. It
    // is volume, not quality, and the heading says so.
    const creditsByUser = new Map<string, { name: string; videos: Set<string> }>();
    for (const a of rankings.assignments) {
      if (!creditsByUser.has(a.user_id)) {
        creditsByUser.set(a.user_id, { name: a.userName, videos: new Set() });
      }
      // A person credited twice on one video counts once -- otherwise whoever
      // holds the most ROLES outranks whoever did the most work.
      creditsByUser.get(a.user_id)!.videos.add(a.content_item_id);
    }
    // Both leaderboards, over all four windows, in one pass. The workspace
    // read behind this is already cached and shared with /content, so the
    // extra windows cost arithmetic rather than queries -- which is what
    // makes the card's window switch instant.
    const leaders = await buildLeaderboards(ws, rankings.assignments);

    const weekTotalSeconds = weekHours.reduce((s, d) => s + d.seconds, 0);
    const maxMoverGain = Math.max(...movers.map((m) => m.gained), 1);

    return (
      <div className="mx-auto max-w-6xl px-6 py-6">
        <PageHeader title={`${greetingDubai()}, ${firstName}`} subtitle={dateLabel} />

        {/* ---- Headline numbers ------------------------------------------- */}
        <StatGrid>
          <div className="card-hero animate-rise relative flex items-center justify-between gap-3 p-4">
            <div className="relative">
              <div
                className="text-[11px] font-medium uppercase tracking-wide"
                style={{ color: "var(--on-dark-muted)" }}
              >
                Today&apos;s sheet
              </div>
              <div
                className="numeral mt-2 text-[30px] leading-[1.05]"
                style={{ color: "var(--white)" }}
              >
                {todos.length ? (
                  <>
                    <CountUp value={done} />
                    <span style={{ color: "var(--on-dark-muted)" }}>/{todos.length}</span>
                  </>
) : null}
              </div>
              <div className="relative mt-1.5 text-xs" style={{ color: "var(--on-dark-muted)" }}>
                {todos.length ? "tasks done across the team" : "nothing assigned yet"}
              </div>
            </div>
            <ProgressRing fraction={todos.length ? done / todos.length : 0} size={64} stroke={6}>
              <ListChecks size={18} style={{ color: "var(--on-dark-icon)" }} />
            </ProgressRing>
          </div>
          <Stat
            icon={Users}
            label="People"
            value={<CountUp value={peopleRes.count ?? 0} />}
            hint="active members"
          />
          <Stat
            icon={Briefcase}
            label="Clients"
            value={<CountUp value={clientsRes.count ?? 0} />}
            hint="currently active"
          />
          <Stat
            icon={Clapperboard}
            label="Videos"
            value={<CountUp value={activeVideoCount} />}
            hint={
              archivedItemIds.size
                ? `${archivedItemIds.size} more for archived clients`
                : "tracked in the system"
            }
          />
        </StatGrid>

        {/* ---- Reach momentum: one sparkline per platform, never summed ---- */}
        <section className="mb-7">
          <SectionHeading
            title="Reach momentum"
            note="Views gained per day, last 30 days — each platform on its own scale"
          />
          {/* The grid below is auto-fit rather than a fixed column count.
              With four platforms and lg:grid-cols-3 the last row held one card
              and two empty cells -- a third of the section blank, and worse
              each time a platform was added. auto-fit packs as many columns as
              fit at 260px and stretches the final row to fill, so the shape
              follows the data instead of a number chosen when there were three
              platforms.

              This note sits ABOVE the conditional deliberately: a braced JSX
              comment placed directly after the ternary's `) : (` is a second
              expression in a branch that allows exactly one, and does not
              parse. */}
          {momentum.length === 0 ? (
            <Empty>No snapshot history yet — momentum appears after a few daily syncs.</Empty>
          ) : (
            <div className="stagger grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-3 [&>*]:min-w-0">
              {momentum.map((m) => (
                /* flex column so the chart, not a gap, absorbs the slack.
                   The caption below is conditional, and grid rows stretch to
                   equal height -- so a platform with nothing caught up left a
                   two-line hole under its sparkline while its neighbours were
                   full. Now the chart grows into that space instead. */
                <div key={m.slug} className="card animate-rise flex flex-col p-4">
                  <div className="flex items-baseline gap-2">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: PLATFORM_COLORS[m.slug] ?? "var(--muted)" }}
                    />
                    <span className="text-sm font-semibold">
                      {PLATFORM_LABEL[m.slug] ?? m.slug}
                    </span>
                    <span className="tabular ml-auto text-lg font-semibold">
                      +<CountUp value={m.total} kind="count" />
                    </span>
                  </div>
                  {/* flex-1 and centred: this is the element that takes up the
                      slack when a card has no caption, so the chart sits in
                      the middle of whatever height the row settles on rather
                      than clinging to the top above an empty strip. */}
                  <div className="mt-2 flex flex-1 flex-col justify-center">
                    <Sparkline
                      data={m.points}
                      color={CHART_COLORS[m.slug] ?? "var(--accent)"}
                      valuePrefix="+" valueSuffix=" views"
                    />
                  </div>
                  {/* Views that arrived in readings too far apart to belong to
                      any single day -- a paused account resuming, or a client
                      coming back. Stated separately rather than drawn as a
                      spike, because on the chart it would be indistinguishable
                      from a viral day and would get acted on as one. */}
                  {/* THE FIGURE IS PER PLATFORM. THE EXPLANATION IS NOT.
                      Both used to live on the card, so the same 24-word
                      sentence printed on three of the four cards in this row
                      -- three lines each, nine lines of identical prose, and
                      it crowded the sparklines it was meant to annotate.
                      Nobody reads the third copy. The number stays where it
                      belongs and the reasoning moves below the row, said
                      once. */}
                  {m.caughtUp > 0 && (
                    <p className="mt-1.5 text-[11px] text-[var(--muted)]">
                      {/* Explicit {" "} rather than a literal space: the space
                          between an expression and the text after it was being
                          dropped, rendering "+346,031not counted". The source
                          had the space; it did not survive. This form cannot
                          be lost to whitespace handling. */}
                      +{m.caughtUp.toLocaleString()}{" "}
                      not counted above
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
          {momentum.some((m) => m.caughtUp > 0) && (
            <p className="mt-2.5 text-[11px] leading-snug text-[var(--muted)]">
              Figures marked <em>not counted above</em> arrived in readings too far
              apart to belong to any one day — a paused account resuming, or a
              client coming back. They are real views, kept out of the daily
              series because on the chart they are indistinguishable from a
              viral day.
            </p>
          )}
        </section>

        {/* ---- Hours + what's moving -------------------------------------- */}
        <div className="mb-7 grid gap-3 [&>*]:min-w-0 lg:grid-cols-2">
          {/* flex column, so whatever this card holds takes the slack rather
              than leaving it at the bottom. Grid items stretch to the tallest
              in the row, and with no hours logged the chart collapsed to its
              own small height and left a third of the card empty underneath
              -- trading one void for a smaller one. */}
          <div className="card animate-rise flex flex-col p-4">
            <div className="mb-3 flex items-baseline gap-2">
              <Clock size={15} className="text-[var(--muted)]" />
              <span className="text-sm font-semibold">Team hours this week</span>
              <span className="tabular ml-auto text-lg font-semibold">
                {weekTotalSeconds ? formatDurationShort(weekTotalSeconds) : "0h"}
              </span>
            </div>
            <div className="flex flex-1 flex-col justify-center">
              <MiniBars
                data={weekHours.map((d) => ({
                  label: d.label,
                  hint: d.hint,
                  value: Math.round((d.seconds / 3600) * 10) / 10,
                }))}
                valueSuffix="h"
                emptyLabel="No hours logged this week"
              />
            </div>
          </div>

          <div className="card animate-rise p-4">
            <div className="mb-2 flex items-baseline gap-2">
              <TrendingUp size={15} className="text-[var(--muted)]" />
              <span className="text-sm font-semibold">Moving this week</span>
              <span className="ml-auto text-xs text-[var(--muted)]">views gained, 7 days</span>
            </div>
            {movers.length === 0 ? (
              <p className="py-6 text-center text-sm text-[var(--muted)]">
                Nothing gained views this week yet.
              </p>
            ) : (
              <div className="space-y-2">
                {movers.map((v, i) => (
                  <Link
                    key={v.id}
                    href={`/content?video=${v.id}`}
                    className="group block"
                  >
                    <div className="flex items-baseline gap-2 text-sm">
                      <span className="w-4 shrink-0 text-xs text-[var(--muted)]">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate transition-colors group-hover:text-[var(--accent)]">
                        {v.title}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {v.platforms.map((p) => (
                          <span
                            key={p}
                            className="size-1.5 rounded-full"
                            style={{ background: PLATFORM_COLORS[p] ?? "var(--muted)" }}
                            title={PLATFORM_LABEL[p] ?? p}
                          />
                        ))}
                      </span>
                      <span className="tabular shrink-0 text-xs font-medium text-[var(--success)]">
                        +{formatCount(v.gained)}
                      </span>
                    </div>
                    {/* A hairline, not a bar. This is a magnitude cue for a
                        figure already printed beside it, so at 4px of
                        saturated red it was the loudest thing on the page --
                        five stacked read as an alert. 2px at 40% gives the
                        same ranking at a glance and lets the numbers talk.
                        The empty track is gone too: a rule that stops is
                        legible without drawing the half that is missing. */}
                    <div className="ml-6 mt-1.5 h-[2px]">
                      <div
                        className="bar-grow h-full rounded-full"
                        style={{
                          width: `${Math.max(4, (v.gained / maxMoverGain) * 100)}%`,
                          background: "color-mix(in srgb, var(--accent) 40%, transparent)",
                          animationDelay: `${i * 60}ms`,
                          transformOrigin: "left",
                        }}
                      />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ---- Performers, training, pipeline ------------------------------ */}
        {/* Four columns now: the two leaderboards sit side by side because
            they are a pair -- volume next to reach -- and reading one without
            the other is how a credit count gets mistaken for a verdict. */}
        <div className="mb-7 grid gap-3 [&>*]:min-w-0 sm:grid-cols-2 xl:grid-cols-4">
          <LeaderCard kind="credits" data={leaders} />
          <LeaderCard kind="views" data={leaders} />

          <Link href="/training" className="card card-interactive animate-rise flex items-center gap-4 p-4">
            <ProgressRing
              fraction={unitsTotal ? unitsDone / unitsTotal : 0}
              size={56}
              stroke={6}
              track="var(--bg-subtle)"
            >
              <GraduationCap size={16} className="text-[var(--muted)]" />
            </ProgressRing>
            <div className="min-w-0">
              <div className="text-sm font-semibold">Training</div>
              <div className="tabular mt-0.5 text-lg font-semibold">
                {unitsTotal ? `${Math.round((unitsDone / unitsTotal) * 100)}%` : null}
              </div>
              <div className="text-xs text-[var(--muted)]">
                {unitsTotal
                  ? `${unitsDone}/${unitsTotal} assigned videos watched`
                  : "nothing assigned yet"}
              </div>
            </div>
          </Link>

          <Link href="/data" className="card card-interactive animate-rise flex items-center gap-4 p-4">
            <div
              className="grid size-10 shrink-0 place-items-center rounded-full"
              style={{
                background: syncErrors ? "var(--danger-100)" : "var(--success-100)",
                color: syncErrors ? "var(--danger)" : "var(--success)",
              }}
            >
              {syncErrors ? <RefreshCw size={16} /> : <CheckCircle2 size={16} />}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold">Data pipeline</div>
              <div className="mt-0.5 text-xs text-[var(--muted)]">
                {/* The viewer's clock, not the server's. Unqualified
                    toLocaleTimeString on a server component resolves to UTC on
                    Vercel, so this said 09:25 to someone whose clock read
                    14:25. */}
                {lastSync
                  ? `last sync ${formatInstant(lastSync, session.timezone, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}`
                  : "never synced"}
              </div>
              <div className={`text-xs ${syncErrors ? "text-[var(--danger)]" : "text-[var(--muted)]"}`}>
                {syncErrors
                  ? `${syncErrors} account${syncErrors === 1 ? "" : "s"} with errors`
                  : "all accounts healthy"}
              </div>
            </div>
          </Link>
        </div>

        {/* ---- Today's sheet, person by person ----------------------------- */}
        <section>
          <SectionHeading title="Today's sheet by person">
            <Link
              href="/todos"
              className="rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--fg)]"
            >
              Open To-dos →
            </Link>
          </SectionHeading>
          {sheet.length === 0 ? (
            <Empty>Nothing on today&apos;s sheet yet — assign the day on the To-dos page.</Empty>
          ) : (
            <div className="card divide-y divide-[var(--border)] overflow-hidden">
              {sheet.map((p) => (
                <div key={p.name} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                  <div className="h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-[var(--bg-subtle)]">
                    <div
                      className="h-full rounded-full transition-[width] duration-300"
                      style={{
                        width: `${(p.done / p.total) * 100}%`,
                        background: p.done === p.total ? "var(--success)" : "var(--accent)",
                      }}
                    />
                  </div>
                  <span className="tabular w-10 shrink-0 text-right text-xs text-[var(--muted)]">
                    {p.done}/{p.total}
                  </span>
                  {p.done === p.total && (
                    <CheckCircle2 size={14} className="shrink-0" style={{ color: "var(--success)" }} />
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }

  /* ---- Member: my day ----------------------------------------------------- */
  const weekStart = startOfWeek();
  const [todosRes, modulesRes, videosRes, doneRes, myWeek, membershipRes, rankings] =
    await Promise.all([
      supabase
        .from("todos")
        .select(
          "id, workspace_id, user_id, client_id, assigned_on, description, is_done, done_at, client:clients(id, name)",
        )
        .eq("workspace_id", ws)
        .eq("assigned_on", today)
        .order("created_at"),
      supabase
        .from("training_modules")
        .select("id, workspace_id, title, description, sort_order, is_archived")
        .eq("workspace_id", ws)
        .order("sort_order"),
      supabase.from("training_videos").select("id, module_id").eq("workspace_id", ws),
      supabase.from("training_completions").select("video_id").eq("user_id", session.userId),
      loadWeekHoursByDay(supabase, ws, weekStart, session.userId),
      supabase
        .from("memberships")
        .select("weekly_capacity_hours")
        .eq("workspace_id", ws)
        .eq("user_id", session.userId)
        .maybeSingle(),
      cachedRankings(ws),
    ]);

  // RLS already scopes todos to the member's own rows and modules to
  // assigned ones; nothing here filters by user beyond that.
  const todos = (todosRes.data ?? []) as unknown as Todo[];
  const doneCount = todos.filter((t) => t.is_done).length;

  const modules = ((modulesRes.data ?? []) as TrainingModule[]).filter((m) => !m.is_archived);
  const videosByModule = new Map<string, string[]>();
  for (const v of (videosRes.data ?? []) as { id: string; module_id: string }[]) {
    if (!videosByModule.has(v.module_id)) videosByModule.set(v.module_id, []);
    videosByModule.get(v.module_id)!.push(v.id);
  }
  const myDone = new Set(((doneRes.data ?? []) as { video_id: string }[]).map((c) => c.video_id));
  const courses = modules.map((m) => {
    const vids = videosByModule.get(m.id) ?? [];
    return {
      id: m.id,
      title: m.title,
      total: vids.length,
      done: vids.filter((v) => myDone.has(v)).length,
    };
  });
  const inProgress = courses.filter((c) => c.total > 0 && c.done < c.total);
  const trainingTotals = courses.reduce(
    (s, c) => ({ done: s.done + c.done, total: s.total + c.total }),
    { done: 0, total: 0 },
  );

  const weekSeconds = myWeek.reduce((s, d) => s + d.seconds, 0);
  const capacity = Number(membershipRes.data?.weekly_capacity_hours ?? 0);

  // My own credits, by role, and the total. Both replaced a boost multiplier
  // -- see the note on `performers` above for why that number is gone from
  // the product. Being shown a personal score of 0.94x first thing in the
  // morning is the version of this that mattered most to remove.
  const myByRole = new Map<string, Set<string>>();
  const myVideoIds = new Set<string>();
  for (const a of rankings.assignments) {
    if (a.user_id !== session.userId) continue;
    if (!myByRole.has(a.roleName)) myByRole.set(a.roleName, new Set());
    myByRole.get(a.roleName)!.add(a.content_item_id);
    myVideoIds.add(a.content_item_id);
  }
  const myRoles = [...myByRole.entries()]
    .map(([roleName, ids]) => ({ roleName, videos: ids.size }))
    .sort((a, b) => b.videos - a.videos);
  // Distinct videos, not the sum of the per-role counts: one video where you
  // both shot and edited is one video, and summing would double it.
  const myVideos = myVideoIds.size;

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <PageHeader title={`${greetingDubai()}, ${firstName}`} subtitle={dateLabel} />

      <StatGrid>
        <div className="card-hero animate-rise relative flex items-center justify-between gap-3 p-4">
          <div className="relative">
            <div
              className="text-[11px] font-medium uppercase tracking-wide"
              style={{ color: "var(--on-dark-muted)" }}
            >
              Today
            </div>
            <div
              className="numeral mt-2 text-[30px] leading-[1.05]"
              style={{ color: "var(--white)" }}
            >
              {todos.length ? (
                <>
                  <CountUp value={doneCount} />
                  <span style={{ color: "var(--on-dark-muted)" }}>/{todos.length}</span>
                </>
              ) : null}
            </div>
            <div className="relative mt-1.5 text-xs" style={{ color: "var(--on-dark-muted)" }}>
              {todos.length ? "tasks done" : "nothing assigned yet"}
            </div>
          </div>
          <ProgressRing fraction={todos.length ? doneCount / todos.length : 0} size={64} stroke={6}>
            <ListChecks size={18} style={{ color: "var(--on-dark-icon)" }} />
          </ProgressRing>
        </div>
        <Stat
          icon={Clock}
          label="This week"
          value={weekSeconds ? formatDurationShort(weekSeconds) : null}
          hint={capacity > 0 ? `of ${capacity}h capacity` : "tracked so far"}
          accent={capacity > 0 && weekSeconds / 3600 > capacity}
        />
        <Stat
          icon={GraduationCap}
          label="Training"
          value={
            trainingTotals.total ? (
              <>
                <CountUp value={trainingTotals.done} />
                <span className="text-[var(--muted)]">/{trainingTotals.total}</span>
              </>
            ) : null
          }
          hint={trainingTotals.total ? "videos completed" : "nothing assigned"}
        />
        <Stat
          icon={TrendingUp}
          label="My videos"
          value={myVideos ? <CountUp value={myVideos} /> : null}
          hint={myVideos ? "credited to you" : "nothing credited yet"}
        />
      </StatGrid>

      <div className="mb-7 grid gap-3 [&>*]:min-w-0 lg:grid-cols-2">
        <section>
          <SectionHeading title="Today's tasks">
            <Link
              href="/todos"
              className="rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--fg)]"
            >
              Open To-dos →
            </Link>
          </SectionHeading>
          {todos.length === 0 ? (
            <Empty>Nothing assigned for today yet.</Empty>
          ) : (
            <HomeTodoList todos={todos} />
          )}
        </section>

        <section>
          <SectionHeading title="My week" note="hours per day" />
          <div className="card p-4">
            <MiniBars
              data={myWeek.map((d) => ({
                label: d.label,
                hint: d.hint,
                value: Math.round((d.seconds / 3600) * 10) / 10,
              }))}
              valueSuffix="h"
            />
          </div>
        </section>
      </div>

      {inProgress.length > 0 && (
        <section className="mb-7">
          <SectionHeading title="Continue training" />
          <div className="stagger grid gap-3 [&>*]:min-w-0 sm:grid-cols-2">
            {inProgress.slice(0, 4).map((c) => (
              <Link
                key={c.id}
                href={`/training/${c.id}`}
                className="card card-interactive animate-rise flex flex-col gap-2 p-4"
              >
                <span className="text-sm font-semibold">{c.title}</span>
                <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-subtle)]">
                  <div
                    className="h-full rounded-full bg-[var(--accent)]"
                    style={{ width: `${(c.done / c.total) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-[var(--muted)]">
                  {c.done}/{c.total} videos — pick up where you left off
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {myRoles.length > 0 && (
        <section>
          <SectionHeading
            title="My work by role"
            note="Videos you are credited on, in each role"
          />
          <div className="card divide-y divide-[var(--border)] overflow-hidden">
            {myRoles.map((r) => (
              <div key={r.roleName} className="flex items-center gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm">{r.roleName}</span>
                <span className="tabular text-sm font-semibold">
                  {r.videos}
                  <span className="ml-1 text-xs font-normal text-[var(--muted)]">
                    video{r.videos === 1 ? "" : "s"}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
