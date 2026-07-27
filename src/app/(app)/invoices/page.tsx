import PageHeader from "@/components/PageHeader";
import InvoicesManager from "@/components/InvoicesManager";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { canManage, one } from "@/lib/types";
import { invoiceTotals } from "@/lib/billing";

export default async function InvoicesPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;

  if (!canManage(session.active.role)) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-6">
        <PageHeader title="Invoices" subtitle="" />
        <div className="card p-8 text-sm text-[var(--muted)]">
          Only owners, admins, and managers can view invoices.
        </div>
      </div>
    );
  }

  const [invRes, lineRes, clientRes] = await Promise.all([
    supabase
      .from("invoices")
      .select(
        "id, number, status, issued_on, currency, tax_percent, discount_amount, client:clients(name)",
      )
      .eq("workspace_id", ws)
      .order("issued_on", { ascending: false }),
    supabase
      .from("invoice_lines")
      .select("invoice_id, description, quantity, unit_amount")
      .eq("workspace_id", ws)
      .order("sort_order"),
    supabase
      .from("clients")
      .select("id, name")
      .eq("workspace_id", ws)
      .eq("is_archived", false)
      .order("name"),
  ]);

  type Inv = {
    id: string;
    number: string;
    status: string;
    issued_on: string;
    currency: string;
    tax_percent: number;
    discount_amount: number;
    client: { name: string } | { name: string }[] | null;
  };
  type Line = {
    invoice_id: string;
    description: string;
    quantity: number;
    unit_amount: number;
  };

  const lines = (lineRes.data ?? []) as unknown as Line[];

  const invoices = ((invRes.data ?? []) as unknown as Inv[]).map((i) => {
    const mine = lines
      .filter((l) => l.invoice_id === i.id)
      .map((l) => ({
        description: l.description,
        quantity: Number(l.quantity),
        unitAmount: Number(l.unit_amount),
      }));
    return {
      id: i.id,
      number: i.number,
      status: i.status,
      issuedOn: i.issued_on,
      currency: i.currency,
      clientName: one(i.client)?.name ?? null,
      lines: mine,
      totals: invoiceTotals(mine, Number(i.tax_percent), Number(i.discount_amount)),
    };
  });

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <PageHeader
        title="Invoices"
        subtitle="Generated from unbilled time and expenses. Billed rows are locked so nothing is charged twice."
      />
      <InvoicesManager
        workspaceId={ws}
        clients={(clientRes.data ?? []) as { id: string; name: string }[]}
        invoices={invoices}
      />
    </div>
  );
}
