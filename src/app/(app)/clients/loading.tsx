import { Skeleton } from "@/components/ui/Skeleton";

/** Shown instantly while the client list and their platform tags resolve. */
export default function ClientsLoading() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <div className="mb-6 pb-5" style={{ borderBottom: "1px solid var(--border)" }}>
        <Skeleton className="h-7 w-24" />
        <Skeleton className="mt-2 h-4 w-96" />
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="card flex items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-2 h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
