"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateMemberRates,
  updateProjectBilling,
  updateWorkspaceBilling,
} from "@/app/actions";

type Member = { id: string; name: string; billable: number | null; cost: number | null };
type Project = {
  id: string;
  name: string;
  billable_rate: number | null;
  budget_amount: number | null;
  budget_hours: number | null;
};

const str = (n: number | null) => (n == null ? "" : String(n));

export default function RatesManager({
  workspaceId,
  defaultRate,
  currency,
  members,
  projects,
}: {
  workspaceId: string;
  defaultRate: number | null;
  currency: string;
  members: Member[];
  projects: Project[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [rate, setRate] = useState(str(defaultRate));
  const [cur, setCur] = useState(currency);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const flash = (msg: string) => {
    setSaved(msg);
    setTimeout(() => setSaved(null), 1800);
  };
  const refresh = () => startTransition(() => router.refresh());

  return (
    <>
      {error && (
        <p className="mb-3 text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="animate-rise mb-3 text-sm text-[var(--success)]" role="status">
          {saved}
        </p>
      )}

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold">Workspace default</h2>
        <div className="card flex flex-wrap items-end gap-2 p-3">
          <label className="text-xs text-[var(--muted)]">
            Default billable rate / hour
            <input
              className="input tabular mt-1 w-32"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="—"
              inputMode="decimal"
            />
          </label>
          <label className="text-xs text-[var(--muted)]">
            Currency
            <input
              className="input mt-1 w-24 uppercase"
              value={cur}
              onChange={(e) => setCur(e.target.value)}
              maxLength={3}
            />
          </label>
          <button
            className="btn-primary"
            onClick={async () => {
              const res = await updateWorkspaceBilling(workspaceId, rate, cur);
              if (res.error) return setError(res.error);
              setError(null);
              flash("Workspace rate saved.");
              refresh();
            }}
          >
            Save
          </button>
          <p className="w-full text-xs text-[var(--muted)]">
            Leave blank for no default. A rate of 0 is treated as genuinely
            zero-rated work, not as unset.
          </p>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold">Members</h2>
        <div className="card overflow-hidden">
          <div className="flex gap-3 border-b border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
            <span className="flex-1">Name</span>
            <span className="w-28 text-right">Billable / h</span>
            <span className="w-28 text-right">Cost / h</span>
            <span className="w-16" />
          </div>
          {members.map((m) => (
            <MemberRow key={m.id} member={m} onSaved={flash} onError={setError} refresh={refresh} />
          ))}
        </div>
        {/* Cost rate drives margin reporting and is close to salary data --
            this page is manager-only for that reason. */}
        <p className="mt-1.5 text-xs text-[var(--muted)]">
          Cost rate is what the person costs the business. It never appears
          outside manager views.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Projects</h2>
        {projects.length === 0 ? (
          <div className="empty">
            No active projects.
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="flex gap-3 border-b border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
              <span className="flex-1">Project</span>
              <span className="w-24 text-right">Rate / h</span>
              <span className="w-28 text-right">Budget</span>
              <span className="w-24 text-right">Budget h</span>
              <span className="w-16" />
            </div>
            {projects.map((p) => (
              <ProjectRow
                key={p.id}
                project={p}
                onSaved={flash}
                onError={setError}
                refresh={refresh}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function MemberRow({
  member,
  onSaved,
  onError,
  refresh,
}: {
  member: Member;
  onSaved: (m: string) => void;
  onError: (m: string) => void;
  refresh: () => void;
}) {
  const [billable, setBillable] = useState(str(member.billable));
  const [cost, setCost] = useState(str(member.cost));
  const dirty = billable !== str(member.billable) || cost !== str(member.cost);

  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <span className="flex-1 truncate text-sm">{member.name}</span>
      <input
        className="input tabular w-28 py-1 text-right"
        value={billable}
        onChange={(e) => setBillable(e.target.value)}
        placeholder="—"
        inputMode="decimal"
        aria-label={`Billable rate for ${member.name}`}
      />
      <input
        className="input tabular w-28 py-1 text-right"
        value={cost}
        onChange={(e) => setCost(e.target.value)}
        placeholder="—"
        inputMode="decimal"
        aria-label={`Cost rate for ${member.name}`}
      />
      <button
        className="btn w-16 px-2 py-1 text-xs disabled:opacity-30"
        disabled={!dirty}
        onClick={async () => {
          const res = await updateMemberRates(member.id, billable, cost);
          if (res.error) return onError(res.error);
          onSaved(`${member.name} updated.`);
          refresh();
        }}
      >
        Save
      </button>
    </div>
  );
}

function ProjectRow({
  project,
  onSaved,
  onError,
  refresh,
}: {
  project: Project;
  onSaved: (m: string) => void;
  onError: (m: string) => void;
  refresh: () => void;
}) {
  const [rate, setRate] = useState(str(project.billable_rate));
  const [amount, setAmount] = useState(str(project.budget_amount));
  const [hours, setHours] = useState(str(project.budget_hours));
  const dirty =
    rate !== str(project.billable_rate) ||
    amount !== str(project.budget_amount) ||
    hours !== str(project.budget_hours);

  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <span className="flex-1 truncate text-sm">{project.name}</span>
      <input
        className="input tabular w-24 py-1 text-right"
        value={rate}
        onChange={(e) => setRate(e.target.value)}
        placeholder="—"
        inputMode="decimal"
        aria-label={`Rate for ${project.name}`}
      />
      <input
        className="input tabular w-28 py-1 text-right"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="—"
        inputMode="decimal"
        aria-label={`Budget for ${project.name}`}
      />
      <input
        className="input tabular w-24 py-1 text-right"
        value={hours}
        onChange={(e) => setHours(e.target.value)}
        placeholder="—"
        inputMode="decimal"
        aria-label={`Budget hours for ${project.name}`}
      />
      <button
        className="btn w-16 px-2 py-1 text-xs disabled:opacity-30"
        disabled={!dirty}
        onClick={async () => {
          const res = await updateProjectBilling(project.id, {
            billable_rate: rate,
            budget_amount: amount,
            budget_hours: hours,
          });
          if (res.error) return onError(res.error);
          onSaved(`${project.name} updated.`);
          refresh();
        }}
      >
        Save
      </button>
    </div>
  );
}
