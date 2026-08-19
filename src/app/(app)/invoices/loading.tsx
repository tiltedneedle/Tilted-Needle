import { Skeleton, SkeletonStat, SkeletonRows } from "@/components/ui/Skeleton";

/**
 * Instant stand-in while the page's data resolves.
 *
 * The routes that had one of these felt alive on a cold hit; the ones
 * without sat blank for 4-10s and read as broken -- the measured cold
 * loads are cache fills, and a skeleton is the difference between
 * "loading" and "dead". Same three primitives every other loading.tsx
 * composes; the width matches the page so nothing jumps when it lands.
 */
export default function RouteLoading() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <div className="mb-6 pb-5" style={{ borderBottom: "1px solid var(--border)" }}>
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>
      <Skeleton className="mb-5 h-12 w-full" />
      <SkeletonRows rows={4} />
    </div>
  );
}
