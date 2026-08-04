import { Skeleton, SkeletonStat, SkeletonRows } from "@/components/ui/Skeleton";

/** The landing page must never sit blank. */
export default function HomeLoading() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <div className="mb-6 pb-5" style={{ borderBottom: "1px solid var(--border)" }}>
        <Skeleton className="h-7 w-56" />
        <Skeleton className="mt-2 h-4 w-40" />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SkeletonStat />
        <SkeletonStat />
        <SkeletonStat />
        <SkeletonStat />
      </div>
      <Skeleton className="mb-2 h-4 w-32" />
      <SkeletonRows rows={5} />
    </div>
  );
}
