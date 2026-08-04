"use client";

/**
 * Route-level error boundary: an unhandled crash anywhere below the root
 * layout lands here instead of Next's unstyled default screen. Recovery
 * first -- most of what can throw in this app is a transient fetch, so
 * "Try again" (which re-renders the failed segment) usually just works.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="card w-full max-w-sm p-8 text-center">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          The page hit an unexpected error. It has been logged
          {error.digest ? ` (ref ${error.digest})` : ""} — trying again usually
          resolves it.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button className="btn-primary" onClick={reset}>
            Try again
          </button>
          <a className="btn" href="/">
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}
