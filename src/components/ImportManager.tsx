"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  bulkApproveHighConfidence,
  checkClockifyConnection,
  commitImportBatch,
  discardImportBatch,
  mapImportMember,
  resolveImportRow,
  startClockifyImport,
} from "@/app/actions";
import Select from "@/components/ui/Select";
import { formatDurationShort } from "@/lib/format";

type Batch = {
  id: string;
  source: string;
  status: string;
  created_at: string;
  row_count: number;
  committed_at: string | null;
};
type Row = {
  id: string;
  description: string;
  project_name: string | null;
  task_name: string | null;
  member_name: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  suggested_content_item_id: string | null;
  match_confidence: number | null;
  resolved_content_item_id: string | null;
  status: string;
};
type MemberMapRow = {
  id: string;
  clockify_name: string;
  clockify_email: string | null;
  resolved_user_id: string | null;
};

const CONFIDENCE_THRESHOLD = 0.5;

export default function ImportManager({
  workspaceId,
  batches,
  activeBatchId,
  activeBatch,
  rows,
  memberMap,
  members,
  contentItems,
}: {
  workspaceId: string;
  batches: Batch[];
  activeBatchId: string | null;
  activeBatch: { id: string; status: string } | null;
  rows: Row[];
  memberMap: MemberMapRow[];
  members: { userId: string; name: string }[];
  contentItems: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = () => startTransition(() => router.refresh());
  const goToBatch = (id: string) => router.push(`/import?batch=${id}`);

  const contentById = new Map(contentItems.map((c) => [c.id, c.title]));
  const unmappedCount = memberMap.filter((m) => !m.resolved_user_id).length;
  const pendingCount = rows.filter((r) => r.status === "pending").length;
  const approvedCount = rows.filter((r) => r.status === "approved").length;

  return (
    <>
      {error && (
        <p className="mb-3 text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="animate-rise mb-3 text-sm text-[var(--success)]" role="status">
          {notice}
        </p>
      )}

      {!activeBatchId && (
        <StartImport
          workspaceId={workspaceId}
          onError={setError}
          onStarted={(batchId) => goToBatch(batchId)}
        />
      )}

      {!activeBatchId && batches.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">Past imports</h2>
          <div className="card divide-y divide-[var(--border)] overflow-hidden">
            {batches.map((b) => (
              <button
                key={b.id}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors hover:bg-[var(--bg-subtle)]"
                onClick={() => goToBatch(b.id)}
              >
                <span className="capitalize">{b.source}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-xs ${
                    b.status === "committed"
                      ? "bg-[var(--success)]/15 text-[var(--success)]"
                      : "bg-[var(--bg-subtle)] text-[var(--muted)]"
                  }`}
                >
                  {b.status}
                </span>
                <span className="text-xs text-[var(--muted)]">{b.row_count} rows</span>
                <div className="flex-1" />
                <span className="text-xs text-[var(--muted)]">
                  {new Date(b.created_at).toLocaleDateString()}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {activeBatchId && activeBatch && (
        <>
          <button
            className="mb-4 text-sm text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
            onClick={() => router.push("/import")}
          >
            ← All imports
          </button>

          {activeBatch.status === "committed" ? (
            <div className="card mb-6 p-4 text-sm">
              <p className="font-medium text-[var(--success)]">This batch has been committed.</p>
              <p className="mt-1 text-[var(--muted)]">
                Its rows are now real time entries. Approved rows carry a
                content link; skipped rows do not.
              </p>
            </div>
          ) : (
            <>
              <section className="mb-6">
                <h2 className="mb-2 text-sm font-semibold">
                  Map Clockify members to people here
                </h2>
                <p className="mb-2 text-xs text-[var(--muted)]">
                  Every member must be mapped before this batch can commit --
                  an unmapped member&apos;s hours are refused, never silently
                  dropped or attributed to the wrong person.
                </p>
                <div className="card divide-y divide-[var(--border)] overflow-hidden">
                  {memberMap.map((m) => (
                    <div key={m.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className="flex-1">
                        {m.clockify_name}
                        {m.clockify_email && (
                          <span className="ml-1 text-xs text-[var(--muted)]">
                            {m.clockify_email}
                          </span>
                        )}
                      </span>
                      {/* The old empty <option> was `disabled`: unmapping is
                          not a real state, a row must resolve to somebody.
                          The clear row used to render anyway and get ignored
                          on click, which is the same dead row the Team admin
                          role picker had. Now it is simply not offered. */}
                      <Select
                        className="max-w-[180px]"
                        clearable={false}
                        value={m.resolved_user_id ?? ""}
                        onChange={async (v) => {
                          if (!v) return;
                          const res = await mapImportMember(
                            activeBatch.id,
                            m.clockify_name,
                            v,
                          );
                          if (res.error) return setError(res.error);
                          refresh();
                        }}
                        placeholder="Choose a person…"
                        ariaLabel={`Map ${m.clockify_name}`}
                        options={members.map((mem) => ({ value: mem.userId, label: mem.name }))}
                      />
                    </div>
                  ))}
                </div>
              </section>

              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="text-sm text-[var(--muted)]">
                  {rows.length} rows — {pendingCount} pending, {approvedCount} approved
                </span>
                <div className="flex-1" />
                <button
                  className="btn px-2 py-1 text-xs"
                  onClick={async () => {
                    const res = await bulkApproveHighConfidence(
                      activeBatch.id,
                      CONFIDENCE_THRESHOLD,
                    );
                    if (res.error) return setError(res.error);
                    setNotice(`Approved ${res.count ?? 0} high-confidence matches.`);
                    refresh();
                  }}
                >
                  Approve all matches ≥ {Math.round(CONFIDENCE_THRESHOLD * 100)}%
                </button>
                <button
                  className="rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--danger)]"
                  onClick={async () => {
                    if (!confirm("Discard this entire batch? Nothing has been committed yet.")) return;
                    /* The push happened unconditionally, so a refused discard
                       left the batch alive with the user already on another
                       page -- and the next visit shows it still sitting
                       there with no explanation. Navigate only on success. */
                    const res = await discardImportBatch(activeBatch.id);
                    if (res?.error) return setError(res.error);
                    setError(null);
                    router.push("/import");
                  }}
                >
                  Discard batch
                </button>
                <button
                  className="btn-primary"
                  disabled={unmappedCount > 0}
                  title={unmappedCount > 0 ? `${unmappedCount} member(s) still unmapped` : undefined}
                  onClick={async () => {
                    const res = await commitImportBatch(activeBatch.id);
                    if (res.error) return setError(res.error);
                    setError(null);
                    setNotice(`Committed ${res.inserted ?? 0} time entries.`);
                    refresh();
                  }}
                >
                  Commit {approvedCount + rows.filter((r) => r.status === "skipped").length} rows
                </button>
              </div>

              <div className="card divide-y divide-[var(--border)] overflow-hidden">
                {rows.map((r) => (
                  <ImportRowView
                    key={r.id}
                    row={r}
                    contentItems={contentItems}
                    contentTitle={
                      r.resolved_content_item_id
                        ? contentById.get(r.resolved_content_item_id)
                        : r.suggested_content_item_id
                          ? contentById.get(r.suggested_content_item_id)
                          : undefined
                    }
                    onError={setError}
                    refresh={refresh}
                  />
                ))}
                {rows.length === 0 && (
                  <div className="px-3 py-8 text-center text-sm text-[var(--muted)]">
                    No rows in this batch.
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

function StartImport({
  workspaceId,
  onError,
  onStarted,
}: {
  workspaceId: string;
  onError: (m: string | null) => void;
  onStarted: (batchId: string) => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[] | null>(null);
  const [clockifyWorkspaceId, setClockifyWorkspaceId] = useState("");
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);

  return (
    <div className="card p-4">
      <h2 className="mb-1 text-sm font-semibold">Import from Clockify</h2>
      <p className="mb-3 text-xs text-[var(--muted)]">
        From Clockify: Profile Settings → API. The key is used for this
        import only and is not stored.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[280px] flex-1 text-xs text-[var(--muted)]">
          Clockify API key
          <input
            className="input mt-1"
            type="password"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setWorkspaces(null);
            }}
            placeholder="Paste your API key"
          />
        </label>
        {!workspaces && (
          <button
            className="btn-primary"
            disabled={checking || !apiKey.trim()}
            onClick={async () => {
              setChecking(true);
              onError(null);
              const res = await checkClockifyConnection(apiKey);
              setChecking(false);
              if (res.error) return onError(res.error);
              setWorkspaces(res.workspaces ?? []);
              if (res.workspaces?.length === 1) setClockifyWorkspaceId(res.workspaces[0].id);
            }}
          >
            {checking ? "Connecting…" : "Connect"}
          </button>
        )}
      </div>

      {workspaces && (
        <div className="animate-rise mt-3 flex flex-wrap items-end gap-2 border-t border-[var(--border)] pt-3">
          <label className="text-xs text-[var(--muted)]">
            Clockify workspace
            <Select
              className="mt-1 min-w-[200px]"
              value={clockifyWorkspaceId}
              onChange={setClockifyWorkspaceId}
              placeholder="Choose…"
              ariaLabel="Clockify workspace"
              options={workspaces.map((w) => ({ value: w.id, label: w.name }))}
            />
          </label>
          <button
            className="btn-primary"
            disabled={importing || !clockifyWorkspaceId}
            onClick={async () => {
              setImporting(true);
              onError(null);
              const res = await startClockifyImport({
                workspaceId,
                apiKey,
                clockifyWorkspaceId,
              });
              setImporting(false);
              if (res.error) return onError(res.error);
              if (res.batchId) onStarted(res.batchId);
            }}
          >
            {importing ? "Fetching entries… this can take a minute" : "Start import"}
          </button>
        </div>
      )}
    </div>
  );
}

function ImportRowView({
  row,
  contentItems,
  contentTitle,
  onError,
  refresh,
}: {
  row: Row;
  contentItems: { id: string; title: string }[];
  contentTitle: string | undefined;
  onError: (m: string) => void;
  refresh: () => void;
}) {
  const confidence = row.match_confidence != null ? Math.round(row.match_confidence * 100) : null;
  const confidenceClass =
    confidence == null
      ? "text-[var(--muted)]"
      : confidence >= 70
        ? "text-[var(--success)]"
        : confidence >= 40
          ? "text-amber-500"
          : "text-[var(--muted)]";

  return (
    <div
      className={`flex flex-wrap items-center gap-2 px-3 py-2 text-sm ${
        row.status === "rejected" ? "opacity-50" : ""
      }`}
    >
      <div className="min-w-[200px] flex-1">
        <div className="truncate">{row.description}</div>
        <div className="flex gap-2 text-xs text-[var(--muted)]">
          <span>{row.member_name}</span>
          {row.duration_seconds != null && (
            <span>{formatDurationShort(row.duration_seconds)}</span>
          )}
          <span>{new Date(row.started_at).toLocaleDateString()}</span>
        </div>
      </div>

      {confidence != null && (
        <span className={`tabular text-xs ${confidenceClass}`}>{confidence}% match</span>
      )}

      {/* "No content link" is a real, choosable state, so the clear row
          means what it says and its empty value is written through. */}
      <Select
        className="max-w-[200px]"
        value={row.resolved_content_item_id ?? row.suggested_content_item_id ?? ""}
        onChange={async (v) => {
          const res = await resolveImportRow(row.id, {
            status: row.status === "pending" ? "approved" : row.status as "approved" | "skipped" | "rejected",
            contentItemId: v || null,
          });
          if (res.error) return onError(res.error);
          refresh();
        }}
        placeholder="No content link"
        ariaLabel="Link to content"
        options={contentItems.map((c) => ({ value: c.id, label: c.title }))}
      />
      {contentTitle && !row.resolved_content_item_id && (
        <span className="text-xs text-[var(--muted)]">suggested: {contentTitle}</span>
      )}

      <span
        className={`rounded px-1.5 py-0.5 text-xs capitalize ${
          row.status === "approved"
            ? "bg-[var(--success)]/15 text-[var(--success)]"
            : row.status === "skipped"
              ? "bg-[var(--bg-subtle)] text-[var(--muted)]"
              : row.status === "rejected"
                ? "bg-[var(--danger-100)] text-[var(--danger)]"
                : "bg-amber-500/15 text-amber-500"
        }`}
      >
        {row.status}
      </span>

      <div className="flex gap-1">
        <button
          className="rounded px-1.5 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)]"
          onClick={async () => {
            const res = await resolveImportRow(row.id, {
              status: "approved",
              contentItemId:
                row.resolved_content_item_id ?? row.suggested_content_item_id ?? null,
            });
            if (res.error) return onError(res.error);
            refresh();
          }}
        >
          Approve
        </button>
        <button
          className="rounded px-1.5 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)]"
          onClick={async () => {
            const res = await resolveImportRow(row.id, { status: "skipped" });
            if (res.error) return onError(res.error);
            refresh();
          }}
        >
          Skip content
        </button>
        <button
          className="rounded px-1.5 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--danger)]"
          onClick={async () => {
            const res = await resolveImportRow(row.id, { status: "rejected" });
            if (res.error) return onError(res.error);
            refresh();
          }}
        >
          Reject
        </button>
      </div>
    </div>
  );
}
