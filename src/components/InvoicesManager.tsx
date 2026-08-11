"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Select from "@/components/ui/Select";
import { deleteInvoice, generateInvoice, updateInvoiceStatus } from "@/app/actions";
import { formatMoney, type InvoiceTotals } from "@/lib/billing";
import { dayKey } from "@/lib/format";

type Invoice = {
  id: string;
  number: string;
  status: string;
  issuedOn: string;
  currency: string;
  clientName: string | null;
  lines: { description: string; quantity: number; unitAmount: number }[];
  totals: InvoiceTotals;
};

const STATUSES = ["draft", "sent", "paid", "void"] as const;

const STATUS_CLASS: Record<string, string> = {
  draft: "bg-[var(--bg-subtle)] text-[var(--muted)]",
  sent: "bg-blue-500/15 text-blue-400",
  paid: "bg-emerald-500/15 text-emerald-500",
  void: "bg-[var(--bg-subtle)] text-[var(--muted)] line-through",
};

export default function InvoicesManager({
  workspaceId,
  clients,
  invoices,
}: {
  workspaceId: string;
  clients: { id: string; name: string }[];
  invoices: Invoice[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [clientId, setClientId] = useState("");
  const [upTo, setUpTo] = useState(dayKey(new Date()));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const refresh = () => startTransition(() => router.refresh());

  async function generate() {
    if (!clientId) return setError("Pick a client first.");
    setBusy(true);
    setError(null);
    const res = await generateInvoice({ workspaceId, clientId, upToDate: upTo });
    setBusy(false);
    if (res.error) return setError(res.error);
    setExpanded(res.invoiceId ?? null);
    refresh();
  }

  return (
    <>
      <div className="card mb-4 flex flex-wrap items-end gap-2 p-3">
        <label className="text-xs text-[var(--muted)]">
          Client
          {/* Archived clients stay listed HERE on purpose: work already done
              for a client you have since stopped taking on still has to be
              invoiced. Excluding them would strand that money. */}
          <Select
            className="mt-1 w-48"
            value={clientId}
            onChange={setClientId}
            placeholder="Select…"
            ariaLabel="Client"
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Include work up to
          <input
            type="date"
            className="input mt-1 w-40"
            value={upTo}
            onChange={(e) => setUpTo(e.target.value)}
          />
        </label>
        <button className="btn-primary" onClick={generate} disabled={busy}>
          {busy ? "Generating…" : "Generate invoice"}
        </button>
        <p className="w-full text-xs text-[var(--muted)]">
          Pulls every unbilled billable entry and expense for that client&apos;s
          projects, groups time by rate, and locks what it bills.
        </p>
      </div>

      {error && (
        <p className="mb-3 text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}

      {invoices.length === 0 ? (
        <div className="card p-10 text-center text-sm text-[var(--muted)]">
          No invoices yet.
        </div>
      ) : (
        <div className="space-y-2">
          {invoices.map((inv) => (
            <div key={inv.id} className="card overflow-hidden">
              <button
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--bg-subtle)]"
                onClick={() => setExpanded(expanded === inv.id ? null : inv.id)}
              >
                <span className="tabular text-sm font-medium">{inv.number}</span>
                <span className="text-sm text-[var(--muted)]">
                  {inv.clientName ?? "No client"}
                </span>
                <span className="text-xs text-[var(--muted)]">{inv.issuedOn}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-xs capitalize ${
                    STATUS_CLASS[inv.status] ?? STATUS_CLASS.draft
                  }`}
                >
                  {inv.status}
                </span>
                <div className="flex-1" />
                <span className="tabular text-sm font-semibold">
                  {formatMoney(inv.totals.total, inv.currency)}
                </span>
              </button>

              {expanded === inv.id && (
                <div className="animate-rise border-t border-[var(--border)] px-3 py-2">
                  <div className="mb-2 space-y-1">
                    {inv.lines.map((l, i) => (
                      <div key={i} className="flex items-baseline gap-3 text-sm">
                        <span className="min-w-0 flex-1 truncate">{l.description}</span>
                        <span className="tabular w-20 text-right text-xs text-[var(--muted)]">
                          {l.quantity}
                        </span>
                        <span className="tabular w-24 text-right text-xs text-[var(--muted)]">
                          × {formatMoney(l.unitAmount, inv.currency)}
                        </span>
                        <span className="tabular w-24 text-right">
                          {formatMoney(l.quantity * l.unitAmount, inv.currency)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="ml-auto w-64 space-y-0.5 border-t border-[var(--border)] pt-2 text-sm">
                    <Row label="Subtotal" value={inv.totals.subtotal} c={inv.currency} />
                    {inv.totals.discount > 0 && (
                      <Row label="Discount" value={-inv.totals.discount} c={inv.currency} />
                    )}
                    {inv.totals.tax > 0 && (
                      <Row label="Tax" value={inv.totals.tax} c={inv.currency} />
                    )}
                    <div className="flex justify-between border-t border-[var(--border)] pt-1 font-semibold">
                      <span>Total</span>
                      <span className="tabular">
                        {formatMoney(inv.totals.total, inv.currency)}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {STATUSES.map((s) => (
                      <button
                        key={s}
                        className={`rounded px-2 py-1 text-xs capitalize transition-colors ${
                          inv.status === s
                            ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                            : "text-[var(--muted)] hover:bg-[var(--border)]"
                        }`}
                        onClick={async () => {
                          const res = await updateInvoiceStatus(inv.id, s);
                          if (res.error) setError(res.error);
                          refresh();
                        }}
                      >
                        {s}
                      </button>
                    ))}
                    <div className="flex-1" />
                    {confirmDelete === inv.id ? (
                      <span className="flex items-center gap-1 text-xs">
                        <span className="text-[var(--muted)]">
                          Delete and unlock its time?
                        </span>
                        <button
                          className="rounded bg-[var(--danger)] px-2 py-1 text-xs text-[var(--accent-fg)]"
                          onClick={async () => {
                            const res = await deleteInvoice(inv.id);
                            if (res.error) setError(res.error);
                            setConfirmDelete(null);
                            refresh();
                          }}
                        >
                          Delete
                        </button>
                        <button
                          className="btn px-2 py-1 text-xs"
                          onClick={() => setConfirmDelete(null)}
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        className="rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--danger)]"
                        onClick={() => setConfirmDelete(inv.id)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Row({ label, value, c }: { label: string; value: number; c: string }) {
  return (
    <div className="flex justify-between text-[var(--muted)]">
      <span>{label}</span>
      <span className="tabular">{formatMoney(value, c)}</span>
    </div>
  );
}
