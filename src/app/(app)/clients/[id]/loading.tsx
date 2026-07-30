import { Skeleton } from "@/components/ui/Skeleton";

/** Shown instantly while one client's channel list resolves. */
export default function ClientLoading() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <Skeleton className="mb-3 h-4 w-24" />
      <div className="mb-6 pb-5" style={{ borderBottom: "1px solid var(--border)" }}>
        <Skeleton className="h-7 w-48" />
        <Skeleton className="mt-2 h-4 w-56" />
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card flex items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-2 h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
