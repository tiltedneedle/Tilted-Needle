import { Skeleton, SkeletonStat, SkeletonRows } from "@/components/ui/Skeleton";

/**
 * Shown instantly while a channel's dashboard resolves -- the heaviest read
 * on this route, since it reconstructs a reach-over-time series by merging
 * every one of the channel's videos' snapshot histories.
 */
export default function ChannelLoading() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <Skeleton className="mb-3 h-4 w-32" />
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
      <Skeleton className="mb-6 h-[220px] w-full" />
      <SkeletonRows rows={6} />
    </div>
  );
}
