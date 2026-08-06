"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        setBusy(false);
        return;
      }
      router.push("/home");
      router.refresh();
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name || email.split("@")[0] } },
      });
      if (error) {
        setError(error.message);
        setBusy(false);
        return;
      }
      // With email confirmation on, there is no session yet.
      if (!data.session) {
        setNotice("Check your email to confirm your account, then sign in.");
        setMode("signin");
        setBusy(false);
        return;
      }
      router.push("/home");
      router.refresh();
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="animate-rise w-full max-w-sm">
        <div className="mb-8">
          {/* The real brand mark, same asset the Guidelines grid serves. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/clients/tilted-needle.jpg"
            alt=""
            width={44}
            height={44}
            className="mb-3 rounded-xl"
          />
          <div className="mb-1 text-lg font-semibold tracking-tight">Tilted Needle</div>
          <p className="text-sm text-[var(--muted)]">
            {mode === "signin" ? "Sign in to your workspace." : "Create your account."}
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          {mode === "signup" && (
            <input
              className="input"
              placeholder="Full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          )}
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
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
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
            {busy ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1">
          <button
            type="button"
            className="text-sm text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
              setNotice(null);
            }}
          >
            {mode === "signin"
              ? "Need an account? Sign up"
              : "Already have an account? Sign in"}
          </button>
          {mode === "signin" && (
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
        </div>
      </div>
    </div>
  );
}
