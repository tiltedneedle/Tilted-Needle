import { Skeleton, SkeletonRows } from "@/components/ui/Skeleton";

/** Shown instantly while a course's videos and progress resolve. */
export default function ModuleLoading() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <Skeleton className="mb-3 h-4 w-20" />
      <div className="mb-6 pb-5" style={{ borderBottom: "1px solid var(--border)" }}>
        <Skeleton className="h-7 w-56" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>
      <div className="skeleton mb-4 w-full" style={{ aspectRatio: "16 / 9" }} />
      <SkeletonRows rows={4} />
    </div>
  );
}
