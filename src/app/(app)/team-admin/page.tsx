import PageHeader from "@/components/PageHeader";
import TeamManager from "@/components/TeamManager";
import { SectionHeading } from "@/components/Stat";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { canManage, one } from "@/lib/types";
import type { SeatType, WorkspaceRole } from "@/lib/types";

/**
 * PRD v0.5 §3: the employment admin, standing alone under Manage. This is
 * everything the old People page's "Seats & groups" tab held -- seats,
 * workspace roles, capacity, groups -- and nothing performance-shaped;
 * performance lives on /content with everything else. Manager-only via the
 * layout allow-list, like the rest of Manage.
 */
export default async function TeamAdminPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;

  const [membersRes, groupsRes] = await Promise.all([
    supabase
      .from("memberships")
      .select("id, user_id, role, seat, is_active, weekly_capacity_hours, profile:profiles(full_name)")
      .eq("workspace_id", ws)
      .order("created_at"),
    supabase.from("user_groups").select("id, name").eq("workspace_id", ws).order("name"),
  ]);

  type MemberRow = {
    id: string;
    user_id: string;
    role: string;
    seat: string;
    is_active: boolean;
    weekly_capacity_hours: number | null;
    profile: { full_name: string | null } | { full_name: string | null }[] | null;
  };
  const members = ((membersRes.data ?? []) as unknown as MemberRow[]).map((m) => ({
    id: m.id,
    userId: m.user_id,
    name: one(m.profile)?.full_name ?? "Unknown",
    role: m.role as WorkspaceRole,
    seat: m.seat as SeatType,
    isActive: m.is_active,
    capacityHours: m.weekly_capacity_hours ?? 0,
  }));

  const groups = (groupsRes.data ?? []) as { id: string; name: string }[];
  const groupIds = groups.map((g) => g.id);
  const groupMembers = groupIds.length
    ? (
        (
          await supabase
            .from("user_group_members")
            .select("group_id, user_id")
            .in("group_id", groupIds)
        ).data ?? []
      ) as { group_id: string; user_id: string }[]
    : [];

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <PageHeader
        title="Team admin"
        subtitle="Seats, groups, and capacity. Performance lives on Content."
      />
      <SectionHeading
        title="Employment"
        note="Deactivated members keep their tracked time; they are never deleted"
      />
      <TeamManager
        workspaceId={ws}
        members={members}
        groups={groups}
        groupMembers={groupMembers}
        canManage={canManage(session.active.role)}
        selfUserId={session.userId}
      />
    </div>
  );
}

/** Browser-tab identity; the root layout template appends the app name. */
export const metadata = { title: "Team admin" };
