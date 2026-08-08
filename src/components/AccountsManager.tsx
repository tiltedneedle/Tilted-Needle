"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAccount, setArchived, updateAccountClient } from "@/app/actions";
import { useToast } from "@/components/ui/Toast";
import { PLATFORM_COLORS } from "@/lib/types";
import type { Account, Client, Platform } from "@/lib/types";

/** Per platform: do its numbers arrive on their own, and does that cost money. */
type FetchMode = { auto: boolean; metered: boolean };

export default function AccountsManager({
  workspaceId,
  accounts,
  platforms,
  clients,
  canManage,
  fetchByPlatform,
}: {
  workspaceId: string;
  accounts: Account[];
  platforms: Platform[];
  clients: Client[];
  canManage: boolean;
  fetchByPlatform: Record<string, FetchMode>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [handle, setHandle] = useState("");
  const [platformSlug, setPlatformSlug] = useState(platforms[0]?.slug ?? "");
  const [clientId, setClientId] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Archiving is filtered upstream, in the page's URL filters, so the two
  // cannot disagree about what "archived" means.
  const visible = accounts;

  async function create() {
    if (!handle.trim()) return setError("Handle is required.");
    setError(null);
    const res = await createAccount({
      workspaceId,
      clientId: clientId || null,
      platformSlug,
      handle,
    });
    if (res.error) return setError(res.error);
    setHandle("");
    startTransition(() => router.refresh());
  }

  async function toggle(a: Account) {
    const res = await setArchived("accounts", a.id, !a.is_archived);
    if (res.error) toast("danger", res.error);
    startTransition(() => router.refresh());
  }

  const byPlatform = new Map<string, Account[]>();
  for (const a of visible) {
    if (!byPlatform.has(a.platform_slug)) byPlatform.set(a.platform_slug, []);
    byPlatform.get(a.platform_slug)!.push(a);
  }

  return (
    <>
      {canManage && (
        <div className="card mb-4 flex flex-wrap items-end gap-2 p-3">
          <label className="text-xs text-[var(--muted)]">
            Platform
            <select
              className="input mt-1 min-w-[140px]"
              value={platformSlug}
              onChange={(e) => setPlatformSlug(e.target.value)}
            >
              {platforms.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.display_name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--muted)]">
            Handle
            <input
              className="input mt-1 min-w-[180px]"
              placeholder="@handle"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void create()}
            />
          </label>
          <label className="text-xs text-[var(--muted)]">
            Client
            <select
              className="input mt-1 min-w-[150px]"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              <option value="">No client</option>
              {clients
                .filter((c) => !c.is_archived)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          <button className="btn-primary" onClick={create}>
            Add account
          </button>
        </div>
      )}

      {error && (
        <p className="mb-3 text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}

      {visible.length === 0 && (
        <div className="card p-10 text-center text-sm text-[var(--muted)]">
          No accounts yet. Add one per platform the client publishes to.
        </div>
      )}

      <div className="space-y-4">
        {platforms
          .filter((p) => byPlatform.has(p.slug))
          .map((p) => (
            <section key={p.slug}>
              <div className="mb-1.5 flex items-center gap-2 px-1">
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: PLATFORM_COLORS[p.slug] ?? "var(--muted)" }}
                />
                <h2 className="text-sm font-semibold">{p.display_name}</h2>
                <span className="text-xs text-[var(--muted)]">
                  {p.supports_public_read
                    ? "public metrics available"
                    : "manual entry only — no public metrics API"}
                </span>
                <span className="ml-auto text-xs text-[var(--muted)]">
                  {p.maturity_window_days}-day scoring window
                </span>
              </div>

              <div className="card divide-y divide-[var(--border)] overflow-hidden">
                {byPlatform.get(p.slug)!.map((a) => {
                  return (
                    <div
                      key={a.id}
                      className="group flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 transition-colors hover:bg-[var(--bg-subtle)]"
                    >
                      <span
                        className={`text-sm ${a.is_archived ? "line-through opacity-60" : ""}`}
                      >
                        {a.handle}
                      </span>
                      {canManage ? (
                        // The account->client link was fixed forever at
                        // creation; every client dashboard pivots on it, so
                        // it has to be correctable in place.
                        <select
                          className="max-w-[160px] cursor-pointer truncate rounded bg-transparent text-xs text-[var(--muted)] transition-colors hover:text-[var(--fg)] focus:outline-none"
                          value={a.client_id ?? ""}
                          onChange={async (e) => {
                            const res = await updateAccountClient(
                              a.id,
                              e.target.value || null,
                            );
                            if (res.error) toast("danger", res.error);
                            else toast("success", "Client updated.");
                            startTransition(() => router.refresh());
                          }}
                          aria-label={`Client for ${a.handle}`}
                        >
                          <option value="">No client</option>
                          {clients
                            .filter((c) => !c.is_archived || c.id === a.client_id)
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                        </select>
                      ) : (
                        a.client?.name && (
                          <span className="text-xs text-[var(--muted)]">
                            {a.client.name}
                          </span>
                        )
                      )}
                      <div className="flex-1" />

                      {/* Every account reads public metrics only; owner-only
                          figures arrive by client-supplied export, not by a
                          connection. What is worth saying per row is whether
                          this one refreshes itself, and whether doing so
                          spends money. */}
                      {(() => {
                        const f = fetchByPlatform[p.slug];
                        if (!f?.auto) {
                          return (
                            <span
                              className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-xs text-[var(--muted)]"
                              title="No automatic source for this platform — numbers are entered by hand"
                            >
                              Manual entry
                            </span>
                          );
                        }
                        if (!a.sync_enabled) {
                          return (
                            <span
                              className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-xs text-[var(--muted)]"
                              title="This account can sync automatically, but syncing is switched off for it"
                            >
                              Sync paused
                            </span>
                          );
                        }
                        return (
                          <span
                            className={`rounded px-1.5 py-0.5 text-xs ${
                              f.metered
                                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                                : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                            }`}
                            title={
                              f.metered
                                ? "Refreshes automatically through a paid vendor — each fetch spends credit"
                                : "Refreshes automatically on a free API quota"
                            }
                          >
                            {f.metered ? "Auto — metered" : "Auto — free"}
                          </span>
                        );
                      })()}

                      {canManage && (
                        <button
                          // "Restore" must be visible without hovering: on a
                          // struck-through row it is the one action someone is
                          // hunting for, and hover-reveal hides it entirely on
                          // touch. "Archive" on live rows stays hover-quiet.
                          className={`${a.is_archived ? "btn px-2 py-1" : "row-actions rounded px-2 py-1 text-[var(--muted)] hover:bg-[var(--border)] hover:text-[var(--fg)]"} text-xs transition-colors`}
                          onClick={() => void toggle(a)}
                        >
                          {a.is_archived ? "Restore" : "Archive"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
      </div>
    </>
  );
}
