import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import HomeTodoList from "@/components/HomeTodoList";
import { Stat, StatGrid, SectionHeading, Empty } from "@/components/Stat";
import {
  BookOpen,
  Briefcase,
  CheckCircle2,
  Clapperboard,
  Clock,
  GraduationCap,
  ListChecks,
  PlayCircle,
  TrendingUp,
  Trophy,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { startOfWeek } from "@/lib/dashboards";
import { cachedRankings } from "@/lib/cachedRankings";
import { asMultiplier } from "@/lib/scoring";
import { formatDurationShort } from "@/lib/format";
import { canManage, one, type Todo, type TrainingModule } from "@/lib/types";

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
 * Home -- the landing page, shaped by role.
 *
 * An employee gets their day: today's tasks (with the same done toggle as
 * the sheet), the training they're mid-way through, their week against
 * capacity, and their own per-role standing -- which matters doubly now
 * that the People dashboard is manager-only; this is a member's one view
 * of their own scores.
 *
 * A manager gets the workspace at a glance: headline counts, how today's
 * sheet is progressing per person, and the doors into every dashboard.
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

  /* ---- Manager: workspace overview -------------------------------------- */
  if (manages) {
    const [peopleRes, clientsRes, videosRes, todosRes] = await Promise.all([
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
          "id, workspace_id, user_id, client_id, assigned_on, description, is_done, done_at, profile:profiles(full_name)",
        )
        .eq("workspace_id", ws)
        .eq("assigned_on", today)
        .order("created_at"),
    ]);

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

    const QUICK_LINKS = [
      { href: "/content", label: "Content", icon: PlayCircle },
      { href: "/team", label: "People", icon: Trophy },
      { href: "/clients", label: "Clients", icon: Briefcase },
      { href: "/todos", label: "To-dos", icon: ListChecks },
      { href: "/training", label: "Training", icon: GraduationCap },
      { href: "/guidelines", label: "Guidelines", icon: BookOpen },
    ];

    return (
      <div className="mx-auto max-w-5xl px-6 py-6">
        <PageHeader title={`${greetingDubai()}, ${firstName}`} subtitle={dateLabel} />

        <StatGrid>
          <Stat
            hero
            icon={ListChecks}
            label="Today's sheet"
            value={todos.length ? `${done}/${todos.length}` : "—"}
            hint={todos.length ? "tasks done across the team" : "nothing assigned yet"}
          />
          <Stat
            icon={Users}
            label="People"
            value={String(peopleRes.count ?? 0)}
            hint="active members"
          />
          <Stat
            icon={Briefcase}
            label="Clients"
            value={String(clientsRes.count ?? 0)}
            hint="currently active"
          />
          <Stat
            icon={Clapperboard}
            label="Videos"
            value={String(videosRes.count ?? 0)}
            hint="tracked in the system"
          />
        </StatGrid>

        <section className="mb-7">
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

        <SectionHeading title="Dashboards" />
        <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3">
          {QUICK_LINKS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="card card-interactive animate-rise flex items-center gap-2.5 p-4 text-sm font-medium"
            >
              <Icon size={16} strokeWidth={1.8} style={{ color: "var(--accent)" }} />
              {label}
            </Link>
          ))}
        </div>
      </div>
    );
  }

  /* ---- Member: my day ----------------------------------------------------- */
  const weekStart = startOfWeek().toISOString();
  const [todosRes, modulesRes, videosRes, doneRes, timeRes, membershipRes, rankings] =
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
      supabase
        .from("time_entries")
        .select("duration_seconds")
        .eq("workspace_id", ws)
        .eq("user_id", session.userId)
        .gte("started_at", weekStart)
        .not("ended_at", "is", null),
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

  const weekSeconds = ((timeRes.data ?? []) as { duration_seconds: number | null }[]).reduce(
    (s, t) => s + (t.duration_seconds ?? 0),
    0,
  );
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
        <Stat
          hero
          icon={ListChecks}
          label="Today"
          value={todos.length ? `${doneCount}/${todos.length}` : "—"}
          hint={todos.length ? "tasks done" : "nothing assigned yet"}
        />
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
          value={trainingTotals.total ? `${trainingTotals.done}/${trainingTotals.total}` : "—"}
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

      <section className="mb-7">
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
                      color:
                        asMultiplier(r.overall!) >= 1 ? "var(--success)" : "var(--warning)",
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
