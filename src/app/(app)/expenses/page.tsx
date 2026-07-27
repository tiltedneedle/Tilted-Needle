import PageHeader from "@/components/PageHeader";
import ExpensesManager from "@/components/ExpensesManager";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { one } from "@/lib/types";

export default async function ExpensesPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;

  const [expRes, projRes, wsRes] = await Promise.all([
    supabase
      .from("expenses")
      .select(
        "id, project_id, category, notes, amount, spent_on, is_billable, invoice_id, project:projects(name)",
      )
      .eq("workspace_id", ws)
      .order("spent_on", { ascending: false })
      .limit(200),
    supabase
      .from("projects")
      .select("id, name")
      .eq("workspace_id", ws)
      .eq("is_archived", false)
      .order("name"),
    supabase.from("workspaces").select("currency").eq("id", ws).maybeSingle(),
  ]);

  type Row = {
    id: string;
    project_id: string | null;
    category: string | null;
    notes: string | null;
    amount: number;
    spent_on: string;
    is_billable: boolean;
    invoice_id: string | null;
    project: { name: string } | { name: string }[] | null;
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <PageHeader
        title="Expenses"
        subtitle="Costs billed on to a client alongside tracked time."
      />
      <ExpensesManager
        workspaceId={ws}
        currency={wsRes.data?.currency ?? "USD"}
        projects={(projRes.data ?? []) as { id: string; name: string }[]}
        rows={((expRes.data ?? []) as unknown as Row[]).map((r) => ({
          id: r.id,
          projectName: one(r.project)?.name ?? null,
          category: r.category,
          notes: r.notes,
          amount: Number(r.amount),
          spentOn: r.spent_on,
          isBillable: r.is_billable,
          isInvoiced: r.invoice_id != null,
        }))}
      />
    </div>
  );
}
