import PageHeader from "@/components/PageHeader";
import TimeOffManager from "@/components/TimeOffManager";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { canManage, one } from "@/lib/types";

export default async function TimeOffPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;
  const isManager = canManage(session.active.role);
  const year = new Date().getFullYear();

  const [policiesRes, requestsRes] = await Promise.all([
    supabase
      .from("time_off_policies")
      .select("id, name, days_per_year, requires_approval, is_archived")
      .eq("workspace_id", ws)
      .eq("is_archived", false)
      .order("name"),
    // RLS already restricts this to "my own, or every request if I manage" --
    // no extra filtering needed to get the right rows for either role.
    //
    // The embed must name user_id's FK explicitly: this table also has
    // reviewed_by -> profiles, so a bare `profiles(...)` is ambiguous and
    // PostgREST rejects the whole query. That failure was going unnoticed
    // because the page discarded the error and rendered an empty list
    // instead of surfacing it -- confirmed by reproducing the exact
    // "Could not embed... more than one relationship" error outside Next.js.
    supabase
      .from("time_off_requests")
      .select(
        "id, user_id, policy_id, start_date, end_date, hours, status, note, reviewed_at, profile:profiles!time_off_requests_user_id_fkey(full_name)",
      )
      .eq("workspace_id", ws)
      .order("start_date", { ascending: false })
      .limit(200),
  ]);

  if (requestsRes.error)
    console.error("time-off requests query failed:", requestsRes.error.message);

  const policies = (policiesRes.data ?? []) as {
    id: string;
    name: string;
    days_per_year: number;
    requires_approval: boolean;
  }[];

  type ReqRow = {
    id: string;
    user_id: string;
    policy_id: string;
    start_date: string;
    end_date: string;
    hours: number;
    status: string;
    note: string | null;
    profile: { full_name: string | null } | { full_name: string | null }[] | null;
  };
  const requests = ((requestsRes.data ?? []) as unknown as ReqRow[]).map((r) => ({
    id: r.id,
    userId: r.user_id,
    name: one(r.profile)?.full_name ?? "Unknown",
    policyId: r.policy_id,
    startDate: r.start_date,
    endDate: r.end_date,
    hours: Number(r.hours),
    status: r.status,
    note: r.note,
    isMine: r.user_id === session.userId,
  }));

  // Balance is computed server-side via the SQL function so the UI never
  // reimplements the "allocation minus approved hours" rule and risks
  // drifting from what a manager sees.
  const balances: Record<string, number> = {};
  for (const p of policies) {
    const { data } = await supabase.rpc("time_off_balance", {
      p_workspace: ws,
      p_user: session.userId,
      p_policy: p.id,
      p_year: year,
    });
    if (data != null) balances[p.id] = Number(data);
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <PageHeader
        title="Time off"
        subtitle="Balances are days allocated for the year minus approved hours taken."
      />
      <TimeOffManager
        workspaceId={ws}
        policies={policies}
        requests={requests}
        balances={balances}
        isManager={isManager}
        currentUserId={session.userId}
      />
    </div>
  );
}
