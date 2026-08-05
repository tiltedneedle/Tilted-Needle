import PageHeader from "@/components/PageHeader";
import PeopleOverview from "@/components/PeopleOverview";
import PersonDetail, { type CreditedItem } from "@/components/PersonDetail";
import TeamManager from "@/components/TeamManager";
import FilterBar from "@/components/FilterBar";
import { Stat, StatGrid, SectionHeading } from "@/components/Stat";
import { Users, Award, Clock, Gauge } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { canManage, one } from "@/lib/types";
import { formatDurationShort } from "@/lib/format";
import { type RankingsResult } from "@/lib/performanceData";
import { cachedRankings } from "@/lib/cachedRankings";
import { selectAll } from "@/lib/selectAll";
import {
  loadClientOptions,
  loadMemberOptions,
  loadPeopleOverview,
  loadRoles,
} from "@/lib/dashboards";
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
  searchParams: Promise<{
    person?: string;
    personFilter?: string;
    role?: string;
    tab?: string;
    group?: string;
    seat?: string;
    status?: string;
    client?: string;
    platform?: string;
    q?: string;
  }>;
}) {
  const sp = await searchParams;
  const { person: personId, role: roleFilter, tab } = sp;
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;
  const manages = canManage(session.active.role);

  const rankings = await cachedRankings(ws);
  // A person view must not be filtered out from under itself, so the
  // narrowing filters only apply to the roster. personFilter (the "Filter by
  // person" dropdown, narrows and composes with everything else) is
  // deliberately a different query key from person (jumps straight to that
  // person's own fixed detail view, used by cross-links elsewhere in the
  // app) -- reusing one key for both was the bug: picking someone from the
  // dropdown used to land on their fixed page, where no other filter could
  // do anything.
  const [overview, unfiltered, clientOptions, platformOptions] = await Promise.all([
    loadPeopleOverview(supabase, ws, rankings, {
      personId: sp.personFilter ?? null,
      role: roleFilter ?? null,
      group: sp.group ?? null,
      seat: sp.seat ?? null,
      status: sp.status ?? null,
      clientId: sp.client ?? null,
      platform: sp.platform ?? null,
      q: sp.q ?? null,
    }),
    loadPeopleOverview(supabase, ws, rankings),
    loadClientOptions(supabase, ws),
    supabase
      .from("platforms")
      .select("slug, display_name")
      .eq("is_enabled", true)
      .order("sort_order"),
  ]);

  const roleOptions = [...new Set(unfiltered.people.flatMap((p) => p.roles))]
    .sort()
    .map((r) => ({ value: r, label: r }));

  const filters = (
    <FilterBar
      basePath="/team"
      searchKey="q"
      searchValue={sp.q ?? null}
      searchPlaceholder="Search names…"
      filters={[
        {
          key: "personFilter",
          label: "Filter by person",
          allLabel: "Everyone",
          // Always the full roster, so a narrowing filter can never make
          // someone unreachable from the dropdown.
          options: unfiltered.people.map((p) => ({ value: p.userId, label: p.name })),
          value: sp.personFilter ?? null,
        },
        {
          key: "role",
          label: "Filter by content role",
          allLabel: "All roles",
          value: roleFilter ?? null,
          options: roleOptions,
        },
        {
          key: "client",
          label: "Filter by client worked for",
          allLabel: "Any client",
          value: sp.client ?? null,
          options: clientOptions.map((c) => ({ value: c.id, label: c.name })),
        },
        {
          key: "platform",
          label: "Filter by platform",
          allLabel: "All platforms",
          value: sp.platform ?? null,
          options: (
            (platformOptions.data ?? []) as { slug: string; display_name: string }[]
          ).map((p) => ({ value: p.slug, label: p.display_name })),
        },
        {
          key: "group",
          label: "Filter by group",
          allLabel: "All groups",
          value: sp.group ?? null,
          options: unfiltered.groupOptions.map((g) => ({ value: g, label: g })),
        },
        {
          key: "seat",
          label: "Filter by seat",
          allLabel: "Any seat",
          value: sp.seat ?? null,
          options: [
            { value: "full", label: "Full seat" },
            { value: "limited", label: "Limited seat" },
          ],
        },
        {
          key: "status",
          label: "Filter by status",
          allLabel: "Any status",
          value: sp.status ?? null,
          options: [
            { value: "active", label: "Active" },
            { value: "inactive", label: "Deactivated" },
          ],
        },
      ]}
    />
  );

  /* ---- One person ------------------------------------------------------- */
  if (personId) {
    // Prefer the filtered copy so a platform lens applies here too, but fall
    // back to the full roster: a population filter (group, seat, client)
    // should never make a person you explicitly selected unviewable.
    const person =
      overview.people.find((p) => p.userId === personId) ??
      unfiltered.people.find((p) => p.userId === personId);
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
    const [items, roles, memberOptions] = await Promise.all([
      loadCreditedItems(
        supabase,
        ws,
        personId,
        rankings.postedContentIds,
        rankings.assignments,
      ),
      loadRoles(supabase, ws),
      loadMemberOptions(supabase, ws),
    ]);
    return (
      <Shell title={person.name} subtitle="Everything this person has worked on.">
        {filters}
        <PersonDetail
          person={person}
          items={items}
          workspaceId={ws}
          roles={roles}
          members={memberOptions}
          canManage={manages}
        />
      </Shell>
    );
  }

  /* ---- Everyone --------------------------------------------------------- */
  const t = overview.totals;
  const showAdmin = tab === "admin";
  const narrowed = overview.people.length !== unfiltered.people.length;
  const weekHours =
    overview.people.reduce((s, p) => s + p.secondsThisWeek, 0) / 3600;

  return (
    <Shell
      title="People"
      subtitle="Performance, workload, and employment details for the whole team."
    >
      {filters}

      <StatGrid>
        <Stat
          hero
          icon={Users}
          label="People"
          value={String(t.people)}
          hint={
            narrowed
              ? `of ${unfiltered.people.length} — filtered`
              : t.people > t.active
                ? `${t.people - t.active} deactivated`
                : "all active"
          }
          accent={narrowed}
        />
        <Stat icon={Award} label="Credited" value={String(t.credited)} hint="on at least one video" />
        <Stat
          icon={Clock}
          label="Hours tracked"
          value={t.trackedSeconds ? formatDurationShort(t.trackedSeconds) : "—"}
          hint={narrowed ? "these people, all time" : "all time, whole team"}
        />
        <Stat
          icon={Gauge}
          label="This week"
          value={weekHours ? `${weekHours.toFixed(1)}h` : "—"}
          hint={
            t.capacityHours
              ? `${((weekHours / t.capacityHours) * 100).toFixed(0)}% of ${t.capacityHours}h capacity`
              : "no capacity set"
          }
          accent={t.capacityHours > 0 && weekHours > t.capacityHours}
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
            selfUserId={session.userId}
          />
        </>
      ) : (
        <PeopleOverview data={overview} />
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
  /** Every assignment in the workspace, so each tile can show all five roles
      and not just the ones this person happens to hold. */
  allAssignments: RankingsResult["assignments"],
): Promise<CreditedItem[]> {
  const [assignRes, postsRes, timeRes] = await Promise.all([
    supabase
      .from("content_assignments")
      .select(
        "content_item_id, role:roles(slug, name), content:content_items(id, title, produced_at, client:clients(name))",
      )
      .eq("workspace_id", ws)
      .eq("user_id", userId),
    // Every post in the workspace, so this one pages (see selectAll).
    selectAll(() =>
      supabase
        .from("platform_posts")
        .select(
          "id, content_item_id, account:accounts(platform_slug), metrics:post_current_metrics(views, likes, comments)",
        )
        .eq("workspace_id", ws)
        .order("id"),
    ),
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

  type Metrics = { views: number | null; likes: number | null; comments: number | null };
  type PostRow = {
    content_item_id: string;
    account: { platform_slug: string } | { platform_slug: string }[] | null;
    metrics: Metrics | Metrics[] | null;
  };
  const perItem = new Map<string, CreditedItem["platforms"]>();
  for (const p of (postsRes.data ?? []) as unknown as PostRow[]) {
    const acct = one(p.account);
    if (!acct) continue;
    if (!perItem.has(p.content_item_id)) perItem.set(p.content_item_id, []);
    const m = one(p.metrics);
    perItem.get(p.content_item_id)!.push({
      platform: acct.platform_slug,
      views: m?.views ?? 0,
      likes: m?.likes ?? 0,
      comments: m?.comments ?? 0,
    });
  }

  const creditsByItem = new Map<string, CreditedItem["credits"]>();
  for (const a of allAssignments) {
    if (!creditsByItem.has(a.content_item_id)) creditsByItem.set(a.content_item_id, []);
    creditsByItem.get(a.content_item_id)!.push({
      assignmentId: a.id,
      roleSlug: a.roleSlug,
      userId: a.user_id,
      userName: a.userName,
    });
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
      credits: creditsByItem.get(content.id) ?? [],
    });
  }
  items.sort((a, b) => (b.producedAt ?? "").localeCompare(a.producedAt ?? ""));
  return items;
}

/** Browser-tab identity; the root layout template appends the app name. */
export const metadata = { title: "People" };
