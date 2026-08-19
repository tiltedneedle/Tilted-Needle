"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createApiKey,
  createWebhook,
  deleteWebhook,
  revokeApiKey,
  toggleWebhook,
} from "@/app/actions";

type ApiKey = {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};
type Webhook = {
  id: string;
  url: string;
  events: string[];
  is_active: boolean;
  created_at: string;
};

export default function DevelopersManager({
  workspaceId,
  apiKeys,
  webhooks,
  availableEvents,
}: {
  workspaceId: string;
  apiKeys: ApiKey[];
  webhooks: Webhook[];
  availableEvents: string[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  const [keyName, setKeyName] = useState("");
  const [hookUrl, setHookUrl] = useState("");
  const [hookEvents, setHookEvents] = useState<string[]>([]);

  const refresh = () => startTransition(() => router.refresh());

  return (
    <>
      {error && (
        <p className="mb-3 text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold">API keys</h2>

        {revealedKey && (
          <div className="card animate-rise mb-3 p-3">
            <p className="mb-1 text-xs text-[var(--muted)]">
              Copy this now -- it will not be shown again.
            </p>
            <code className="block break-all rounded bg-[var(--bg-subtle)] px-2 py-1.5 text-xs">
              {revealedKey}
            </code>
            <button className="btn mt-2 px-2 py-1 text-xs" onClick={() => setRevealedKey(null)}>
              Done
            </button>
          </div>
        )}

        <div className="card mb-3 flex items-end gap-2 p-3">
          <label className="text-xs text-[var(--muted)]">
            Name
            <input
              className="input mt-1 min-w-[180px]"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder="Reporting integration"
            />
          </label>
          <button
            className="btn-primary"
            onClick={async () => {
              const res = await createApiKey(workspaceId, keyName);
              if (res.error) return setError(res.error);
              setError(null);
              setKeyName("");
              if (res.key) setRevealedKey(res.key);
              refresh();
            }}
          >
            Create key
          </button>
        </div>

        {apiKeys.length === 0 ? (
          <div className="empty">
            No API keys yet.
          </div>
        ) : (
          <div className="card divide-y divide-[var(--border)] overflow-hidden">
            {apiKeys.map((k) => (
              <div key={k.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className={`text-sm ${k.revoked_at ? "line-through opacity-60" : ""}`}>
                  {k.name}
                </span>
                <code className="text-xs text-[var(--muted)]">{k.key_prefix}…</code>
                <span className="text-xs text-[var(--muted)]">
                  {k.last_used_at ? `last used ${new Date(k.last_used_at).toLocaleDateString()}` : "never used"}
                </span>
                <div className="flex-1" />
                {!k.revoked_at && (
                  <button
                    className="rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--danger)]"
                    onClick={async () => {
                      /* A revoke reported success whatever happened. The row
                         redrew from the server, so a REFUSED revoke left the
                         key visibly un-revoked -- but nothing said why, and
                         the operator has already moved on believing the
                         credential is dead. It is not. */
                      const res = await revokeApiKey(k.id);
                      if (res?.error) return setError(res.error);
                      setError(null);
                      refresh();
                    }}
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="mt-1.5 text-xs text-[var(--muted)]">
          <code>Authorization: Bearer &lt;key&gt;</code> against{" "}
          <code>/api/v1/time-entries</code> and <code>/api/v1/content</code>.
          Read-only.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Webhooks</h2>

        {revealedSecret && (
          <div className="card animate-rise mb-3 p-3">
            <p className="mb-1 text-xs text-[var(--muted)]">
              Signing secret -- copy this now, it will not be shown again.
              Verify deliveries with HMAC-SHA256 against the raw request body.
            </p>
            <code className="block break-all rounded bg-[var(--bg-subtle)] px-2 py-1.5 text-xs">
              {revealedSecret}
            </code>
            <button className="btn mt-2 px-2 py-1 text-xs" onClick={() => setRevealedSecret(null)}>
              Done
            </button>
          </div>
        )}

        <div className="card mb-3 space-y-2 p-3">
          <input
            className="input"
            value={hookUrl}
            onChange={(e) => setHookUrl(e.target.value)}
            placeholder="https://example.com/webhooks/tilted-needle"
          />
          <div className="flex flex-wrap gap-2">
            {availableEvents.map((ev) => (
              <label key={ev} className="flex cursor-pointer items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={hookEvents.includes(ev)}
                  onChange={(e) =>
                    setHookEvents(
                      e.target.checked
                        ? [...hookEvents, ev]
                        : hookEvents.filter((x) => x !== ev),
                    )
                  }
                />
                {ev}
              </label>
            ))}
          </div>
          <button
            className="btn-primary"
            onClick={async () => {
              const res = await createWebhook({ workspaceId, url: hookUrl, events: hookEvents });
              if (res.error) return setError(res.error);
              setError(null);
              setHookUrl("");
              setHookEvents([]);
              if (res.secret) setRevealedSecret(res.secret);
              refresh();
            }}
          >
            Add webhook
          </button>
        </div>

        {webhooks.length === 0 ? (
          <div className="empty">
            No webhooks yet.
          </div>
        ) : (
          <div className="card divide-y divide-[var(--border)] overflow-hidden">
            {webhooks.map((w) => (
              <div key={w.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="max-w-[260px] truncate text-sm">{w.url}</span>
                <span className="text-xs text-[var(--muted)]">
                  {w.events.join(", ")}
                </span>
                <div className="flex-1" />
                <button
                  className={`rounded px-2 py-0.5 text-xs ${
                    w.is_active
                      ? "bg-[var(--success)]/15 text-[var(--success)]"
                      : "bg-[var(--bg-subtle)] text-[var(--muted)]"
                  }`}
                  onClick={async () => {
                    const res = await toggleWebhook(w.id, !w.is_active);
                    if (res.error) setError(res.error);
                    refresh();
                  }}
                >
                  {w.is_active ? "Active" : "Paused"}
                </button>
                <button
                  className="rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--danger)]"
                  onClick={async () => {
                    const res = await deleteWebhook(w.id);
                    if (res.error) setError(res.error);
                    refresh();
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
