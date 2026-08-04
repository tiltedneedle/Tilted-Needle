import Link from "next/link";

/** Branded 404 -- a bad or stale URL should not read as a broken app. */
export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="card w-full max-w-sm p-8 text-center">
        <p className="eyebrow">404</p>
        <h1 className="mt-1 text-lg font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          That page doesn&apos;t exist — the link may be stale, or the item it
          pointed to was removed.
        </p>
        <div className="mt-5 flex justify-center">
          <Link className="btn-primary" href="/">
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
