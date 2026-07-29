import type { InputHTMLAttributes } from "react";

/**
 * Wraps .input with the error state wired to an actual message rather than
 * relying on every call site to remember `aria-invalid` + a helper line.
 */
export default function Input({
  error,
  className = "",
  ...props
}: { error?: string | null } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <input className={`input ${className}`} aria-invalid={!!error} {...props} />
      {error && (
        <p className="mt-1 text-xs text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
