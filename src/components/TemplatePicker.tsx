"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { setClientReportTemplate } from "@/app/actions";
import { useToast } from "@/components/ui/Toast";
import { REPORT_TEMPLATES, type ReportTemplate } from "@/lib/reportTemplates";

/**
 * Which design this client's report is sent in.
 *
 * Switching is free and reversible: a template selects a stylesheet and
 * nothing else, so no figure can appear or disappear with the choice. That is
 * worth saying on the control, because a picker that might silently change
 * what a client is told is one nobody dares touch.
 *
 * The change applies immediately and the page re-renders, so this doubles as
 * the preview -- there is no separate "try it" mode to get out of sync with
 * what actually sends.
 */
export default function TemplatePicker({
  clientId,
  current,
}: {
  clientId: string;
  current: ReportTemplate;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-1">
      {REPORT_TEMPLATES.map((t) => {
        const active = t.id === current;
        return (
          <button
            key={t.id}
            type="button"
            disabled={busy !== null}
            title={t.blurb}
            className={`rounded px-2 py-1 text-xs transition-colors disabled:opacity-50 ${
              active
                ? "bg-[var(--accent)]/15 font-medium text-[var(--accent)]"
                : "text-[var(--muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)]"
            }`}
            onClick={async () => {
              if (active) return;
              setBusy(t.id);
              const res = await setClientReportTemplate({ clientId, template: t.id });
              setBusy(null);
              if (res.error) return toast("danger", res.error);
              startTransition(() => router.refresh());
            }}
          >
            <span className="flex items-center gap-1">
              {active && <Check size={11} />}
              {busy === t.id ? "…" : t.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}
