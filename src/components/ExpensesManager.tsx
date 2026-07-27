"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createExpense, deleteExpense } from "@/app/actions";
import { formatMoney } from "@/lib/billing";
import { dayKey } from "@/lib/format";

type Row = {
  id: string;
  projectName: string | null;
  category: string | null;
  notes: string | null;
  amount: number;
  spentOn: string;
  isBillable: boolean;
  isInvoiced: boolean;
};

export default function ExpensesManager({
  workspaceId,
  currency,
  projects,
  rows,
}: {
  workspaceId: string;
  currency: string;
  projects: { id: string; name: string }[];
  rows: Row[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [amount, setAmount] = useState("");
  const [spentOn, setSpentOn] = useState(dayKey(new Date()));
  const [billable, setBillable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => startTransition(() => router.refresh());

  const billableTotal = rows
    .filter((r) => r.isBillable && !r.isInvoiced)
    .reduce((s, r) => s + r.amount, 0);

  async function create() {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return setError("Enter an amount above zero.");
    setBusy(true);
    const res = await createExpense({
      workspaceId,
      projectId: projectId || null,
      category,
      notes,
      amount: n,
      spentOn,
      isBillable: billable,
    });
    setBusy(false);
    if (res.error) return setError(res.error);
    setAmount("");
    setNotes("");
    setError(null);
    setOpen(false);
    refresh();
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        {!open && (
          <button className="btn-primary" onClick={() => setOpen(true)}>
            Add expense
          </button>
        )}
        <div className="flex-1" />
        <span className="text-sm text-[var(--muted)]">
          Unbilled billable:{" "}
          <span className="tabular font-medium text-[var(--fg)]">
            {formatMoney(billableTotal, currency)}
          </span>
        </span>
      </div>

      {open && (
        <div className="card animate-rise mb-4 flex flex-wrap items-end gap-2 p-3">
          <label className="text-xs text-[var(--muted)]">
            Amount
            <input
              autoFocus
              className="input tabular mt-1 w-28"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
            />
          </label>
          <label className="text-xs text-[var(--muted)]">
            Date
            <input
              type="date"
              className="input mt-1 w-40"
              value={spentOn}
              onChange={(e) => setSpentOn(e.target.value)}
            />
          </label>
          <label className="text-xs text-[var(--muted)]">
            Project
            <select
              className="input mt-1 w-44"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--muted)]">
            Category
            <input
              className="input mt-1 w-36"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Travel, gear…"
            />
          </label>
          <label className="min-w-[160px] flex-1 text-xs text-[var(--muted)]">
            Notes
            <input
              className="input mt-1"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={billable}
              onChange={(e) => setBillable(e.target.checked)}
            />
            Billable
          </label>
          <button className="btn-primary" onClick={create} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button className="btn" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      )}

      {error && (
        <p className="mb-3 text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="card p-10 text-center text-sm text-[var(--muted)]">
          No expenses recorded.
        </div>
      ) : (
        <div className="card divide-y divide-[var(--border)] overflow-hidden">
          {rows.map((r) => (
            <div
              key={r.id}
              className="group flex items-center gap-3 px-3 py-2 transition-colors hover:bg-[var(--bg-subtle)]"
            >
              <span className="w-24 shrink-0 text-xs text-[var(--muted)]">
                {r.spentOn}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">
                  {r.category ?? r.notes ?? "Expense"}
                </div>
                <div className="flex gap-2 text-xs text-[var(--muted)]">
                  {r.projectName && <span>{r.projectName}</span>}
                  {r.category && r.notes && <span className="truncate">{r.notes}</span>}
                </div>
              </div>
              {!r.isBillable && (
                <span className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-xs text-[var(--muted)]">
                  Non-billable
                </span>
              )}
              {/* Once invoiced an expense is locked, so the same cost cannot
                  reach a client twice. */}
              {r.isInvoiced && (
                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs text-emerald-500">
                  Invoiced
                </span>
              )}
              <span className="tabular w-24 shrink-0 text-right text-sm">
                {formatMoney(r.amount, currency)}
              </span>
              {!r.isInvoiced && (
                <button
                  className="row-actions rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--danger)]"
                  onClick={async () => {
                    await deleteExpense(r.id);
                    refresh();
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
