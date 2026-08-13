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

  const [kiosksRes, projectsRes, membersRes, pinRes] = await Promise.all([
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
    // No kiosk_pin_hash here. Column-level SELECT on it is revoked, and
    // PostgREST rejects the ENTIRE query when any requested column is -- 403,
    // 42501 -- so asking for it did not hide the PIN column, it stopped the
    // member list loading at all. Whether a PIN exists comes from the RPC
    // below, which reads the hash inside SECURITY DEFINER and returns a
    // boolean.
    supabase
      .from("memberships")
      .select("id, profile:profiles(full_name)")
      .eq("workspace_id", ws)
      .eq("is_active", true),
    supabase.rpc("kiosk_pin_status", { ws }),
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
    profile: { full_name: string | null } | { full_name: string | null }[] | null;
  };

  const hasPinById = new Map(
    ((pinRes.data ?? []) as { membership_id: string; has_pin: boolean }[]).map((r) => [
      r.membership_id,
      r.has_pin,
    ]),
  );

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
          hasPin: hasPinById.get(m.id) ?? false,
        }))}
      />
    </div>
  );
}
