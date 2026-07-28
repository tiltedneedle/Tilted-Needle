import PageHeader from "@/components/PageHeader";
import TeamManager from "@/components/TeamManager";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { canManage, one } from "@/lib/types";
import type { SeatType, WorkspaceRole } from "@/lib/types";

type MemberRow = {
  id: string;
  user_id: string;
  role: WorkspaceRole;
  seat: SeatType;
  is_active: boolean;
  weekly_capacity_hours: number;
  profile: { full_name: string | null } | { full_name: string | null }[] | null;
};

export default async function TeamPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;

  const [membersRes, groupsRes] = await Promise.all([
    supabase
      .from("memberships")
      .select(
        "id, user_id, role, seat, is_active, weekly_capacity_hours, profile:profiles(full_name)",
      )
      .eq("workspace_id", ws)
      .order("created_at"),
    supabase.from("user_groups").select("id, name").eq("workspace_id", ws).order("name"),
  ]);

  const groupIds = (groupsRes.data ?? []).map((g) => g.id);
  const groupMembersRes = groupIds.length
    ? await supabase.from("user_group_members").select("group_id, user_id").in("group_id", groupIds)
    : { data: [] };

  const members = ((membersRes.data ?? []) as unknown as MemberRow[]).map((m) => ({
    id: m.id,
    userId: m.user_id,
    name: one(m.profile)?.full_name ?? "Unknown",
    role: m.role,
    seat: m.seat,
    isActive: m.is_active,
    capacityHours: Number(m.weekly_capacity_hours),
  }));

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <PageHeader
        title="Team"
        subtitle="Deactivated members keep their tracked time; they are never deleted."
      />
      <TeamManager
        workspaceId={ws}
        members={members}
        groups={(groupsRes.data ?? []) as { id: string; name: string }[]}
        groupMembers={
          (groupMembersRes.data ?? []) as { group_id: string; user_id: string }[]
        }
        canManage={canManage(session.active.role)}
      />
    </div>
  );
}
