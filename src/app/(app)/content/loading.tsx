import { Skeleton, SkeletonStat, SkeletonRows } from "@/components/ui/Skeleton";

/**
 * Shown instantly on navigation, before the Content dashboard's data (a
 * full-workspace read plus computeRankings) resolves -- Next streams this
 * in immediately rather than leaving the page blank for the fetch.
 */
export default function ContentLoading() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <div className="mb-6 pb-5" style={{ borderBottom: "1px solid var(--border)" }}>
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>
      <Skeleton className="mb-5 h-14 w-full" />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SkeletonStat />
        <SkeletonStat />
        <SkeletonStat />
        <SkeletonStat />
      </div>
      <Skeleton className="mb-2 h-4 w-32" />
      <SkeletonRows rows={8} />
    </div>
  );
}
