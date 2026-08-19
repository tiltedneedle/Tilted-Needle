"use client";

import { FileDown } from "lucide-react";

/**
 * Turn the report into a PDF.
 *
 * WHY THE BROWSER'S OWN PRINT, and not a PDF library. Rendering server-side
 * would mean shipping a headless Chromium: ~120MB of binary against a 250MB
 * Vercel Hobby function limit, on a plan with a 300s ceiling and a cold start
 * on every request. Drawing the document a second time in jsPDF would mean
 * maintaining two layouts that must agree forever, and they would not.
 *
 * The browser already lays this page out correctly and already has a PDF
 * writer. `print` uses both, so what you save is exactly what you reviewed --
 * same fonts, same numbers, same page breaks -- and the print stylesheet on
 * the report page controls the pagination.
 *
 * The one honest limitation: the browser asks where to save, and on some
 * systems the destination has to be set to "Save as PDF" once. It is a dialog,
 * not a download. Said plainly on the button's tooltip rather than discovered.
 */
export default function PrintReportButton({ disabled = false }: { disabled?: boolean }) {
  return (
    <button
      type="button"
      className="btn flex items-center gap-1.5 px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-45"
      onClick={() => window.print()}
      disabled={disabled}
      title={
        disabled
          ? "There is no document to save — this client has nothing to report for this period"
          : "Opens your browser's print dialog — choose 'Save as PDF' as the destination"
      }
    >
      <FileDown size={13} />
      Save as PDF
    </button>
  );
}
