import { SectionHeading } from "@/components/Stat";

/**
 * Whether the machine is actually running (PRD-video-intelligence §8.5).
 *
 * An autonomous pipeline that nobody can see is indistinguishable from a
 * stopped one. Every figure here answers a question an operator would
 * otherwise have to ask someone: is the worker alive, is the queue moving, is
 * anything blocked, how much has the month's budget been spent, and which
 * clients still owe an export.
 *
 * The heartbeat is the load-bearing one. All state lives in Supabase and the
 * worker is disposable, so "the Oracle instance was reclaimed" shows up here
 * as an ageing timestamp within minutes rather than as data that quietly
 * stops updating.
 */

export type PipelineStatus = {
  workers: { id: string; secondsAgo: number; detail: Record<string, unknown> }[];
  queue: { kind: string; pending: number; running: number; failed: number; unavailable: number }[];
  tokens: { used: number; limit: number } | null;
  transcripts: { withText: number; total: number };
  analytics: { clientName: string; videos: number; withOwnerData: number }[];
};

/** A worker that has not spoken in this long is presumed gone. */
const STALE_AFTER_S = 300;

function ago(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

/**
 * A CI runner is not a worker that died -- it is a worker that finished.
 *
 * Every scheduled sync run checks in under its own `gha-<run_id>`, does its
 * work and exits, leaving a heartbeat that will never beat again. The card
 * drew each one as a red, struck-through "silent" worker, so a healthy
 * pipeline accumulated an ever-growing wall of alarming corpses: 28 of the
 * 30 rows on this workspace, the oldest a week old, every one of them a run
 * that SUCCEEDED.
 *
 * Long-lived workers are the ones whose silence means something. Those are
 * named deliberately (tn-worker-oracle, tn-worker-desktop); the ephemeral
 * ones are counted, not listed.
 */
const isEphemeral = (id: string) => id.startsWith("gha-");

export default function PipelineHealth({ status }: { status: PipelineStatus }) {
  const persistent = status.workers.filter((w) => !isEphemeral(w.id));
  const live = persistent.filter((w) => w.secondsAgo <= STALE_AFTER_S);
  const stale = persistent.filter((w) => w.secondsAgo > STALE_AFTER_S);
  /* The most recent CI check-in stands for all of them: what matters is
     whether scheduled runs are still happening, not which ones have ended. */
  const lastCi = status.workers
    .filter((w) => isEphemeral(w.id))
    .sort((a, b) => a.secondsAgo - b.secondsAgo)[0];
  const totals = status.queue.reduce(
    (a, q) => ({
      pending: a.pending + q.pending,
      running: a.running + q.running,
      failed: a.failed + q.failed,
    }),
    { pending: 0, running: 0, failed: 0 },
  );

  return (
    <>
      <SectionHeading
        title="Pipeline health"
        note="The ingest worker runs outside this app — this is how you know it is alive"
      />

      <div className="card mb-7 p-4">
        {/* ---- Worker liveness ---- */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {status.workers.length === 0 ? (
            <span className="text-sm text-[var(--muted)]">
              No worker has ever checked in. The pipeline is not running.
            </span>
          ) : (
            <>
              {live.map((w) => (
                <span key={w.id} className="flex items-center gap-1.5 text-sm">
                  <span className="size-2 rounded-full bg-[var(--success)]" />
                  <span className="font-medium">{w.id}</span>
                  <span className="text-xs text-[var(--muted)]">{ago(w.secondsAgo)}</span>
                </span>
              ))}
              {lastCi && (
                <span
                  className="flex items-center gap-1.5 text-sm"
                  title="Scheduled runs check in under a one-off id and exit when done. Only the most recent is shown; the rest finished successfully."
                >
                  <span
                    className={`size-2 rounded-full ${
                      lastCi.secondsAgo <= 6 * 3600
                        ? "bg-[var(--success)]"
                        : "bg-[var(--warn)]"
                    }`}
                  />
                  <span className="font-medium">scheduled runs</span>
                  <span className="text-xs text-[var(--muted)]">
                    last {ago(lastCi.secondsAgo)}
                  </span>
                </span>
              )}
              {stale.map((w) => (
                <span
                  key={w.id}
                  className="flex items-center gap-1.5 text-sm"
                  title="Silent for longer than a poll interval — the instance may have been reclaimed"
                >
                  <span className="size-2 rounded-full bg-[var(--danger)]" />
                  <span className="font-medium text-[var(--muted)] line-through">{w.id}</span>
                  <span className="text-xs text-[var(--danger)]">silent {ago(w.secondsAgo)}</span>
                </span>
              ))}
            </>
          )}

          <div className="flex-1" />

          <span className="text-xs text-[var(--muted)]">
            <span className="tabular text-[var(--fg)]">{totals.pending}</span> pending ·{" "}
            <span className="tabular text-[var(--fg)]">{totals.running}</span> running
            {totals.failed > 0 && (
              <>
                {" · "}
                <span className="tabular text-[var(--danger)]">{totals.failed}</span> failed
              </>
            )}
          </span>
        </div>

        {/* ---- Queue by kind ---- */}
        {status.queue.length > 0 && (
          <div className="mt-3 overflow-x-auto border-t border-[var(--border)] pt-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                  <th className="py-1 pr-3 font-medium">Job kind</th>
                  <th className="py-1 pr-3 text-right font-medium">Pending</th>
                  <th className="py-1 pr-3 text-right font-medium">Running</th>
                  <th className="py-1 pr-3 text-right font-medium">Failed</th>
                  <th
                    className="py-1 text-right font-medium"
                    title="Terminal and normal: the subject genuinely has nothing to fetch"
                  >
                    Nothing to fetch
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {status.queue.map((q) => (
                  <tr key={q.kind}>
                    <td className="py-1.5 pr-3">{q.kind}</td>
                    <td className="tabular py-1.5 pr-3 text-right">{q.pending || "—"}</td>
                    <td className="tabular py-1.5 pr-3 text-right">{q.running || "—"}</td>
                    <td
                      className={`tabular py-1.5 pr-3 text-right ${q.failed ? "text-[var(--danger)]" : ""}`}
                    >
                      {q.failed || "—"}
                    </td>
                    <td className="tabular py-1.5 text-right text-[var(--muted)]">
                      {q.unavailable || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ---- Spend ---- */}
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-[var(--border)] pt-3 text-xs">
          <span className="text-[var(--muted)]">
            Model spend this month{" "}
            {status.tokens ? (
              <span
                className={`tabular ${
                  status.tokens.used >= status.tokens.limit
                    ? "text-[var(--danger)]"
                    : status.tokens.used >= status.tokens.limit * 0.8
                      ? "text-[var(--warning)]"
                      : "text-[var(--fg)]"
                }`}
              >
                {status.tokens.used.toLocaleString()} / {status.tokens.limit.toLocaleString()} tokens
              </span>
            ) : (
              <span className="text-[var(--fg)]">no ceiling set</span>
            )}
          </span>

          <span className="text-[var(--muted)]">
            Transcripts{" "}
            <span className="tabular text-[var(--fg)]">
              {status.transcripts.withText}/{status.transcripts.total}
            </span>{" "}
            videos
          </span>
        </div>
      </div>

      {/* ---- Who still owes an export ----
          The one dependency in this system that is social rather than
          technical: owner-only figures exist only if a client sends them.
          Named here so chasing one is a visible task instead of a thing
          nobody remembers (PRD §2.4). */}
      {status.analytics.length > 0 && (
        <>
          <SectionHeading
            title="Owner analytics coverage"
            note="CTR and retention exist only where a client has supplied an export"
          />
          <div className="card mb-7 p-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
              {status.analytics.map((c) => {
                const complete = c.videos > 0 && c.withOwnerData >= c.videos;
                const none = c.withOwnerData === 0;
                return (
                  <span
                    key={c.clientName}
                    className={
                      complete
                        ? "text-[var(--success)]"
                        : none
                          ? "text-[var(--muted)]"
                          : ""
                    }
                    title={
                      none
                        ? "No export received — CTR and retention unavailable for this client"
                        : `${c.withOwnerData} of ${c.videos} videos have owner-supplied figures`
                    }
                  >
                    {c.clientName}{" "}
                    <span className="tabular">
                      {c.withOwnerData}/{c.videos}
                    </span>
                  </span>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}
