import { Skeleton, SkeletonRows } from "@/components/ui/Skeleton";

/** The post-login landing page -- it above all must never sit blank. */
export default function TrackLoading() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <div className="mb-6 pb-5" style={{ borderBottom: "1px solid var(--border)" }}>
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>
      <Skeleton className="mb-5 h-16 w-full" />
      <SkeletonRows rows={6} />
    </div>
  );
}
