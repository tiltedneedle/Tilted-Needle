import { Skeleton, SkeletonRows } from "@/components/ui/Skeleton";

/** Shown instantly while the day's sheet resolves. */
export default function TodosLoading() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <div className="mb-6 pb-5" style={{ borderBottom: "1px solid var(--border)" }}>
        <Skeleton className="h-7 w-28" />
        <Skeleton className="mt-2 h-4 w-80" />
      </div>
      <Skeleton className="mb-5 h-14 w-full" />
      <div className="mb-4 flex items-center gap-2">
        <Skeleton className="h-9 w-9" />
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-9" />
      </div>
      <SkeletonRows rows={6} />
    </div>
  );
}
