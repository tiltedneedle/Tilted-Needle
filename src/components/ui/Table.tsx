import type { ReactNode } from "react";

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Right-aligns a numeric column so figures stack for scanning. */
  align?: "left" | "right";
  className?: string;
};

/**
 * A .card wrapping a plain table: 56px rows, a subtle header row, hairline
 * dividers, and a hover tint per row -- the same shell every list page in the
 * app already needs, so a row's own content stays a plain render function
 * rather than each page hand-rolling table markup.
 */
export default function Table<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`eyebrow whitespace-nowrap px-4 py-3 font-medium ${
                    c.align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`h-14 border-b border-[var(--border)] transition-colors last:border-0 hover:bg-[var(--bg-elevated)] ${
                  onRowClick ? "cursor-pointer" : ""
                }`}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-4 py-2 ${c.align === "right" ? "text-right" : "text-left"} ${c.className ?? ""}`}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
