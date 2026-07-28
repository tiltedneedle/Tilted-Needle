import PageHeader from "@/components/PageHeader";
import PeopleOverview from "@/components/PeopleOverview";
import PersonDetail, { type CreditedItem } from "@/components/PersonDetail";
import TeamManager from "@/components/TeamManager";
import FilterBar from "@/components/FilterBar";
import { Stat, StatGrid, SectionHeading } from "@/components/Stat";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { canManage, one } from "@/lib/types";
import { formatDurationShort } from "@/lib/format";
import { computeRankings } from "@/lib/performanceData";
import { loadPeopleOverview } from "@/lib/dashboards";
import type { SeatType, WorkspaceRole } from "@/lib/types";

/**
 * Dashboard 2 of 2: People.
 *
 * Everything about the employees -- performance per content role, reach on
 * work they are credited on, hours, ongoing work, and the employment admin
 * (seats, groups, capacity) that used to live on its own page. Content lives
 * on the other dashboard (/content).
 */
export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ person?: string; role?: string; tab?: string }>;
}) {
  const { person: personId, role: roleFilter, tab } = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;
  const manages = canManage(session.active.role);

  const rankings = await computeRankings(supabase, ws);
  const overview = await loadPeopleOverview(supabase, ws, rankings);

  const roleOptions = [...new Set(overview.people.flatMap((p) => p.roles))]
    .sort()
    .map((r) => ({ value: r, label: r }));

  const filters = (
    <FilterBar
      basePath="/team"
      filters={[
        {
          key: "person",
          label: "Filter by person",
          allLabel: "Everyone",
          value: personId ?? null,
          options: overview.people.map((p) => ({ value: p.userId, label: p.name })),
        },
        {
          key: "role",
          label: "Filter by content role",
          allLabel: "All roles",
          value: roleFilter ?? null,
          options: roleOptions,
        },
      ]}
    />
  );

  /* ---- One person ------------------------------------------------------- */
  if (personId) {
    const person = overview.people.find((p) => p.userId === personId);
    if (!person) {
      return (
        <Shell title="Person" subtitle="Not found.">
          {filters}
          <div className="card p-8 text-sm text-[var(--muted)]">
            That person is not a member of this workspace.
          </div>
        </Shell>
      );
    }
    const items = await loadCreditedItems(supabase, ws, personId, rankings.postedContentIds);
    return (
      <Shell title={person.name} subtitle="Everything this person has worked on.">
        {filters}
        <PersonDetail person={person} items={items} />
      </Shell>
    );
  }

  /* ---- Everyone --------------------------------------------------------- */
  const t = overview.totals;
  const filtered = roleFilter
    ? { ...overview, people: overview.people.filter((p) => p.roles.includes(roleFilter)) }
    : overview;

  const showAdmin = tab === "admin";

  return (
    <Shell
      title="People"
      subtitle="Performance, workload, and employment details for the whole team."
    >
      {filters}

      <StatGrid>
        <Stat
          label="People"
          value={String(t.active)}
          hint={t.people > t.active ? `${t.people - t.active} deactivated` : "all active"}
        />
        <Stat
          label="Credited"
          value={String(t.credited)}
          hint="on at least one video"
        />
        <Stat
          label="Hours tracked"
          value={t.trackedSeconds ? formatDurationShort(t.trackedSeconds) : "—"}
          hint="all time, whole team"
        />
        <Stat
          label="Weekly capacity"
          value={t.capacityHours ? `${t.capacityHours}h` : "—"}
          hint="active members combined"
        />
      </StatGrid>

      {/* The employment admin is a different job from reading performance, so
          it sits behind a toggle rather than competing for the same attention. */}
      <div className="mb-5 flex gap-1 border-b border-[var(--border)]">
        <TabLink href="/team" active={!showAdmin} label="Performance" />
        <TabLink href="/team?tab=admin" active={showAdmin} label="Seats & groups" />
      </div>

      {showAdmin ? (
        <>
          <SectionHeading
            title="Employment"
            note="Deactivated members keep their tracked time; they are never deleted"
          />
          <TeamManager
            workspaceId={ws}
            members={overview.people.map((p) => ({
              id: p.membershipId,
              userId: p.userId,
              name: p.name,
              role: p.workspaceRole as WorkspaceRole,
              seat: p.seat as SeatType,
              isActive: p.isActive,
              capacityHours: p.capacityHours,
            }))}
            groups={await loadGroups(supabase, ws)}
            groupMembers={await loadGroupMembers(supabase, ws)}
            canManage={manages}
          />
        </>
      ) : (
        <PeopleOverview data={filtered} />
      )}
    </Shell>
  );
}

function TabLink({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <a
      href={href}
      className={`px-3 py-2 text-xs font-medium tracking-wide transition-colors ${
        active
          ? "border-b-2 border-[var(--accent)] text-[var(--fg)]"
          : "text-[var(--muted)] hover:text-[var(--fg)]"
      }`}
    >
      {label}
    </a>
  );
}

function Shell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <PageHeader title={title} subtitle={subtitle} />
      {children}
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function loadGroups(supabase: any, ws: string) {
  const { data } = await supabase
    .from("user_groups")
    .select("id, name")
    .eq("workspace_id", ws)
    .order("name");
  return (data ?? []) as { id: string; name: string }[];
}

async function loadGroupMembers(supabase: any, ws: string) {
  const { data: groups } = await supabase
    .from("user_groups")
    .select("id")
    .eq("workspace_id", ws);
  const ids = ((groups ?? []) as { id: string }[]).map((g) => g.id);
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from("user_group_members")
    .select("group_id, user_id")
    .in("group_id", ids);
  return (data ?? []) as { group_id: string; user_id: string }[];
}

/** Every piece of content this person is credited on, with their roles on it. */
async function loadCreditedItems(
  supabase: any,
  ws: string,
  userId: string,
  postedIds: Set<string>,
): Promise<CreditedItem[]> {
  const [assignRes, postsRes, timeRes] = await Promise.all([
    supabase
      .from("content_assignments")
      .select(
        "content_item_id, role:roles(slug, name), content:content_items(id, title, produced_at, client:clients(name))",
      )
      .eq("workspace_id", ws)
      .eq("user_id", userId),
    supabase
      .from("platform_posts")
      .select("content_item_id, account:accounts(platform_slug), metrics:post_current_metrics(views)")
      .eq("workspace_id", ws),
    supabase
      .from("time_entries")
      .select("content_item_id, duration_seconds")
      .eq("workspace_id", ws)
      .eq("user_id", userId)
      .not("content_item_id", "is", null)
      .not("ended_at", "is", null),
  ]);

  type Assign = {
    content_item_id: string;
    role: { slug: string; name: string } | { slug: string; name: string }[] | null;
    content:
      | {
          id: string;
          title: string;
          produced_at: string | null;
          client: { name: string } | { name: string }[] | null;
        }
      | {
          id: string;
          title: string;
          produced_at: string | null;
          client: { name: string } | { name: string }[] | null;
        }[]
      | null;
  };
  const assigns = (assignRes.data ?? []) as unknown as Assign[];

  type PostRow = {
    content_item_id: string;
    account: { platform_slug: string } | { platform_slug: string }[] | null;
    metrics: { views: number | null } | { views: number | null }[] | null;
  };
  const perItem = new Map<string, { platform: string; views: number }[]>();
  for (const p of (postsRes.data ?? []) as unknown as PostRow[]) {
    const acct = one(p.account);
    if (!acct) continue;
    if (!perItem.has(p.content_item_id)) perItem.set(p.content_item_id, []);
    perItem
      .get(p.content_item_id)!
      .push({ platform: acct.platform_slug, views: one(p.metrics)?.views ?? 0 });
  }

  const secondsByItem = new Map<string, number>();
  for (const t of (timeRes.data ?? []) as {
    content_item_id: string | null;
    duration_seconds: number | null;
  }[]) {
    if (!t.content_item_id) continue;
    secondsByItem.set(
      t.content_item_id,
      (secondsByItem.get(t.content_item_id) ?? 0) + (t.duration_seconds ?? 0),
    );
  }

  const seen = new Set<string>();
  const items: CreditedItem[] = [];
  for (const a of assigns) {
    const content = one(a.content);
    if (!content || seen.has(content.id)) continue;
    seen.add(content.id);
    items.push({
      id: content.id,
      title: content.title,
      clientName: one(content.client)?.name ?? null,
      producedAt: content.produced_at,
      roles: assigns
        .filter((x) => x.content_item_id === content.id)
        .map((x) => one(x.role)?.name)
        .filter((n): n is string => !!n),
      platforms: perItem.get(content.id) ?? [],
      trackedSeconds: secondsByItem.get(content.id) ?? 0,
      isPosted: postedIds.has(content.id),
    });
  }
  items.sort((a, b) => (b.producedAt ?? "").localeCompare(a.producedAt ?? ""));
  return items;
}
