import { Skeleton } from "@/components/ui/Skeleton";

/** Shown instantly while the client guideline cards resolve. */
export default function GuidelinesLoading() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <div className="mb-6 pb-5" style={{ borderBottom: "1px solid var(--border)" }}>
        <Skeleton className="h-7 w-36" />
        <Skeleton className="mt-2 h-4 w-96" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card overflow-hidden">
            <div className="skeleton aspect-[4/3] w-full rounded-none" />
            <div className="space-y-2 p-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-1 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
