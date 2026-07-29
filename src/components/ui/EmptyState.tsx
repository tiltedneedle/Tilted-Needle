import type { ReactNode } from "react";

/**
 * A friendly icon-in-a-coral-circle, one sentence, and a primary action --
 * never a bare blank card. This is what "no data yet" looks like everywhere
 * a list or table can be empty.
 */
export default function EmptyState({
  icon,
  message,
  action,
}: {
  icon: ReactNode;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-3 p-10 text-center">
      <div
        className="grid size-12 place-items-center rounded-full"
        style={{ background: "var(--coral-100)", color: "var(--coral-500)" }}
      >
        {icon}
      </div>
      <p className="max-w-xs text-sm text-[var(--muted)]">{message}</p>
      {action}
    </div>
  );
}
