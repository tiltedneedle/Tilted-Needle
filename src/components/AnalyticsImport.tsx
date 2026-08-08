"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Check, AlertTriangle } from "lucide-react";
import { previewStudioImport, commitStudioImport, type StudioImportPreview } from "@/app/actions";
import { useToast } from "@/components/ui/Toast";

/**
 * Import a client's own analytics export (PRD-video-intelligence §2.1).
 *
 * The two-step shape is the point. The file comes from a UI that changes
 * between versions and locales, so what WOULD be written is shown first and a
 * human confirms it. A silent import of a misread column would put invented
 * numbers in front of a paying client, which is worse than importing nothing.
 *
 * Everything here is a client component talking to server actions, so the file
 * never leaves the browser except as text the action parses.
 */
export default function AnalyticsImport({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [preview, setPreview] = useState<StudioImportPreview | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    setBusy(true);
    setPreview(null);
    setFileName(file.name);
    try {
      const text = await file.text();
      const res = await previewStudioImport(workspaceId, text);
      if (res.error) {
        toast("danger", res.error);
        return;
      }
      setPreview(res);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!preview?.matched.length) return;
    setBusy(true);
    try {
      const res = await commitStudioImport(workspaceId, preview.matched);
      if (res.error) {
        toast("danger", res.error);
        return;
      }
      toast("success", `Imported ${res.imported} video${res.imported === 1 ? "" : "s"}.`);
      setPreview(null);
      setFileName(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[240px] flex-1">
          <h3 className="text-sm font-semibold">Client analytics import</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Impressions, click-through rate and average percentage viewed are
            owner-only — no public API serves them. Ask the client to export
            from YouTube Studio → Analytics → Advanced mode, and drop the CSV
            here.
          </p>
        </div>

        <label className="btn shrink-0 cursor-pointer px-3 py-1.5 text-xs">
          <Upload size={13} className="mr-1.5 inline" />
          {busy ? "Reading…" : "Choose CSV"}
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              // Reset so re-picking the same file still fires a change.
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {preview && (
        <div className="animate-rise mt-4 border-t border-[var(--border)] pt-3">
          <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-xs font-medium">{fileName}</span>
            <span className="text-xs text-[var(--muted)]">
              {preview.matched.length} matched · {preview.unmatched.length} skipped
            </span>
          </div>

          {/* Problems are shown before the table, never after: they change
              whether the numbers below should be trusted at all. */}
          {preview.problems.length > 0 && (
            <ul className="mb-3 space-y-1">
              {preview.problems.map((p, i) => (
                <li
                  key={i}
                  className="flex items-start gap-1.5 rounded border border-[var(--warning)]/25 bg-[var(--warning-100)] px-2 py-1.5 text-xs text-[var(--warning)]"
                >
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          )}

          {preview.matched.length > 0 ? (
            <>
              <div className="max-h-64 overflow-auto rounded border border-[var(--border)]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-[var(--bg-subtle)]">
                    <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                      <th className="px-2.5 py-1.5 font-medium">Video</th>
                      <th className="px-2.5 py-1.5 text-right font-medium">Impressions</th>
                      <th className="px-2.5 py-1.5 text-right font-medium">CTR</th>
                      <th className="px-2.5 py-1.5 text-right font-medium">Avg viewed</th>
                      <th className="px-2.5 py-1.5 text-right font-medium">Avg duration</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {preview.matched.map((r) => (
                      <tr key={r.postId}>
                        <td className="max-w-[220px] truncate px-2.5 py-1.5">
                          {r.title ?? r.videoId}
                        </td>
                        <td className="tabular px-2.5 py-1.5 text-right">
                          {r.impressions?.toLocaleString() ?? "—"}
                        </td>
                        <td className="tabular px-2.5 py-1.5 text-right">
                          {r.ctrPercent != null ? `${r.ctrPercent.toFixed(2)}%` : "—"}
                        </td>
                        <td className="tabular px-2.5 py-1.5 text-right">
                          {r.avgViewedPercent != null ? `${r.avgViewedPercent.toFixed(1)}%` : "—"}
                        </td>
                        <td className="tabular px-2.5 py-1.5 text-right text-[var(--muted)]">
                          {r.avgViewSeconds != null
                            ? `${Math.floor(r.avgViewSeconds / 60)}:${String(r.avgViewSeconds % 60).padStart(2, "0")}`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <button className="btn px-3 py-1.5 text-xs" disabled={busy} onClick={() => void confirm()}>
                  <Check size={13} className="mr-1.5 inline" />
                  {busy ? "Importing…" : `Import ${preview.matched.length}`}
                </button>
                <button
                  className="rounded px-2 py-1.5 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--fg)]"
                  onClick={() => { setPreview(null); setFileName(null); }}
                >
                  Cancel
                </button>
                <span className="text-xs text-[var(--muted)]">
                  Nothing is written until you confirm.
                </span>
              </div>
            </>
          ) : (
            <p className="text-xs text-[var(--muted)]">
              Nothing in this file can be imported.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
