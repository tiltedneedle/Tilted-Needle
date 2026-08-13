import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { WorkspaceRole, SeatType } from "@/lib/types";

export const ACTIVE_WORKSPACE_COOKIE = "tn_ws";

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
  seat: SeatType;
};

export type SessionContext = {
  userId: string;
  email: string;
  fullName: string;
  /**
   * Where this person is, for rendering instants only. Null until their
   * browser reports it. Day boundaries and periods use the WORKSPACE zone --
   * see profiles.timezone.
   */
  timezone: string | null;
  workspaces: WorkspaceSummary[];
  active: WorkspaceSummary;
};

/**
 * Resolves the signed-in user, their workspaces, and the active one.
 * Redirects to /login when unauthenticated and /onboarding when the user
 * belongs to no workspace yet.
 */
export async function requireSession(): Promise<SessionContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: rows } = await supabase
    .from("memberships")
    .select("role, seat, workspace:workspaces(id, name, slug)")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  type Row = {
    role: WorkspaceRole;
    seat: SeatType;
    workspace: { id: string; name: string; slug: string } | null;
  };

  const workspaces: WorkspaceSummary[] = ((rows ?? []) as unknown as Row[])
    .filter((r) => r.workspace)
    .map((r) => ({
      id: r.workspace!.id,
      name: r.workspace!.name,
      slug: r.workspace!.slug,
      role: r.role,
      seat: r.seat,
    }));

  if (workspaces.length === 0) redirect("/onboarding");

  const store = await cookies();
  const preferred = store.get(ACTIVE_WORKSPACE_COOKIE)?.value;
  // Fall back to the first workspace when the cookie points at one the user
  // no longer belongs to -- otherwise every query would silently return empty.
  const active = workspaces.find((w) => w.id === preferred) ?? workspaces[0];

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, timezone")
    .eq("id", user.id)
    .maybeSingle();

  return {
    userId: user.id,
    email: user.email ?? "",
    fullName: profile?.full_name ?? user.email?.split("@")[0] ?? "User",
    timezone: profile?.timezone ?? null,
    workspaces,
    active,
  };
}
