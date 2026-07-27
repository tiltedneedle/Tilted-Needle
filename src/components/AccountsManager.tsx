"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAccount, setArchived } from "@/app/actions";
import { PLATFORM_COLORS } from "@/lib/types";
import type { Account, Client, Platform } from "@/lib/types";

export default function AccountsManager({
  workspaceId,
  accounts,
  platforms,
  clients,
  canManage,
}: {
  workspaceId: string;
  accounts: Account[];
  platforms: Platform[];
  clients: Client[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [handle, setHandle] = useState("");
  const [platformSlug, setPlatformSlug] = useState(platforms[0]?.slug ?? "");
  const [clientId, setClientId] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = accounts.filter((a) => (showArchived ? true : !a.is_archived));

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
          <div className="flex-1" />
          <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--muted)]">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived
          </label>
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
                {byPlatform.get(p.slug)!.map((a) => (
                  <div
                    key={a.id}
                    className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--bg-subtle)]"
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
                    {/* Manual is a first-class mode, not a degraded one: the
                        pipeline is identical either way (PRD 9.5). */}
                    <span className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-xs capitalize text-[var(--muted)]">
                      {a.connection_mode}
                    </span>
                    {canManage && (
                      <button
                        className="row-actions rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--fg)]"
                        onClick={() => void toggle(a)}
                      >
                        {a.is_archived ? "Restore" : "Archive"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
      </div>
    </>
  );
}
