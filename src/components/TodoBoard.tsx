"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Copy,
  ListChecks,
} from "lucide-react";
import { createTodo, deleteTodo, toggleTodoDone, updateTodo } from "@/app/actions";
import EmptyState from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { parseBrief, type ParsedTask } from "@/lib/todoParse";
import { one, type Todo } from "@/lib/types";

type Option = { userId: string; name: string };
type ClientOption = { id: string; name: string };

/** 2026-08-03 -> "MONDAY 3rd August 2026", the sheet's own header style. */
function sheetHeading(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const weekday = d.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" }).toUpperCase();
  const day = d.getUTCDate();
  const suffix =
    day % 10 === 1 && day !== 11 ? "st"
    : day % 10 === 2 && day !== 12 ? "nd"
    : day % 10 === 3 && day !== 13 ? "rd"
    : "th";
  const month = d.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  return `${weekday} ${day}${suffix} ${month} ${d.getUTCFullYear()}`;
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The day's sheet as clean text -- full client names, no shorthand. This is
 * the message the team used to write by hand; now the structured sheet is
 * the source and the text is generated from it.
 */
function sheetAsText(date: string, todos: Todo[]): string {
  const byPerson = new Map<string, Todo[]>();
  for (const t of todos) {
    const name = one(t.profile)?.full_name ?? "Unassigned";
    if (!byPerson.has(name)) byPerson.set(name, []);
    byPerson.get(name)!.push(t);
  }
  const blocks = [...byPerson.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, items]) => {
      const lines = items.map((t, i) => {
        const client = one(t.client)?.name;
        return `${i + 1}. ${client ? `${client} — ` : ""}${t.description}${t.is_done ? " ✔" : ""}`;
      });
      return `${name}\n${lines.join("\n")}`;
    });
  return `${sheetHeading(date)} — Daily assignments\n\n${blocks.join("\n\n")}\n`;
}

export default function TodoBoard({
  workspaceId,
  todos,
  members,
  clients,
  manages,
  selfId,
  date,
  today,
}: {
  workspaceId: string;
  todos: Todo[];
  members: Option[];
  clients: ClientOption[];
  manages: boolean;
  selfId: string;
  date: string;
  today: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ userId: "", clientId: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [showText, setShowText] = useState(false);
  const [copied, setCopied] = useState(false);
  const descRef = useRef<HTMLInputElement>(null);

  const refresh = () => startTransition(() => router.refresh());

  function goTo(nextDate: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextDate === today) params.delete("date");
    else params.set("date", nextDate);
    const qs = params.toString();
    router.push(qs ? `/todos?${qs}` : "/todos");
  }

  async function add() {
    if (!draft.userId) return setError("Pick who this is for.");
    if (!draft.description.trim()) return setError("Write the task.");
    setBusy(true);
    const res = await createTodo({
      workspaceId,
      userId: draft.userId,
      clientId: draft.clientId || null,
      assignedOn: date,
      description: draft.description,
    });
    setBusy(false);
    if (res.error) return setError(res.error);
    setError(null);
    // Person and client stay put -- a manager enters several tasks for the
    // same person in a row, exactly like the old handwritten sheet.
    setDraft((d) => ({ ...d, description: "" }));
    descRef.current?.focus();
    refresh();
  }

  const grouped = useMemo(() => {
    const byPerson = new Map<string, { name: string; items: Todo[] }>();
    for (const t of todos) {
      const name = one(t.profile)?.full_name ?? "Unknown";
      if (!byPerson.has(t.user_id)) byPerson.set(t.user_id, { name, items: [] });
      byPerson.get(t.user_id)!.items.push(t);
    }
    return [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [todos]);

  const doneCount = todos.filter((t) => t.is_done).length;
  const text = useMemo(() => sheetAsText(date, todos), [date, todos]);

  async function copyText() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      {/* Day navigation: assignments are managed date-wise, one sheet per day. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button className="btn px-2.5" onClick={() => goTo(shiftDate(date, -1))} aria-label="Previous day">
          <ChevronLeft size={15} />
        </button>
        <input
          type="date"
          className="input max-w-[170px] py-1.5"
          value={date}
          onChange={(e) => e.target.value && goTo(e.target.value)}
          aria-label="Sheet date"
        />
        <button className="btn px-2.5" onClick={() => goTo(shiftDate(date, 1))} aria-label="Next day">
          <ChevronRight size={15} />
        </button>
        {date !== today && (
          <button className="btn py-1.5 text-xs" onClick={() => goTo(today)}>
            Today
          </button>
        )}
        <div className="flex-1" />
        <span className="text-sm font-semibold">{sheetHeading(date)}</span>
        {todos.length > 0 && (
          <span className="tabular text-xs text-[var(--muted)]">
            {doneCount}/{todos.length} done
          </span>
        )}
      </div>

      {/* Manager entry row -- select, select, type, Enter, repeat. */}
      {manages && (
        <div className="card mb-4 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="input max-w-[180px] py-1.5"
              value={draft.userId}
              onChange={(e) => setDraft({ ...draft, userId: e.target.value })}
              aria-label="Assign to"
            >
              <option value="">Assign to…</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
            <select
              className="input max-w-[200px] py-1.5"
              value={draft.clientId}
              onChange={(e) => setDraft({ ...draft, clientId: e.target.value })}
              aria-label="Client"
            >
              <option value="">No client (general)</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              ref={descRef}
              className="input min-w-[220px] flex-1 py-1.5"
              placeholder="Task — e.g. Revision on the Mykonos vlog"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") void add();
              }}
            />
            <button className="btn-primary py-1.5" onClick={() => void add()} disabled={busy}>
              Add
            </button>
          </div>
          {error && (
            <p className="mt-2 text-sm text-[var(--danger)]" role="alert">
              {error}
            </p>
          )}
        </div>
      )}

      {/* Paste-in import: the reverse direction. The old shorthand sheet can
          be pasted whole; it is parsed against the real member and client
          lists and lands as a reviewable proposal, never a silent write. */}
      {manages && (
        <BriefImport
          workspaceId={workspaceId}
          members={members}
          clients={clients}
          boardDate={date}
          onImported={(target) => {
            if (target !== date) goTo(target);
            else refresh();
          }}
        />
      )}

      {/* The generated daily message -- the system writes the text now. */}
      {manages && todos.length > 0 && (
        <div className="mb-4 flex items-center gap-2">
          <button className="btn py-1.5 text-xs" onClick={() => setShowText((v) => !v)}>
            {showText ? "Hide text" : "View as text"}
          </button>
          <button className="btn py-1.5 text-xs" onClick={() => void copyText()}>
            {copied ? <ClipboardCheck size={13} /> : <Copy size={13} />}
            {copied ? "Copied" : "Copy text"}
          </button>
          <span className="text-xs text-[var(--muted)]">
            Full names, no shorthand — ready to paste anywhere. Filters apply.
          </span>
        </div>
      )}
      {manages && showText && (
        <pre className="card animate-rise mb-4 overflow-x-auto whitespace-pre-wrap p-4 text-sm leading-relaxed">
          {text}
        </pre>
      )}

      {todos.length === 0 ? (
        <EmptyState
          icon={<ListChecks size={20} />}
          message={
            manages
              ? "Nothing on this day's sheet yet. Add the first assignment above."
              : "Nothing assigned to you for this day."
          }
        />
      ) : (
        <div className="space-y-4">
          {grouped.map((g) => {
            const done = g.items.filter((t) => t.is_done).length;
            return (
              <section key={g.name}>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <h2 className="text-sm font-semibold">{g.name}</h2>
                  <span className="tabular text-xs text-[var(--muted)]">
                    {done}/{g.items.length} done
                  </span>
                </div>
                <div className="card divide-y divide-[var(--border)] overflow-hidden">
                  {g.items.map((t) => (
                    <TodoRow
                      key={t.id}
                      todo={t}
                      canToggle={manages || t.user_id === selfId}
                      canEdit={manages}
                      clients={clients}
                      onChanged={refresh}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

/**
 * Aliases the team uses that cannot be derived from the client names
 * themselves (EEH is the Hamburg brand of the client named "EuroEyes
 * Deutschland"). Everything derivable -- full names, first words,
 * initials like TJB, parenthesised codes like LEC -- comes from the client
 * list automatically in todoParse.
 */
const ALIAS_EXTRAS: Record<string, string> = {
  EEH: "EuroEyes Deutschland",
};

function BriefImport({
  workspaceId,
  members,
  clients,
  boardDate,
  onImported,
}: {
  workspaceId: string;
  members: Option[];
  clients: ClientOption[];
  boardDate: string;
  onImported: (targetDate: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ParsedTask[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [targetDate, setTargetDate] = useState(boardDate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function runParse() {
    const res = parseBrief(text, { members, clients, aliasExtras: ALIAS_EXTRAS });
    setRows(res.tasks);
    setWarnings(res.warnings);
    setTargetDate(res.date ?? boardDate);
    setError(null);
  }

  function patchRow(i: number, patch: Partial<ParsedTask>) {
    setRows((prev) => prev!.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  async function commit() {
    if (!rows) return;
    const ready = rows.filter((r) => r.userId && r.description.trim());
    if (ready.length === 0) return setError("Nothing to add — every row needs a person.");
    setBusy(true);
    for (const r of ready) {
      const res = await createTodo({
        workspaceId,
        userId: r.userId!,
        clientId: r.clientId,
        assignedOn: targetDate,
        description: r.tentative ? `${r.description} (to be confirmed)` : r.description,
      });
      if (res.error) {
        setBusy(false);
        return setError(res.error);
      }
    }
    setBusy(false);
    setOpen(false);
    setText("");
    setRows(null);
    onImported(targetDate);
  }

  if (!open) {
    return (
      <div className="mb-4">
        <button className="btn py-1.5 text-xs" onClick={() => setOpen(true)}>
          Import from text
        </button>
        <span className="ml-2 text-xs text-[var(--muted)]">
          Paste the old-style daily message — shorthand understood, reviewed before anything is created.
        </span>
      </div>
    );
  }

  return (
    <div className="card animate-rise mb-4 space-y-3 p-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Import a daily brief</h2>
        <button
          className="btn-ghost py-1 text-xs"
          onClick={() => {
            setOpen(false);
            setRows(null);
          }}
        >
          Close
        </button>
      </div>

      {!rows ? (
        <>
          <textarea
            className="input min-h-[160px] font-mono text-xs"
            placeholder={"MONDAY 3rd August\n\nScheyr\nAmeerh revs x2\nEEH: Misconception on Laser Correction\n…"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button className="btn-primary py-1.5" onClick={runParse} disabled={!text.trim()}>
            Parse
          </button>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-[var(--muted)]">Assign everything to</span>
            <input
              type="date"
              className="input max-w-[170px] py-1"
              value={targetDate}
              onChange={(e) => e.target.value && setTargetDate(e.target.value)}
              aria-label="Target date"
            />
            <span className="tabular text-xs text-[var(--muted)]">
              {rows.length} task{rows.length === 1 ? "" : "s"} recognised
            </span>
          </div>

          {warnings.length > 0 && (
            <ul className="space-y-0.5 text-xs text-[var(--warning)]">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}

          <div className="space-y-1.5">
            {rows.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-1.5" title={r.raw}>
                <select
                  className="input max-w-[150px] py-1 text-xs"
                  value={r.userId ?? ""}
                  onChange={(e) => {
                    const m = members.find((x) => x.userId === e.target.value);
                    patchRow(i, { userId: m?.userId ?? null, personName: m?.name ?? null });
                  }}
                  aria-label="Person"
                  style={{ borderColor: r.userId ? undefined : "var(--danger)" }}
                >
                  <option value="">Person…</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <select
                  className="input max-w-[170px] py-1 text-xs"
                  value={r.clientId ?? ""}
                  onChange={(e) => {
                    const c = clients.find((x) => x.id === e.target.value);
                    patchRow(i, { clientId: c?.id ?? null, clientName: c?.name ?? null });
                  }}
                  aria-label="Client"
                  style={{ borderColor: r.clientId ? undefined : "var(--warning)" }}
                >
                  <option value="">No client</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <input
                  className="input min-w-[180px] flex-1 py-1 text-xs"
                  value={r.description}
                  onChange={(e) => patchRow(i, { description: e.target.value })}
                  aria-label="Task"
                />
                {r.tentative && (
                  <span className="pill pill-warning" title="Marked with ? in the brief">
                    tentative
                  </span>
                )}
                <button
                  className="btn-ghost px-1.5 py-1 text-xs"
                  onClick={() => setRows((prev) => prev!.filter((_, j) => j !== i))}
                  aria-label="Remove row"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          {error && (
            <p className="text-sm text-[var(--danger)]" role="alert">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button className="btn-primary py-1.5" onClick={() => void commit()} disabled={busy}>
              {busy ? "Adding…" : `Add ${rows.filter((r) => r.userId).length} tasks`}
            </button>
            <button className="btn py-1.5" onClick={() => setRows(null)}>
              Back to text
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function TodoRow({
  todo,
  canToggle,
  canEdit,
  clients,
  onChanged,
}: {
  todo: Todo;
  canToggle: boolean;
  canEdit: boolean;
  clients: ClientOption[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(todo.description);
  const toast = useToast();
  const client = one(todo.client);

  async function save() {
    if (!text.trim()) return;
    const res = await updateTodo(todo.id, { description: text });
    if (res.error) toast("danger", res.error);
    setEditing(false);
    onChanged();
  }

  return (
    <div className="group flex items-center gap-3 px-3 py-2.5">
      <button
        className="grid size-5 shrink-0 place-items-center rounded-md border transition-colors"
        style={{
          borderColor: todo.is_done ? "var(--success)" : "var(--border-strong)",
          background: todo.is_done ? "var(--success)" : "transparent",
          color: "var(--accent-fg)",
          cursor: canToggle ? "pointer" : "default",
          opacity: canToggle ? 1 : 0.5,
        }}
        disabled={!canToggle}
        onClick={async () => {
          const res = await toggleTodoDone(todo.id, !todo.is_done);
          if (res.error) toast("danger", res.error);
          onChanged();
        }}
        aria-label={todo.is_done ? "Mark as not done" : "Mark as done"}
      >
        {todo.is_done && <Check size={13} strokeWidth={3} />}
      </button>

      {editing ? (
        <input
          className="input flex-1 py-1"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") {
              setText(todo.description);
              setEditing(false);
            }
          }}
          autoFocus
        />
      ) : (
        <div className="min-w-0 flex-1">
          <span className={`text-sm ${todo.is_done ? "text-[var(--muted)] line-through" : ""}`}>
            {todo.description}
          </span>
        </div>
      )}

      {client && (
        <span className="pill pill-neutral shrink-0" title="Client">
          {client.name}
        </span>
      )}

      {canEdit && !editing && (
        <div className="row-actions flex shrink-0 gap-1">
          <button className="btn px-2 py-1 text-xs" onClick={() => setEditing(true)}>
            Edit
          </button>
          <select
            className="input max-w-[130px] py-1 text-xs"
            value={client?.id ?? ""}
            onChange={async (e) => {
              const res = await updateTodo(todo.id, { clientId: e.target.value || null });
              if (res.error) toast("danger", res.error);
              onChanged();
            }}
            aria-label="Change client"
          >
            <option value="">No client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            className="rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--danger)]"
            onClick={async () => {
              const res = await deleteTodo(todo.id);
              if (res.error) toast("danger", res.error);
              onChanged();
            }}
          >
            Remove
          </button>
        </div>
      )}
      {editing && (
        <button className="btn-primary px-2 py-1 text-xs" onClick={() => void save()}>
          Save
        </button>
      )}
    </div>
  );
}
