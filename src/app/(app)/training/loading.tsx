import { Skeleton } from "@/components/ui/Skeleton";

/** Shown instantly while the course list resolves. */
export default function TrainingLoading() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <div className="mb-6 pb-5" style={{ borderBottom: "1px solid var(--border)" }}>
        <Skeleton className="h-7 w-32" />
        <Skeleton className="mt-2 h-4 w-80" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card space-y-2 p-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-1.5 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
