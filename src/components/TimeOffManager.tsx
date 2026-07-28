"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  cancelTimeOffRequest,
  createTimeOffPolicy,
  createTimeOffRequest,
  reviewTimeOffRequest,
} from "@/app/actions";
import { dayKey } from "@/lib/format";

type Policy = { id: string; name: string; days_per_year: number; requires_approval: boolean };
type Req = {
  id: string;
  userId: string;
  name: string;
  policyId: string;
  startDate: string;
  endDate: string;
  hours: number;
  status: string;
  note: string | null;
  isMine: boolean;
};

const STATUS_CLASS: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-500",
  approved: "bg-emerald-500/15 text-emerald-500",
  rejected: "bg-red-500/15 text-red-400",
  cancelled: "bg-[var(--bg-subtle)] text-[var(--muted)] line-through",
};

export default function TimeOffManager({
  workspaceId,
  policies,
  requests,
  balances,
  isManager,
  currentUserId,
}: {
  workspaceId: string;
  policies: Policy[];
  requests: Req[];
  balances: Record<string, number>;
  isManager: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showNewPolicy, setShowNewPolicy] = useState(false);
  const [policyName, setPolicyName] = useState("");
  const [policyDays, setPolicyDays] = useState("20");
  const [requiresApproval, setRequiresApproval] = useState(true);

  const [selectedPolicyId, setPolicyId] = useState("");
  // `policies` arrives from a server refresh (e.g. creating the first
  // policy), not from user interaction, so a plain useState default goes
  // stale: it captures "no policies yet" and never updates when one
  // appears. Deriving the effective value at render time, per React's own
  // guidance, avoids both the stale state and an effect-triggered re-render.
  const policyId =
    selectedPolicyId && policies.some((p) => p.id === selectedPolicyId)
      ? selectedPolicyId
      : (policies[0]?.id ?? "");
  const [startDate, setStartDate] = useState(dayKey(new Date()));
  const [endDate, setEndDate] = useState(dayKey(new Date()));
  const [hours, setHours] = useState("8");
  const [note, setNote] = useState("");

  const refresh = () => startTransition(() => router.refresh());

  const mine = requests.filter((r) => r.isMine);
  const forReview = isManager ? requests.filter((r) => r.status === "pending" && !r.isMine) : [];

  async function submitRequest() {
    if (!policyId) return setError("Add a policy first.");
    const n = Number(hours);
    if (!Number.isFinite(n) || n <= 0) return setError("Hours must be greater than zero.");
    const res = await createTimeOffRequest({
      workspaceId,
      policyId,
      startDate,
      endDate,
      hours: n,
      note,
    });
    if (res.error) return setError(res.error);
    setError(null);
    setNote("");
    refresh();
  }

  return (
    <>
      {error && (
        <p className="mb-3 text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}

      {policies.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {policies.map((p) => (
            <div key={p.id} className="card px-3 py-2">
              <div className="text-xs text-[var(--muted)]">{p.name}</div>
              <div className="tabular text-lg font-semibold">
                {(balances[p.id] ?? p.days_per_year * 8).toFixed(0)}h
              </div>
              <div className="text-xs text-[var(--muted)]">
                of {p.days_per_year * 8}h this year
              </div>
            </div>
          ))}
        </div>
      )}

      {isManager && (
        <div className="mb-4">
          {showNewPolicy ? (
            <div className="card animate-rise flex flex-wrap items-end gap-2 p-3">
              <label className="text-xs text-[var(--muted)]">
                Policy name
                <input
                  className="input mt-1 w-40"
                  value={policyName}
                  onChange={(e) => setPolicyName(e.target.value)}
                  placeholder="PTO, Sick leave…"
                />
              </label>
              <label className="text-xs text-[var(--muted)]">
                Days / year
                <input
                  className="input tabular mt-1 w-24"
                  value={policyDays}
                  onChange={(e) => setPolicyDays(e.target.value)}
                />
              </label>
              <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm">
                <input
                  type="checkbox"
                  checked={requiresApproval}
                  onChange={(e) => setRequiresApproval(e.target.checked)}
                />
                Requires approval
              </label>
              <button
                className="btn-primary"
                onClick={async () => {
                  const res = await createTimeOffPolicy(
                    workspaceId,
                    policyName,
                    policyDays,
                    requiresApproval,
                  );
                  if (res.error) return setError(res.error);
                  setPolicyName("");
                  setShowNewPolicy(false);
                  setError(null);
                  refresh();
                }}
              >
                Create
              </button>
              <button className="btn" onClick={() => setShowNewPolicy(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="btn px-2 py-1 text-xs" onClick={() => setShowNewPolicy(true)}>
              New policy
            </button>
          )}
        </div>
      )}

      {policies.length === 0 ? (
        <div className="card mb-6 p-8 text-center text-sm text-[var(--muted)]">
          {isManager
            ? "No time-off policies yet. Create one above."
            : "No time-off policies configured for this workspace."}
        </div>
      ) : (
        <div className="card mb-6 flex flex-wrap items-end gap-2 p-3">
          <label className="text-xs text-[var(--muted)]">
            Policy
            <select
              className="input mt-1 min-w-[150px]"
              value={policyId}
              onChange={(e) => setPolicyId(e.target.value)}
            >
              {policies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--muted)]">
            Start
            <input
              type="date"
              className="input mt-1"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>
          <label className="text-xs text-[var(--muted)]">
            End
            <input
              type="date"
              className="input mt-1"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </label>
          <label className="text-xs text-[var(--muted)]">
            Hours
            <input
              className="input tabular mt-1 w-20"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
          </label>
          <label className="min-w-[160px] flex-1 text-xs text-[var(--muted)]">
            Note
            <input
              className="input mt-1"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button className="btn-primary" onClick={submitRequest}>
            Request
          </button>
        </div>
      )}

      {forReview.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold">Awaiting your review</h2>
          <div className="card divide-y divide-[var(--border)] overflow-hidden">
            {forReview.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                <span className="text-sm">{r.name}</span>
                <span className="tabular text-xs text-[var(--muted)]">
                  {r.startDate} – {r.endDate} ({r.hours}h)
                </span>
                {r.note && (
                  <span className="text-xs text-[var(--muted)]">— {r.note}</span>
                )}
                <div className="flex-1" />
                <button
                  className="rounded bg-emerald-600 px-2 py-1 text-xs text-white transition-colors hover:bg-emerald-500"
                  onClick={async () => {
                    await reviewTimeOffRequest(r.id, "approved");
                    refresh();
                  }}
                >
                  Approve
                </button>
                <button
                  className="rounded bg-[var(--danger)] px-2 py-1 text-xs text-white"
                  onClick={async () => {
                    await reviewTimeOffRequest(r.id, "rejected");
                    refresh();
                  }}
                >
                  Reject
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <h2 className="mb-2 text-sm font-semibold">
        {isManager ? "All requests" : "Your requests"}
      </h2>
      <div className="card divide-y divide-[var(--border)] overflow-hidden">
        {(isManager ? requests : mine).map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
            {isManager && <span className="text-sm">{r.name}</span>}
            <span className="tabular text-xs text-[var(--muted)]">
              {r.startDate} – {r.endDate} ({r.hours}h)
            </span>
            <span
              className={`rounded px-1.5 py-0.5 text-xs capitalize ${
                STATUS_CLASS[r.status] ?? ""
              }`}
            >
              {r.status}
            </span>
            <div className="flex-1" />
            {r.status === "pending" && r.userId === currentUserId && (
              <button
                className="rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--danger)]"
                onClick={async () => {
                  await cancelTimeOffRequest(r.id);
                  refresh();
                }}
              >
                Withdraw
              </button>
            )}
          </div>
        ))}
        {(isManager ? requests : mine).length === 0 && (
          <div className="px-3 py-8 text-center text-sm text-[var(--muted)]">
            No requests yet.
          </div>
        )}
      </div>
    </>
  );
}
