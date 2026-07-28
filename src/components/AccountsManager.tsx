"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAccount, setArchived } from "@/app/actions";
import { PLATFORM_COLORS } from "@/lib/types";
import type { Account, Client, Platform } from "@/lib/types";

type ConnectorStatus = { configured: boolean; missing: string[] };
type Connection = { account_id: string; status: string; connected_at: string };

export default function AccountsManager({
  workspaceId,
  accounts,
  platforms,
  clients,
  canManage,
  connections,
  connectorStatus,
}: {
  workspaceId: string;
  accounts: Account[];
  platforms: Platform[];
  clients: Client[];
  canManage: boolean;
  connections: Connection[];
  connectorStatus: Record<string, ConnectorStatus>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [handle, setHandle] = useState("");
  const [platformSlug, setPlatformSlug] = useState(platforms[0]?.slug ?? "");
  const [clientId, setClientId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const connectionByAccount = new Map(connections.map((c) => [c.account_id, c]));

  async function disconnect(a: Account) {
    setDisconnecting(a.id);
    try {
      const res = await fetch(`/api/oauth/${a.platform_slug}/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: a.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not disconnect.");
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setDisconnecting(null);
    }
  }

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
    await setArchived("accounts", a.id, !a.is_archived);
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
                    : p.auth_model === "oauth_review"
                      ? "needs client authorisation + app review"
                      : "needs client authorisation"}
                </span>
                <span className="ml-auto text-xs text-[var(--muted)]">
                  {p.maturity_window_days}-day scoring window
                </span>
              </div>

              <div className="card divide-y divide-[var(--border)] overflow-hidden">
                {byPlatform.get(p.slug)!.map((a) => {
                  const conn = connectionByAccount.get(a.id);
                  const cs = connectorStatus[p.slug];
                  const isConnected = a.connection_mode === "oauth" && conn?.status === "active";
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
                      {a.client?.name && (
                        <span className="text-xs text-[var(--muted)]">
                          {a.client.name}
                        </span>
                      )}
                      <div className="flex-1" />

                      {/* The label PRD section 4 requires: a client user
                          scoring by outcome alone must never look identical
                          to one with CTR/retention behind it. */}
                      {isConnected ? (
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs text-emerald-500">
                          Enhanced — connected
                        </span>
                      ) : (
                        <span className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-xs text-[var(--muted)]">
                          Baseline — public metrics only
                        </span>
                      )}

                      {canManage && !a.is_archived && (
                        <>
                          {isConnected ? (
                            <button
                              className="rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--danger)] disabled:opacity-50"
                              disabled={disconnecting === a.id}
                              onClick={() => void disconnect(a)}
                            >
                              {disconnecting === a.id ? "Disconnecting…" : "Disconnect"}
                            </button>
                          ) : cs?.configured ? (
                            <a
                              className="btn px-2 py-1 text-xs"
                              href={`/api/oauth/${p.slug}/connect?account_id=${a.id}`}
                            >
                              Connect
                            </a>
                          ) : (
                            <span
                              className="rounded px-2 py-1 text-xs text-[var(--muted)] opacity-60"
                              title={`Needs ${cs?.missing.join(" and ")} set on the server`}
                            >
                              Connect (not configured)
                            </span>
                          )}
                        </>
                      )}

                      {canManage && (
                        <button
                          className="row-actions rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--fg)]"
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
