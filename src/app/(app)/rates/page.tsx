import PageHeader from "@/components/PageHeader";
import RatesManager from "@/components/RatesManager";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { canManage, one } from "@/lib/types";

export default async function RatesPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;

  // Rates, and cost rates especially, are close to salary data.
  if (!canManage(session.active.role)) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-6">
        <PageHeader title="Rates" subtitle="" />
        <div className="card p-8 text-sm text-[var(--muted)]">
          Only owners, admins, and managers can view billing rates.
        </div>
      </div>
    );
  }

  const [wsRes, membersRes, projectsRes] = await Promise.all([
    supabase
      .from("workspaces")
      .select("id, default_billable_rate, currency")
      .eq("id", ws)
      .maybeSingle(),
    supabase
      .from("memberships")
      .select("id, user_id, billable_rate, cost_rate, profile:profiles(full_name)")
      .eq("workspace_id", ws)
      .eq("is_active", true),
    supabase
      .from("projects")
      .select("id, name, billable_rate, budget_amount, budget_hours, is_archived")
      .eq("workspace_id", ws)
      .eq("is_archived", false)
      .order("name"),
  ]);

  type M = {
    id: string;
    user_id: string;
    billable_rate: number | null;
    cost_rate: number | null;
    profile: { full_name: string | null } | { full_name: string | null }[] | null;
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <PageHeader
        title="Rates"
        subtitle="A task rate beats a project member rate, which beats a project rate, then a member rate, then the workspace default."
      />
      <RatesManager
        workspaceId={ws}
        defaultRate={wsRes.data?.default_billable_rate ?? null}
        currency={wsRes.data?.currency ?? "USD"}
        members={((membersRes.data ?? []) as unknown as M[]).map((m) => ({
          id: m.id,
          name: one(m.profile)?.full_name ?? "Unknown",
          billable: m.billable_rate,
          cost: m.cost_rate,
        }))}
        projects={
          (projectsRes.data ?? []) as {
            id: string;
            name: string;
            billable_rate: number | null;
            budget_amount: number | null;
            budget_hours: number | null;
          }[]
        }
      />
    </div>
  );
}
