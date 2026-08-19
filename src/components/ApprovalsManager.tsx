"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Inbox } from "lucide-react";
import { EmptyScreen } from "@/components/Stat";
import { reviewTimesheet } from "@/app/actions";

type Row = {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  note: string | null;
  submittedAt: string;
  reviewNote: string | null;
};

const STATUS_CLASS: Record<string, string> = {
  submitted: "bg-amber-500/15 text-amber-500",
  approved: "bg-[var(--success)]/15 text-[var(--success)]",
  rejected: "bg-[var(--danger-100)] text-[var(--danger)]",
};

export default function ApprovalsManager({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = () => startTransition(() => router.refresh());
  const visible = filter === "pending" ? rows.filter((r) => r.status === "submitted") : rows;

  async function review(id: string, status: "approved" | "rejected") {
    const res = await reviewTimesheet(id, status, note);
    if (res.error) return setError(res.error);
    setReviewing(null);
    setNote("");
    setError(null);
    refresh();
  }

  return (
    <>
      <div className="mb-4 flex gap-1 border-b border-[var(--border)]">
        {(["pending", "all"] as const).map((f) => (
          <button
            key={f}
            className={`px-3 py-2 text-xs font-medium capitalize tracking-wide transition-colors ${
              filter === f
                ? "border-b-2 border-[var(--accent)] text-[var(--fg)]"
                : "text-[var(--muted)] hover:text-[var(--fg)]"
            }`}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      {error && (
        <p className="mb-3 text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}

      {visible.length === 0 ? (
        /* "Nothing waiting for review" is GOOD NEWS on a queue, and it read
           like a broken page: a one-line strip on an otherwise blank screen.
           An inbox at zero should look finished, not unfinished -- and when
           the queue is empty only because a filter is on, it should say which
           filter rather than implying nothing exists. */
        <EmptyScreen
          icon={filter === "pending" ? CheckCircle2 : Inbox}
          title={
            filter === "pending"
              ? "Nothing waiting for review"
              : rows.length > 0
                ? `Nothing ${filter}`
                : "No submissions yet"
          }
          hint={
            filter === "pending"
              ? "Every timesheet submitted so far has been dealt with. New submissions land here as soon as somebody sends a week for approval."
              : rows.length > 0
                ? `There are ${rows.length} submission${rows.length === 1 ? "" : "s"} in total — none of them are ${filter}.`
                : "When somebody submits a week of hours it arrives here for review, with the entries and totals attached."
          }
        />
      ) : (
        <div className="space-y-2">
          {visible.map((r) => (
            <div key={r.id} className="card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{r.name}</span>
                <span className="tabular text-xs text-[var(--muted)]">
                  {r.periodStart} – {r.periodEnd}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-xs capitalize ${
                    STATUS_CLASS[r.status] ?? ""
                  }`}
                >
                  {r.status}
                </span>
                <div className="flex-1" />
                {r.status === "submitted" && (
                  <>
                    {reviewing === r.id ? null : (
                      <button className="btn px-2 py-1 text-xs" onClick={() => setReviewing(r.id)}>
                        Review
                      </button>
                    )}
                  </>
                )}
              </div>

              {r.note && (
                <p className="mt-1 text-xs text-[var(--muted)]">Note: {r.note}</p>
              )}
              {r.reviewNote && (
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Reviewer note: {r.reviewNote}
                </p>
              )}

              {reviewing === r.id && (
                <div className="animate-rise mt-2 flex flex-wrap items-end gap-2 border-t border-[var(--border)] pt-2">
                  <input
                    className="input min-w-[220px] flex-1"
                    placeholder="Optional note to the member"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <button
                    className="rounded bg-[var(--success)] px-3 py-1.5 text-sm text-[var(--accent-fg)] transition-opacity hover:opacity-90"
                    onClick={() => void review(r.id, "approved")}
                  >
                    Approve
                  </button>
                  <button
                    className="rounded bg-[var(--danger)] px-3 py-1.5 text-sm text-[var(--accent-fg)]"
                    onClick={() => void review(r.id, "rejected")}
                  >
                    Reject
                  </button>
                  <button className="btn py-1.5" onClick={() => setReviewing(null)}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
