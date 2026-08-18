import PageHeader from "@/components/PageHeader";
import TeamManager from "@/components/TeamManager";
import { SectionHeading } from "@/components/Stat";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/workspace";
import { canManage, one } from "@/lib/types";
import type { SeatType, WorkspaceRole } from "@/lib/types";

/**
 * PRD v0.5 §3: the employment admin, standing alone under Manage. This is
 * everything about EMPLOYMENT in one place -- who has an account, what they
 * can do, whether they can still get in, and how many hours a week they are
 * expected to work -- and nothing performance-shaped; performance lives on
 * /content with everything else. Manager-only via the layout allow-list.
 */
export default async function TeamAdminPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;

  const membersRes = await supabase
    .from("memberships")
    .select("id, user_id, role, seat, is_active, weekly_capacity_hours, profile:profiles(full_name)")
    .eq("workspace_id", ws)
    .order("created_at");

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

  /**
   * Groups are no longer read here.
   *
   * user_groups and user_group_members were written by this page and read by
   * nothing else in the codebase -- not permissions, not reports, not filters,
   * not billing. A "Group" column was a label with no consequence, which is
   * worse than an absent feature because it invites people to organise around
   * a distinction the system never acts on.
   *
   * The tables and their server actions are deliberately left in place, so
   * nothing is lost if groups are given a real job later.
   */
  /**
   * Email and last sign-in, which only the service role can see.
   *
   * They live in auth.users, and no RLS policy can reach that table -- which
   * is why this page could show a roster of names with no way to tell who an
   * account actually belongs to, or whether anyone had ever used it.
   *
   * Read here and merged into the roster rather than handed to the client
   * component wholesale: an admin client's output must never leave a server
   * component unfiltered, and the two fields below are the entire need.
   *
   * There is no password here and there cannot be. Supabase stores a one-way
   * hash; the reset link on each row is the only way back into an account.
   */
  const identities = new Map<string, { email: string | null; lastSignInAt: string | null }>();
  if (canManage(session.active.role)) {
    const admin = createAdminClient();
    // 200 is well above any plausible staff roster and keeps this to one call.
    const { data: authUsers } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    for (const u of authUsers?.users ?? []) {
      identities.set(u.id, {
        email: u.email ?? null,
        lastSignInAt: u.last_sign_in_at ?? null,
      });
    }
  }
  const roster = members.map((m) => ({
    ...m,
    email: identities.get(m.userId)?.email ?? null,
    lastSignInAt: identities.get(m.userId)?.lastSignInAt ?? null,
  }));

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <PageHeader
        title="Team admin"
        subtitle="Accounts, access and capacity, on one page. Performance lives on Content."
      />
      <SectionHeading
        title="People"
        note="Removing someone revokes access — their tracked time and credits stay"
      />
      <TeamManager
        workspaceId={ws}
        members={roster}
        canManage={canManage(session.active.role)}
        isOwnerOrAdmin={session.active.role === "owner" || session.active.role === "admin"}
        selfUserId={session.userId}
      />
    </div>
  );
}

/** Browser-tab identity; the root layout template appends the app name. */
export const metadata = { title: "Team admin" };
