"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ImageUp, Check, AlertTriangle } from "lucide-react";
import { uploadScreenshot, confirmExtraction } from "@/app/actions";
import { useToast } from "@/components/ui/Toast";

/**
 * Screenshot → draft → confirm (PRD-video-intelligence §2.1 Route B).
 *
 * Instagram has no CSV export, so for reach, saves and shares this is the only
 * route that exists. It is also the one place OCR belongs in this product,
 * which is why the confirmation step is not optional and not a formality:
 * every value is editable, the flagged ones sort to the top, and nothing
 * reaches the database until someone presses confirm.
 *
 * The draft arrives asynchronously — the worker holds the vision key, not this
 * app — so the screen polls for it rather than blocking on a request.
 */

type DraftValue = {
  name: string;
  rawText: string;
  value: number | null;
  confidence: "low" | "medium" | "high";
  warning?: string;
};

const LABELS: Record<string, string> = {
  views: "Views",
  reach: "Reach",
  impressions: "Impressions",
  likes: "Likes",
  comments: "Comments",
  shares: "Shares",
  saves: "Saves",
  ctrPercent: "Click-through rate (%)",
  avgViewedPercent: "Average viewed (%)",
  avgViewSeconds: "Average view duration (s)",
};

export default function ScreenshotImport({
  workspaceId,
  platformPostId,
  /** Polled draft, supplied by the parent once the worker has written one. */
  draft,
}: {
  workspaceId: string;
  platformPostId: string;
  draft: { values: DraftValue[]; storagePath: string; ownerOnlyCount: number } | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [waiting, setWaiting] = useState(false);

  async function onFile(file: File) {
    setBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("Could not read that file."));
        r.readAsDataURL(file);
      });
      const res = await uploadScreenshot({ workspaceId, platformPostId, dataUrl });
      if (res.error) {
        toast("danger", res.error);
        return;
      }
      setWaiting(true);
      toast("success", "Queued for reading — the draft appears here shortly.");
      router.refresh();
    } catch (e) {
      toast("danger", e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!draft) return;
    setBusy(true);
    try {
      const values = draft.values.map((v) => {
        const override = edited[v.name];
        if (override === undefined) return { name: v.name, value: v.value };
        const trimmed = override.trim();
        // A cleared field means "this was not on screen", not zero.
        if (trimmed === "") return { name: v.name, value: null };
        const n = Number(trimmed.replace(/,/g, ""));
        return { name: v.name, value: Number.isFinite(n) ? n : null };
      });
      const res = await confirmExtraction({
        workspaceId, platformPostId, values, storagePath: draft.storagePath,
      });
      if (res.error) {
        toast("danger", res.error);
        return;
      }
      toast("success", "Confirmed and stored. The screenshot has been deleted.");
      setEdited({});
      setWaiting(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[240px] flex-1">
          <h3 className="text-sm font-semibold">Read an Insights screenshot</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Instagram has no export, so a screenshot is the only route to reach,
            saves and shares. Every figure is read into a draft you check
            against the image before anything is stored.
          </p>
        </div>
        <label className="btn shrink-0 cursor-pointer px-3 py-1.5 text-xs">
          <ImageUp size={13} className="mr-1.5 inline" />
          {busy ? "Uploading…" : "Choose image"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {waiting && !draft && (
        <p className="mt-3 border-t border-[var(--border)] pt-3 text-xs text-[var(--muted)]">
          Waiting for the worker to read it. This page refreshes when the draft
          is ready — if it never arrives, check pipeline health above.
        </p>
      )}

      {draft && (
        <div className="animate-rise mt-4 border-t border-[var(--border)] pt-3">
          {draft.ownerOnlyCount === 0 && (
            <p className="mb-3 flex items-start gap-1.5 rounded border border-[var(--warning)]/25 bg-[var(--warning-100)] px-2 py-1.5 text-xs text-[var(--warning)]">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>
                This screenshot only shows figures the sync already has. Storing
                it adds nothing — reach, saves, shares or CTR are what make one
                worth importing.
              </span>
            </p>
          )}

          <div className="space-y-1.5">
            {draft.values.map((v) => (
              <div key={v.name} className="flex flex-wrap items-center gap-2">
                <span className="min-w-[170px] text-sm">{LABELS[v.name] ?? v.name}</span>
                <input
                  className="input max-w-[140px] py-1 text-sm"
                  defaultValue={v.value ?? ""}
                  placeholder="not on screen"
                  onChange={(e) => setEdited((s) => ({ ...s, [v.name]: e.target.value }))}
                  aria-label={LABELS[v.name] ?? v.name}
                />
                <span className="text-xs text-[var(--muted)]">
                  read as &ldquo;{v.rawText}&rdquo;
                </span>
                {v.warning && (
                  <span className="text-xs text-[var(--warning)]">{v.warning}</span>
                )}
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button className="btn px-3 py-1.5 text-xs" disabled={busy} onClick={() => void confirm()}>
              <Check size={13} className="mr-1.5 inline" />
              {busy ? "Storing…" : "Confirm and store"}
            </button>
            <span className="text-xs text-[var(--muted)]">
              Nothing is written until you confirm; the screenshot is deleted
              immediately after.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
