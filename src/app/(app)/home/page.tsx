import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import HomeTodoList from "@/components/HomeTodoList";
import Avatar from "@/components/Avatar";
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
  Trophy,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { startOfWeek } from "@/lib/dashboards";
import {
  loadArchivedClientItemIds,
  loadPlatformMomentum,
  loadWeekMovers,
  loadWeekHoursByDay,
} from "@/lib/homeData";
import { cachedRankings } from "@/lib/cachedRankings";
import { asMultiplier } from "@/lib/scoring";
import { formatCount, formatDurationShort } from "@/lib/format";
import {
  canManage,
  one,
  PLATFORM_COLORS,
  PLATFORM_LABEL,
  type Todo,
  type TrainingModule,
} from "@/lib/types";

/** Browser-tab identity; the root layout template appends the app name. */
export const metadata = { title: "Home" };

/** The company runs on Dubai time; "today" must not roll over at UTC midnight. */
function todayDubai(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
}

function greetingDubai(): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Dubai",
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
    timeZone: "Asia/Dubai",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  /* ---- Manager: the command center --------------------------------------- */
  if (manages) {
    const weekStart = startOfWeek();
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
      momentum,
      movers,
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
        .select("id", { count: "exact", head: true })
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
      loadPlatformMomentum(supabase, ws, 30, archivedItemIds),
      loadWeekMovers(supabase, ws, 5, archivedItemIds),
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

    // Top performers: mean of each person's rankable role scores.
    const perUser = new Map<string, { name: string; scores: number[] }>();
    for (const p of rankings.people) {
      if (p.overall == null || !p.platforms.some((pl) => pl.rankable)) continue;
      if (!perUser.has(p.userId)) perUser.set(p.userId, { name: p.name, scores: [] });
      perUser.get(p.userId)!.scores.push(p.overall);
    }
    const performers = [...perUser.entries()]
      .map(([userId, u]) => ({
        userId,
        name: u.name,
        mean: u.scores.reduce((s, x) => s + x, 0) / u.scores.length,
      }))
      .sort((a, b) => b.mean - a.mean)
      .slice(0, 3);

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
                style={{ color: "rgb(255 255 255 / 0.6)" }}
              >
                Today&apos;s sheet
              </div>
              <div
                className="tabular mt-1.5 text-2xl font-semibold leading-none"
                style={{ color: "var(--white)" }}
              >
                {todos.length ? (
                  <>
                    <CountUp value={done} />
                    <span style={{ color: "rgb(255 255 255 / 0.55)" }}>/{todos.length}</span>
                  </>
                ) : (
                  "—"
                )}
              </div>
              <div className="relative mt-1.5 text-xs" style={{ color: "rgb(255 255 255 / 0.55)" }}>
                {todos.length ? "tasks done across the team" : "nothing assigned yet"}
              </div>
            </div>
            <ProgressRing fraction={todos.length ? done / todos.length : 0} size={64} stroke={6}>
              <ListChecks size={18} style={{ color: "rgb(255 255 255 / 0.75)" }} />
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
          {momentum.length === 0 ? (
            <Empty>No snapshot history yet — momentum appears after a few daily syncs.</Empty>
          ) : (
            <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {momentum.map((m) => (
                <div key={m.slug} className="card animate-rise p-4">
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
                  <div className="mt-2">
                    <Sparkline
                      data={m.points}
                      color={PLATFORM_COLORS[m.slug] ?? "var(--accent)"}
                      valuePrefix="+" valueSuffix=" views"
                    />
                  </div>
                  {/* Views that arrived in readings too far apart to belong to
                      any single day -- a paused account resuming, or a client
                      coming back. Stated separately rather than drawn as a
                      spike, because on the chart it would be indistinguishable
                      from a viral day and would get acted on as one. */}
                  {m.caughtUp > 0 && (
                    <p className="mt-1.5 text-[11px] text-[var(--muted)]">
                      +{m.caughtUp.toLocaleString()} more from a resumed page —
                      not shown above, the gap makes it no single day&apos;s gain
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ---- Hours + what's moving -------------------------------------- */}
        <div className="mb-7 grid gap-3 lg:grid-cols-2">
          <div className="card animate-rise p-4">
            <div className="mb-3 flex items-baseline gap-2">
              <Clock size={15} className="text-[var(--muted)]" />
              <span className="text-sm font-semibold">Team hours this week</span>
              <span className="tabular ml-auto text-lg font-semibold">
                {weekTotalSeconds ? formatDurationShort(weekTotalSeconds) : "—"}
              </span>
            </div>
            <MiniBars
              data={weekHours.map((d) => ({
                label: d.label,
                hint: d.hint,
                value: Math.round((d.seconds / 3600) * 10) / 10,
              }))}
              valueSuffix="h"
            />
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
                    <div className="ml-6 mt-1 h-1 overflow-hidden rounded-full bg-[var(--bg-subtle)]">
                      <div
                        className="bar-grow h-full rounded-full"
                        style={{
                          width: `${Math.max(4, (v.gained / maxMoverGain) * 100)}%`,
                          background: "var(--accent)",
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
        <div className="mb-7 grid gap-3 sm:grid-cols-3">
          <div className="card animate-rise p-4">
            <div className="mb-3 flex items-center gap-2">
              <Trophy size={15} className="text-[var(--muted)]" />
              <span className="text-sm font-semibold">Top performers</span>
            </div>
            {performers.length === 0 ? (
              <p className="text-xs text-[var(--muted)]">
                Not enough scored history yet — standings appear as credited videos mature.
              </p>
            ) : (
              <div className="space-y-2.5">
                {performers.map((p) => (
                  <Link
                    key={p.userId}
                    href={`/content?person=${p.userId}`}
                    className="group flex items-center gap-2.5"
                  >
                    <Avatar name={p.name} seed={p.userId} size={26} />
                    <span className="min-w-0 flex-1 truncate text-sm transition-colors group-hover:text-[var(--accent)]">
                      {p.name}
                    </span>
                    <span className="tabular text-sm font-semibold text-[var(--success)]">
                      {asMultiplier(p.mean).toFixed(2)}×
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

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
                {unitsTotal ? `${Math.round((unitsDone / unitsTotal) * 100)}%` : "—"}
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
                {lastSync
                  ? `last sync ${new Date(lastSync).toLocaleTimeString(undefined, {
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
              className="rounded px-2 py-0.5 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--fg)]"
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

  const myRoles = rankings.people
    .filter((p) => p.userId === session.userId)
    .map((p) => ({
      roleName: p.roleName,
      overall: p.overall,
      rankable: p.platforms.some((pl) => pl.rankable),
    }));
  const scored = myRoles.filter((r) => r.rankable && r.overall != null);
  const overall = scored.length
    ? scored.reduce((s, r) => s + (r.overall ?? 0), 0) / scored.length
    : null;

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <PageHeader title={`${greetingDubai()}, ${firstName}`} subtitle={dateLabel} />

      <StatGrid>
        <div className="card-hero animate-rise relative flex items-center justify-between gap-3 p-4">
          <div className="relative">
            <div
              className="text-[11px] font-medium uppercase tracking-wide"
              style={{ color: "rgb(255 255 255 / 0.6)" }}
            >
              Today
            </div>
            <div
              className="tabular mt-1.5 text-2xl font-semibold leading-none"
              style={{ color: "var(--white)" }}
            >
              {todos.length ? (
                <>
                  <CountUp value={doneCount} />
                  <span style={{ color: "rgb(255 255 255 / 0.55)" }}>/{todos.length}</span>
                </>
              ) : (
                "—"
              )}
            </div>
            <div className="relative mt-1.5 text-xs" style={{ color: "rgb(255 255 255 / 0.55)" }}>
              {todos.length ? "tasks done" : "nothing assigned yet"}
            </div>
          </div>
          <ProgressRing fraction={todos.length ? doneCount / todos.length : 0} size={64} stroke={6}>
            <ListChecks size={18} style={{ color: "rgb(255 255 255 / 0.75)" }} />
          </ProgressRing>
        </div>
        <Stat
          icon={Clock}
          label="This week"
          value={weekSeconds ? formatDurationShort(weekSeconds) : "—"}
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
            ) : (
              "—"
            )
          }
          hint={trainingTotals.total ? "videos completed" : "nothing assigned"}
        />
        <Stat
          icon={TrendingUp}
          label="My standing"
          value={overall != null ? `${asMultiplier(overall).toFixed(2)}×` : "—"}
          hint={overall != null ? "average across your roles" : "not enough history yet"}
          accent={overall != null && asMultiplier(overall) >= 1}
        />
      </StatGrid>

      <div className="mb-7 grid gap-3 lg:grid-cols-2">
        <section>
          <SectionHeading title="Today's tasks">
            <Link
              href="/todos"
              className="rounded px-2 py-0.5 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--fg)]"
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
          <div className="stagger grid gap-3 sm:grid-cols-2">
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

      {scored.length > 0 && (
        <section>
          <SectionHeading
            title="My standing by role"
            note="Against each platform's own baseline, same as the leaderboards"
          />
          <div className="card divide-y divide-[var(--border)] overflow-hidden">
            {myRoles
              .filter((r) => r.rankable && r.overall != null)
              .map((r) => (
                <div key={r.roleName} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm">{r.roleName}</span>
                  <span
                    className="tabular text-sm font-semibold"
                    style={{
                      color: asMultiplier(r.overall!) >= 1 ? "var(--success)" : "var(--warning)",
                    }}
                  >
                    {asMultiplier(r.overall!).toFixed(2)}×
                  </span>
                </div>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}
