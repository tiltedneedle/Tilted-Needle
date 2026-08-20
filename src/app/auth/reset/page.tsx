"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Lands here from the recovery email's link. The Supabase browser client
 * consumes the link's token on load and leaves a recovery session; this
 * page then just sets the new password against it. Lives at /auth/reset
 * (a real path, not a route group) because the session proxy's public
 * allow-list opens the /auth prefix -- a signed-out user must be able to
 * reach it or the emailed link would bounce to the login screen.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();
  const [state, setState] = useState<"checking" | "ready" | "expired">("checking");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    /**
     * Adopt the recovery token from the URL HASH, by hand.
     *
     * This page used to assume the client would do it: "the client processes
     * the recovery hash asynchronously on load; ask it rather than parsing
     * the URL by hand". That is true of the plain supabase-js browser client
     * and NOT of createBrowserClient from @supabase/ssr, which this app uses
     * -- it runs the PKCE flow and looks for `?code=`, so a
     * `#access_token=...` fragment is simply ignored.
     *
     * Supabase's /auth/v1/verify answers a recovery link with exactly that
     * fragment (303 + #access_token&refresh_token&type=recovery, confirmed
     * against the live project). So every reset link ever sent landed here,
     * found no session, and reported itself invalid or expired. The button
     * in Team admin has never worked; nor would any link this project
     * generates.
     *
     * The hash is consumed and then wiped from the address bar, because a
     * bearer token has no business surviving in history or in a shared URL.
     */
    let cancelled = false;

    const adopt = async () => {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const access_token = hash.get("access_token");
      const refresh_token = hash.get("refresh_token");

      if (hash.get("error")) return setState("expired");

      if (access_token && refresh_token) {
        const { error } = await supabase.auth.setSession({ access_token, refresh_token });
        // Leave the URL clean whether or not it worked.
        window.history.replaceState(null, "", window.location.pathname);
        if (cancelled) return;
        return setState(error ? "expired" : "ready");
      }

      // No fragment: either a PKCE `?code=` the client already exchanged, or
      // somebody opened this page directly.
      const { data } = await supabase.auth.getSession();
      if (!cancelled) setState(data.session ? "ready" : "expired");
    };

    void adopt();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session && !cancelled) setState("ready");
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(error.message);
    router.push("/home");
    router.refresh();
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8">
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
            {state === "expired"
              ? "This reset link is invalid or has expired."
              : "Choose a new password."}
          </p>
        </div>

        {state === "checking" && (
          <div className="skeleton h-11 w-full" aria-label="Checking the reset link" />
        )}

        {state === "expired" && (
          <a className="btn-primary inline-flex" href="/login">
            Back to sign in
          </a>
        )}

        {state === "ready" && (
          <form onSubmit={(e) => void save(e)} className="space-y-3">
            <input
              className="input"
              type="password"
              required
              minLength={8}
              placeholder="New password (min. 8 characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              autoFocus
            />
            {error && (
              <p
                className="rounded-md border border-[var(--danger)]/25 bg-[var(--danger-100)] px-3 py-2 text-sm text-[var(--danger)]"
                role="alert"
              >
                {error}
              </p>
            )}
            <button className="btn-primary w-full" disabled={busy}>
              {busy ? "Saving…" : "Set new password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
