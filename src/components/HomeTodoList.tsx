"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { toggleTodoDone } from "@/app/actions";
import { useToast } from "@/components/ui/Toast";
import { one, type Todo } from "@/lib/types";

/**
 * Today's tasks, right on the home page, with the same one-tap done toggle
 * as the To-dos sheet -- the point of a home dashboard is doing the day's
 * work from it, not just reading about it.
 */
export default function HomeTodoList({ todos }: { todos: Todo[] }) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();

  return (
    <div className="card divide-y divide-[var(--border)] overflow-hidden">
      {todos.map((t) => {
        const client = one(t.client);
        return (
          <div key={t.id} className="flex items-center gap-3 px-3 py-2.5">
            <button
              className="grid size-5 shrink-0 place-items-center rounded-md border transition-colors"
              style={{
                borderColor: t.is_done ? "var(--success)" : "var(--border-strong)",
                background: t.is_done ? "var(--success)" : "transparent",
                color: "var(--accent-fg)",
              }}
              onClick={async () => {
                const res = await toggleTodoDone(t.id, !t.is_done);
                if (res.error) toast("danger", res.error);
                startTransition(() => router.refresh());
              }}
              aria-label={t.is_done ? "Mark as not done" : "Mark as done"}
            >
              {t.is_done && <Check size={13} strokeWidth={3} />}
            </button>
            <span
              className={`min-w-0 flex-1 truncate text-sm ${
                t.is_done ? "text-[var(--muted)] line-through" : ""
              }`}
            >
              {t.description}
            </span>
            {client && (
              <span className="pill pill-neutral shrink-0" title="Client">
                {client.name}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
