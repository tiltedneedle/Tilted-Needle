"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Sign in, or get a reset link. Nothing else.
 *
 * THERE IS NO SIGN-UP HERE, ON PURPOSE. Accounts are created by an owner,
 * admin or manager from Team admin, which sends the person an invite; they
 * choose their password from that link. So every account that exists is
 * one somebody vouched for, and this page cannot mint a stranger a login.
 * The project's own "allow new sign-ups" switch is off to match -- removing
 * the form alone would leave the API route open.
 */
export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    router.push("/home");
    router.refresh();
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center px-4">
      {/* One barely-there wash behind the panel.
          A login screen is the only place in this product with nothing to
          read, so it can carry a little atmosphere -- but at 5% it registers
          as "this surface is not flat" rather than as a gradient. Anything
          stronger would be the first thing anyone sees announcing itself,
          which is the opposite of the brief. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, color-mix(in srgb, var(--accent) 5%, transparent), transparent 70%)",
        }}
      />

      <div className="animate-rise relative w-full max-w-[380px]">
        {/* The mark and wordmark sit OUTSIDE the panel, centred. Inside it
            they compete with the fields for the same vertical space; above
            it they read as a letterhead, which is the register this is
            aiming for. */}
        <div className="mb-7 flex flex-col items-center text-center">
          {/* The real brand mark, same asset the Guidelines grid serves. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/clients/tilted-needle.jpg"
            alt=""
            width={48}
            height={48}
            className="mb-4 rounded-[14px]"
            style={{ boxShadow: "var(--shadow-card)" }}
          />
          <div className="mb-1.5 text-[17px] font-semibold tracking-[-0.02em]">
            Tilted Needle
          </div>
          <p className="text-sm text-[var(--muted)]">Sign in to your workspace.</p>
        </div>

        <form onSubmit={onSubmit} className="card space-y-3 p-6">
          <input
            className="input"
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          <input
            className="input"
            type="password"
            required
            minLength={8}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />

          {error && (
            <p className="rounded-md border border-[var(--danger)]/25 bg-[var(--danger-100)] px-3 py-2 text-sm text-[var(--danger)]" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="rounded-md border border-[var(--success)]/25 bg-[var(--success-100)] px-3 py-2 text-sm text-[var(--success)]" role="status">
              {notice}
            </p>
          )}

          <button className="btn-primary w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {/* Secondary routes sit outside the panel and centred under it --
            they are a footnote to the form, not another field in it. */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          {(
            <button
              type="button"
              className="text-sm text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
              onClick={async () => {
                setError(null);
                setNotice(null);
                if (!email.trim()) {
                  setError("Type your email above first, then click reset.");
                  return;
                }
                // The emailed link lands on /auth/reset, which is on the
                // session proxy's public list -- see that page's comment.
                const { error } = await supabase.auth.resetPasswordForEmail(email, {
                  redirectTo: `${window.location.origin}/auth/reset`,
                });
                if (error) setError(error.message);
                else setNotice("Reset link sent — check your email.");
              }}
            >
              Forgot password?
            </button>
          )}
          <span className="text-sm text-[var(--muted)]">
            Need access? Ask your workspace admin for an invite.
          </span>
        </div>
      </div>
    </div>
  );
}
