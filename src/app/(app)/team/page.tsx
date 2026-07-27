import PageHeader from "@/components/PageHeader";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import type { SeatType, WorkspaceRole } from "@/lib/types";

type Row = {
  id: string;
  role: WorkspaceRole;
  seat: SeatType;
  is_active: boolean;
  profile: { full_name: string | null } | null;
};

export default async function TeamPage() {
  const session = await requireSession();
  const supabase = await createClient();

  const { data } = await supabase
    .from("memberships")
    .select("id, role, seat, is_active, profile:profiles(full_name)")
    .eq("workspace_id", session.active.id)
    .order("created_at");

  const rows = (data ?? []) as unknown as Row[];

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <PageHeader
        title="Team"
        subtitle="Deactivated members keep their tracked time; they are never deleted."
      />

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Seat</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((m) => (
              <tr key={m.id} className="transition-colors hover:bg-[var(--bg-subtle)]">
                <td className={`px-3 py-2.5 ${m.is_active ? "" : "line-through opacity-60"}`}>
                  {m.profile?.full_name ?? "Unknown"}
                </td>
                <td className="px-3 py-2.5">
                  <span className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-xs capitalize">
                    {m.role}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-xs uppercase text-[var(--muted)]">
                  {m.seat}
                </td>
                <td className="px-3 py-2.5 text-xs text-[var(--muted)]">
                  {m.is_active ? "Active" : "Deactivated"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-[var(--muted)]">
        Invitations arrive with the approvals and permissions work in a later phase.
      </p>
    </div>
  );
}
