import PageHeader from "@/components/PageHeader";
import ApprovalsManager from "@/components/ApprovalsManager";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { canManage, one } from "@/lib/types";

export default async function ApprovalsPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;

  if (!canManage(session.active.role)) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-6">
        <PageHeader title="Approvals" subtitle="" />
        <div className="card p-8 text-sm text-[var(--muted)]">
          Only owners, admins, and managers review timesheet submissions.
        </div>
      </div>
    );
  }

  // profiles must be disambiguated: this table also has reviewed_by ->
  // profiles, so a bare `profiles(...)` embed is rejected by PostgREST as
  // ambiguous and the query fails outright (same bug found and fixed on the
  // Time off page, which has the identical user_id + reviewed_by shape).
  const { data, error } = await supabase
    .from("timesheet_submissions")
    .select(
      "id, period_start, period_end, status, note, submitted_at, review_note, reviewed_at, profile:profiles!timesheet_submissions_user_id_fkey(full_name)",
    )
    .eq("workspace_id", ws)
    .order("submitted_at", { ascending: false })
    .limit(200);
  if (error) console.error("approvals query failed:", error.message);

  type Row = {
    id: string;
    period_start: string;
    period_end: string;
    status: string;
    note: string | null;
    submitted_at: string;
    review_note: string | null;
    reviewed_at: string | null;
    profile: { full_name: string | null } | { full_name: string | null }[] | null;
  };

  const rows = ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    name: one(r.profile)?.full_name ?? "Unknown",
    periodStart: r.period_start,
    periodEnd: r.period_end,
    status: r.status,
    note: r.note,
    submittedAt: r.submitted_at,
    reviewNote: r.review_note,
  }));

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <PageHeader
        title="Approvals"
        subtitle="Approving a week locks its entries: the member can no longer edit or delete them."
      />
      <ApprovalsManager rows={rows} />
    </div>
  );
}

/** Browser-tab identity; the root layout template appends the app name. */
export const metadata = { title: "Approvals" };
