/**
 * One audit entry's payload, written for a person.
 *
 * It used to be `JSON.stringify(detail)` in a <pre>. For a rate change that
 * was tolerable; for a bulk approval it was a wall of UUIDs wider than the
 * card, scrolling sideways, telling the reader nothing at all:
 *
 *   {"ids":["83198846-c2f9-449e-8dd4-9e38e2fe2672","13ab9e03-a795-…
 *
 * Nobody can audit that. The question an audit log answers is "who did what
 * to which thing", and the identifiers were the only part of the answer
 * present.
 *
 * THE RAW PAYLOAD IS STILL REACHABLE, and that is not optional. This is an
 * append-only record people are expected to be able to check, so a prettier
 * summary must never become the only version -- the exact stored JSON stays
 * one click away in a <details>. Summarising is a reading aid; replacing
 * would be destroying evidence.
 */

/** ids resolved to something human, supplied by the page. */
export type LabelLookup = Map<string, string>;

const HUMAN_KEY: Record<string, string> = {
  default_rate: "default rate",
  hookType: "hook type",
  declinedReason: "reason",
  prefix: "key prefix",
};

function labelFor(key: string): string {
  return HUMAN_KEY[key] ?? key.replace(/_/g, " ");
}

function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string");
}

/** content_items -> "video". The row already says which table it touched. */
const NOUN: Record<string, string> = {
  content_items: "video",
  clients: "client",
  platform_posts: "post",
  invoices: "invoice",
  workspaces: "workspace",
};

export default function AuditDetail({
  detail,
  labels,
  entityType,
}: {
  detail: Record<string, unknown>;
  labels: LabelLookup;
  /** Names the id list after the thing it points at, not "items". */
  entityType?: string | null;
}) {
  const entries = Object.entries(detail ?? {});
  if (entries.length === 0) return null;

  /* An id list carries its own count in this schema (content.approved writes
     both), so printing the count as a separate row would say the same thing
     twice -- the same duplication that got a "Posts" column deleted. The
     count is folded into the list's own heading instead. */
  const idKeys = new Set(entries.filter(([, v]) => isIdList(v)).map(([k]) => k));
  const scalars = entries.filter(
    ([k, v]) => !idKeys.has(k) && !(k === "count" && idKeys.size > 0) && v != null && v !== "",
  );

  return (
    <div className="mt-1.5 space-y-1.5">
      {scalars.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {scalars.map(([k, v]) => (
            <span key={k} className="text-[var(--muted)]">
              {labelFor(k)}{" "}
              <span className="font-medium text-[var(--fg)]">
                {typeof v === "number" ? v.toLocaleString() : String(v)}
              </span>
            </span>
          ))}
        </div>
      )}

      {entries.filter(([, v]) => isIdList(v)).map(([k, v]) => {
        const ids = v as string[];
        /* Named where we can, counted where we cannot. A row deleted since
           the entry was written has no title left to look up -- and an audit
           log must still describe what happened to it, so the id survives as
           the fallback rather than the row vanishing. */
        const named = ids.map((id) => ({ id, label: labels.get(id) ?? null }));
        const unresolved = named.filter((n) => !n.label).length;
        return (
          <div key={k} className="text-xs">
            <span className="text-[var(--muted)]">
              {ids.length}{" "}
              {labelFor(k) === "ids"
                ? (entityType && NOUN[entityType]) || "item"
                : labelFor(k)}
              {ids.length === 1 ? "" : "s"}
              {unresolved > 0 && ids.length > unresolved
                ? ` · ${unresolved} since deleted`
                : ""}
            </span>
            <ul className="mt-0.5 space-y-0.5">
              {named.slice(0, 6).map((n) => (
                <li key={n.id} className="truncate text-[var(--fg)]">
                  {n.label ?? (
                    <span className="font-mono text-[var(--muted)]">
                      {n.id.slice(0, 8)}… <span className="not-italic">(deleted)</span>
                    </span>
                  )}
                </li>
              ))}
              {named.length > 6 && (
                <li className="text-[var(--muted)]">
                  and {named.length - 6} more
                </li>
              )}
            </ul>
          </div>
        );
      })}

      <details className="text-xs">
        <summary className="cursor-pointer text-[var(--muted)] hover:text-[var(--fg)]">
          Raw
        </summary>
        <pre className="mt-1 overflow-x-auto rounded bg-[var(--bg-subtle)] px-2 py-1 text-[var(--muted)]">
          {JSON.stringify(detail, null, 2)}
        </pre>
      </details>
    </div>
  );
}
