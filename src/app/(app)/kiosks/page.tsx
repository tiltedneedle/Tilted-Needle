import PageHeader from "@/components/PageHeader";
import KiosksManager from "@/components/KiosksManager";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { canManage, one } from "@/lib/types";

export default async function KiosksPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;

  if (!canManage(session.active.role)) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-6">
        <PageHeader title="Kiosks" subtitle="" />
        <div className="card p-8 text-sm text-[var(--muted)]">
          Only owners, admins, and managers manage kiosk devices.
        </div>
      </div>
    );
  }

  const [kiosksRes, projectsRes, membersRes] = await Promise.all([
    supabase
      .from("kiosks")
      .select("id, name, device_token, project_id, is_active, project:projects(name)")
      .eq("workspace_id", ws)
      .order("name"),
    supabase
      .from("projects")
      .select("id, name")
      .eq("workspace_id", ws)
      .eq("is_archived", false)
      .order("name"),
    supabase
      .from("memberships")
      .select("id, kiosk_pin_hash, profile:profiles(full_name)")
      .eq("workspace_id", ws)
      .eq("is_active", true),
  ]);

  type KioskRow = {
    id: string;
    name: string;
    device_token: string;
    project_id: string | null;
    is_active: boolean;
    project: { name: string } | { name: string }[] | null;
  };
  type MemberRow = {
    id: string;
    kiosk_pin_hash: string | null;
    profile: { full_name: string | null } | { full_name: string | null }[] | null;
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <PageHeader
        title="Kiosks"
        subtitle="A shared device clocks people in with a PIN, not their account password."
      />
      <KiosksManager
        workspaceId={ws}
        kiosks={((kiosksRes.data ?? []) as unknown as KioskRow[]).map((k) => ({
          id: k.id,
          name: k.name,
          deviceToken: k.device_token,
          projectName: one(k.project)?.name ?? null,
          isActive: k.is_active,
        }))}
        projects={(projectsRes.data ?? []) as { id: string; name: string }[]}
        members={((membersRes.data ?? []) as unknown as MemberRow[]).map((m) => ({
          id: m.id,
          name: one(m.profile)?.full_name ?? "Unknown",
          hasPin: !!m.kiosk_pin_hash,
        }))}
      />
    </div>
  );
}
