"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus, X } from "lucide-react";
import PlatformIcon from "@/components/PlatformIcon";
import { useToast } from "@/components/ui/Toast";
import {
  breakdownsFor,
  checkBreakdown,
  checkPeriod,
  fieldsFor,
  readEntry,
  type PeriodWarning,
} from "@/lib/periodFields";
import {
  confirmPeriod,
  loadPeriod,
  savePeriodDraft,
  saveBreakdown,
  unconfirmPeriod,
} from "@/app/actions";

/**
 * Typing a month's audience figures for one account.
 *
 * This is not a fallback for a missing importer. Instagram publishes no
 * account-level export and Meta has withheld one deliberately; OAuth is banned
 * here by schema constraint. So for the largest platform this form IS the data
 * path, permanently, and it is built to be used weekly rather than tolerated.
 *
 * Three things follow from that:
 *
 *   DRAFT FIRST. A period is a screenful of numbers read off another tab, and
 *   holding them in React state until one final commit loses an hour to a
 *   stray refresh. Saving is cheap and constant; confirming is the separate,
 *   deliberate act that lets a figure reach a client.
 *
 *   BLANK IS NOT ZERO. An empty box means "no source this cycle" and prints
 *   nothing; a typed 0 means zero and prints "0". The live report says "Bio
 *   link taps 0" because that zero is information the client asked for.
 *
 *   WARNINGS, NOT BLOCKS. Every check here fired on a real report already
 *   sent, and in each case the right response was a person looking at the
 *   source again -- not the software quietly reconciling the numbers, which
 *   would mean inventing one of them.
 */

type Account = { id: string; platform: string; handle: string; clientName: string | null };
type Row = { label: string; value: string };

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthRange(year: number, month1: number) {
  const last = new Date(Date.UTC(year, month1, 0)).getUTCDate();
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    start: `${year}-${p(month1)}-01`,
    end: `${year}-${p(month1)}-${p(last)}`,
    label: `${MONTHS[month1 - 1]} ${year}`,
  };
}

export default function PeriodSheet({
  workspaceId,
  accounts,
}: {
  workspaceId: string;
  accounts: Account[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();

  const now = new Date();
  // Defaults to the month just gone, which is what a report is written for.
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const [year, setYear] = useState(prev.getUTCFullYear());
  const [month, setMonth] = useState(prev.getUTCMonth() + 1);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");

  const [values, setValues] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Record<string, Row[]>>({});
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [status, setStatus] = useState<"draft" | "confirmed" | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  const account = accounts.find((a) => a.id === accountId);
  const range = monthRange(year, month);
  const fields = account ? fieldsFor(account.platform) : [];
  const specs = account ? breakdownsFor(account.platform) : [];

  /** Whatever is already stored for this account and month. */
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    setLoading(true);
    loadPeriod({ accountId, periodStart: range.start, periodEnd: range.end })
      .then((res) => {
        if (cancelled) return;
        const p = res.period as Record<string, unknown> | null;
        setPeriodId((p?.id as string) ?? null);
        setStatus((p?.status as "draft" | "confirmed") ?? null);
        const next: Record<string, string> = {};
        for (const f of fieldsFor(account?.platform ?? "")) {
          const v = p?.[f.key];
          // A stored null is an untouched box, not a zero.
          next[f.key] = typeof v === "number" ? String(v) : "";
        }
        setValues(next);
        const byKind: Record<string, Row[]> = {};
        for (const b of res.breakdowns) {
          (byKind[b.kind] ??= []).push({ label: b.label, value: b.value == null ? "" : String(b.value) });
        }
        setRows(byKind);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, range.start, range.end]);

  /** Parsed values, and any note about how a box was read ("11.4K" -> 11,400). */
  const parsed = useMemo(() => {
    const out: Record<string, number | null> = {};
    const notes: Record<string, string> = {};
    for (const f of fields) {
      const r = readEntry(values[f.key] ?? "");
      out[f.key] = r.value;
      if (r.note) notes[f.key] = r.note;
    }
    return { out, notes };
  }, [values, fields]);

  const warnings: PeriodWarning[] = useMemo(() => {
    if (!account) return [];
    const w = checkPeriod(account.platform, parsed.out);
    for (const s of specs) {
      const list = (rows[s.kind] ?? []).map((r) => ({
        label: r.label,
        value: readEntry(r.value).value,
      }));
      if (s.unit === "percent") {
        const b = checkBreakdown(s.label, list);
        if (b) w.push(b);
      }
    }
    return w;
  }, [account, parsed.out, rows, specs]);

  const filled = fields.filter((f) => parsed.out[f.key] != null).length;

  async function save(): Promise<string | null> {
    if (!account) return null;
    setBusy(true);
    const res = await savePeriodDraft({
      workspaceId,
      accountId,
      periodStart: range.start,
      periodEnd: range.end,
      values: parsed.out,
      // Everything typed here was read off a screen by a person, and the
      // report says so on the page. A later importer overwrites the entries it
      // can prove and leaves the rest marked manual.
      fieldSources: Object.fromEntries(
        fields
          .filter((f) => parsed.out[f.key] != null)
          .map((f) => [f.key, { source: "manual", at: new Date().toISOString() }]),
      ),
    });
    if (res.error) {
      setBusy(false);
      toast("danger", res.error);
      return null;
    }
    const id = res.id ?? periodId;
    if (id) {
      setPeriodId(id);
      for (const s of specs) {
        const list = (rows[s.kind] ?? [])
          .filter((r) => r.label.trim() !== "")
          .map((r) => ({ label: r.label, value: readEntry(r.value).value }));
        // Saved even when empty: clearing a list is how a bucket that dropped
        // out of the source leaves the report.
        //
        // CHECKED, because saveBreakdown deletes the existing rows before
        // inserting the new ones. Ignoring a failure here meant a save could
        // wipe a whole demographic block and report success, and the loss was
        // invisible until somebody opened the report and found the chart gone.
        const r = await saveBreakdown({
          workspaceId, periodId: id, kind: s.kind, unit: s.unit, rows: list,
        });
        if (r.error) {
          setBusy(false);
          toast("danger", r.error);
          return null;
        }
      }
    }
    setBusy(false);
    setStatus((st) => st ?? "draft");
    startTransition(() => router.refresh());
    return id ?? null;
  }

  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          className="input max-w-[280px] py-1.5 text-sm"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          aria-label="Account"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.clientName ?? "No client"} — {a.platform} @{a.handle}
            </option>
          ))}
        </select>

        <select
          className="input max-w-[130px] py-1.5 text-sm"
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          aria-label="Month"
        >
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <select
          className="input max-w-[100px] py-1.5 text-sm"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          aria-label="Year"
        >
          {[year - 1, year, year + 1].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>

        <span className="text-xs text-[var(--muted)]">
          {range.start} → {range.end}
        </span>

        {loading && <Loader2 size={13} className="animate-spin text-[var(--muted)]" />}

        <span className="ml-auto flex items-center gap-2">
          {status && (
            <span
              className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                status === "confirmed"
                  ? "bg-[var(--success-100)] text-[var(--success)]"
                  : "bg-[var(--bg-subtle)] text-[var(--muted)]"
              }`}
            >
              {status === "confirmed" ? "Confirmed" : "Draft"}
            </span>
          )}
          <span className="text-xs text-[var(--muted)]">
            {filled} of {fields.length} filled
          </span>
        </span>
      </div>

      {account && (
        <div className="mb-3 flex items-center gap-1.5 text-xs text-[var(--muted)]">
          <PlatformIcon platform={account.platform} size={12} />
          Copy these from {account.platform}&apos;s own dashboard. An empty box means &ldquo;no
          figure this cycle&rdquo; and prints nothing; a typed 0 means zero and prints 0.
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
        {fields.map((f) => (
          <label key={f.key} className="block">
            <span className="mb-1 block text-xs font-medium">{f.label}</span>
            <input
              className="input w-full py-1.5 text-sm"
              inputMode="numeric"
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              placeholder="—"
            />
            {parsed.notes[f.key] && (
              <span className="mt-0.5 block text-[11px] text-[var(--accent)]">
                {parsed.notes[f.key]}
              </span>
            )}
            {f.hint && !parsed.notes[f.key] && (
              <span className="mt-0.5 block text-[11px] leading-snug text-[var(--muted)]">
                {f.hint}
              </span>
            )}
          </label>
        ))}
      </div>

      {specs.length > 0 && (
        <div className="mt-5 space-y-4">
          {specs.map((s) => (
            <BreakdownEditor
              key={s.kind}
              label={s.label}
              unit={s.unit}
              hint={s.hint}
              suggest={s.suggest}
              rows={rows[s.kind] ?? []}
              onChange={(next) => setRows((r) => ({ ...r, [s.kind]: next }))}
            />
          ))}
        </div>
      )}

      {/* Never blocking. Each of these fired on a report that had already been
          sent, and the fix was always a person re-reading the source. */}
      {warnings.length > 0 && (
        <div className="mt-4 rounded-[var(--radius-sm)] border border-[var(--warn)]/40 bg-[var(--warn)]/5 p-3">
          <div className="mb-1.5 text-xs font-medium">Worth a second look</div>
          <ul className="space-y-1">
            {warnings.map((w, i) => (
              <li key={`${w.field}-${i}`} className="text-xs leading-snug text-[var(--muted)]">
                {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button className="btn px-2.5 py-1 text-xs" disabled={busy || !account} onClick={() => void save()}>
          {busy ? "Saving…" : "Save draft"}
        </button>

        {status === "confirmed" ? (
          <button
            className="btn px-2.5 py-1 text-xs"
            disabled={busy || !periodId}
            onClick={async () => {
              if (!periodId) return;
              setBusy(true);
              const res = await unconfirmPeriod({ workspaceId, periodId });
              setBusy(false);
              if (res.error) return toast("danger", res.error);
              setStatus("draft");
              toast("success", "Back to draft — it will stop appearing in reports.");
              startTransition(() => router.refresh());
            }}
          >
            Return to draft
          </button>
        ) : (
          <button
            className="btn-primary flex items-center gap-1.5 px-2.5 py-1 text-xs"
            disabled={busy || !account || filled === 0}
            title={
              filled === 0
                ? "Nothing entered yet"
                : "Confirming lets these figures appear in a client report"
            }
            onClick={async () => {
              const id = await save();
              if (!id) return;
              setBusy(true);
              const res = await confirmPeriod({ workspaceId, periodId: id });
              setBusy(false);
              if (res.error) return toast("danger", res.error);
              setStatus("confirmed");
              toast("success", `${range.label} confirmed — it can now appear in a report.`);
              startTransition(() => router.refresh());
            }}
          >
            <Check size={12} /> Save and confirm
          </button>
        )}

        <span className="text-xs text-[var(--muted)]">
          A draft is saved but stays out of client reports until it is confirmed.
        </span>
      </div>
    </div>
  );
}

/**
 * A ranked list of labelled values.
 *
 * Order is entered, not computed. Five TikTok search queries can all sit at
 * 0.2% and the order still carries the platform's judgement about which
 * mattered -- sorting by value would scramble information that cannot be
 * recovered.
 */
function BreakdownEditor({
  label,
  unit,
  hint,
  suggest,
  rows,
  onChange,
}: {
  label: string;
  unit: "percent" | "count";
  hint?: string;
  suggest?: string[];
  rows: Row[];
  onChange: (rows: Row[]) => void;
}) {
  const list = rows.length > 0 ? rows : (suggest ?? []).map((label) => ({ label, value: "" }));

  const set = (i: number, patch: Partial<Row>) =>
    onChange(list.map((r, j) => (i === j ? { ...r, ...patch } : r)));

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <span className="text-xs font-medium">{label}</span>
        <span className="text-[11px] text-[var(--muted)]">
          {unit === "percent" ? "percentages" : "counts"}
          {hint ? ` · ${hint}` : ""}
        </span>
      </div>
      <div className="space-y-1">
        {list.map((r, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              className="input min-w-0 flex-1 py-1 text-xs"
              value={r.label}
              placeholder="Label"
              onChange={(e) => set(i, { label: e.target.value })}
            />
            <input
              className="input w-[92px] py-1 text-xs"
              inputMode="decimal"
              value={r.value}
              placeholder={unit === "percent" ? "%" : "count"}
              onChange={(e) => set(i, { value: e.target.value })}
            />
            <button
              type="button"
              className="rounded p-1 text-[var(--muted)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--danger)]"
              onClick={() => onChange(list.filter((_, j) => j !== i))}
              aria-label={`Remove ${r.label || "row"}`}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="mt-1 flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-[var(--muted)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)]"
        onClick={() => onChange([...list, { label: "", value: "" }])}
      >
        <Plus size={11} /> Add row
      </button>
    </div>
  );
}
