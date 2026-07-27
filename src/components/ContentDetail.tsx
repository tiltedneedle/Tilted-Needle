"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addPlatformPost,
  assignRole,
  deletePlatformPost,
  recordSnapshot,
  unassignRole,
  updatePlatformPost,
} from "@/app/actions";
import { formatDurationShort } from "@/lib/format";
import { PLATFORM_COLORS, one } from "@/lib/types";
import type {
  Account,
  ContentAssignment,
  ContentItem,
  PlatformPost,
  Role,
} from "@/lib/types";

export default function ContentDetail({
  workspaceId,
  item,
  posts,
  accounts,
  roles,
  assignments,
  members,
  trackedSeconds,
}: {
  workspaceId: string;
  item: ContentItem;
  posts: PlatformPost[];
  accounts: Account[];
  roles: Role[];
  assignments: ContentAssignment[];
  members: { userId: string; name: string }[];
  trackedSeconds: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [addAccountId, setAddAccountId] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    views: "",
    likes: "",
    comments: "",
    shares: "",
    saves: "",
  });

  const refresh = () => startTransition(() => router.refresh());

  const unusedAccounts = accounts.filter(
    (a) => !posts.some((p) => p.account_id === a.id),
  );

  async function attach() {
    if (!addAccountId) return;
    const res = await addPlatformPost({
      workspaceId,
      contentItemId: item.id,
      accountId: addAccountId,
      url: null,
      postedAt: item.produced_at,
    });
    if (res.error) return setError(res.error);
    setAddAccountId("");
    refresh();
  }

  async function saveMetrics(postId: string) {
    const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(/,/g, "")));
    const res = await recordSnapshot({
      workspaceId,
      platformPostId: postId,
      views: num(draft.views),
      likes: num(draft.likes),
      comments: num(draft.comments),
      shares: num(draft.shares),
      saves: num(draft.saves),
    });
    if (res.error) return setError(res.error);
    setEditing(null);
    setDraft({ views: "", likes: "", comments: "", shares: "", saves: "" });
    refresh();
  }

  return (
    <>
      <div className="mb-1 flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{item.title}</h1>
        {item.client?.name && (
          <span className="text-sm text-[var(--muted)]">{item.client.name}</span>
        )}
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-3 text-sm text-[var(--muted)]">
        {item.produced_at && <span>{item.produced_at}</span>}
        {item.length_seconds != null && (
          <span className="tabular">
            {Math.floor(item.length_seconds / 60)}:
            {String(item.length_seconds % 60).padStart(2, "0")}
          </span>
        )}
        <span>
          Tracked time{" "}
          <span className="tabular font-medium text-[var(--fg)]">
            {trackedSeconds ? formatDurationShort(trackedSeconds) : "—"}
          </span>
        </span>
      </div>

      {(item.subject || item.hook) && (
        <div className="card mb-5 space-y-2 p-3 text-sm">
          {item.subject && (
            <div>
              <span className="text-xs uppercase tracking-wide text-[var(--muted)]">
                Subject
              </span>
              <p className="mt-0.5">{item.subject}</p>
            </div>
          )}
          {item.hook && (
            <div>
              <span className="text-xs uppercase tracking-wide text-[var(--muted)]">
                Hook
              </span>
              <p className="mt-0.5 italic">{item.hook}</p>
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="mb-3 text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}

      {/* Per-platform performance. Never totalled: a view is a different unit
          on every platform, so a combined figure would be meaningless
          (PRD 5 Step 2). */}
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Performance by platform</h2>
        <span className="text-xs text-[var(--muted)]">
          Not totalled — each platform counts a view differently
        </span>
      </div>

      <div className="mb-3 space-y-2">
        {posts.length === 0 && (
          <div className="card p-8 text-center text-sm text-[var(--muted)]">
            Not posted anywhere yet.
          </div>
        )}

        {posts.map((p) => {
          const slug = one(p.account)?.platform_slug ?? "unknown";
          const m = one(p.metrics);
          const isEditing = editing === p.id;
          return (
            <div key={p.id} className="card group p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: PLATFORM_COLORS[slug] ?? "var(--muted)" }}
                />
                <span className="text-sm font-medium capitalize">{slug}</span>
                <span className="text-xs text-[var(--muted)]">
                  {one(p.account)?.handle}
                </span>
                <span className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-xs capitalize text-[var(--muted)]">
                  {p.source}
                </span>

                <button
                  className={`rounded px-1.5 py-0.5 text-xs transition-colors ${
                    p.is_best_performing
                      ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                      : "text-[var(--muted)] hover:bg-[var(--border)]"
                  }`}
                  onClick={async () => {
                    await updatePlatformPost(p.id, {
                      is_best_performing: !p.is_best_performing,
                    });
                    refresh();
                  }}
                >
                  ★ Best
                </button>

                <div className="flex-1" />

                {!isEditing && (
                  <>
                    <button
                      className="btn px-2 py-1 text-xs"
                      onClick={() => {
                        setEditing(p.id);
                        setDraft({
                          views: m?.views != null ? String(m.views) : "",
                          likes: m?.likes != null ? String(m.likes) : "",
                          comments: m?.comments != null ? String(m.comments) : "",
                          shares: m?.shares != null ? String(m.shares) : "",
                          saves: m?.saves != null ? String(m.saves) : "",
                        });
                      }}
                    >
                      Update metrics
                    </button>
                    <button
                      className="row-actions rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--danger)]"
                      onClick={async () => {
                        await deletePlatformPost(p.id);
                        refresh();
                      }}
                    >
                      Remove
                    </button>
                  </>
                )}
              </div>

              {isEditing ? (
                <div className="animate-rise mt-2 flex flex-wrap items-end gap-2">
                  {(["views", "likes", "comments", "shares", "saves"] as const).map(
                    (k) => (
                      <label key={k} className="text-xs capitalize text-[var(--muted)]">
                        {k}
                        <input
                          className="input tabular mt-1 w-24 py-1"
                          value={draft[k]}
                          onChange={(e) =>
                            setDraft({ ...draft, [k]: e.target.value })
                          }
                        />
                      </label>
                    ),
                  )}
                  <button
                    className="btn-primary py-1.5"
                    onClick={() => void saveMetrics(p.id)}
                  >
                    Save
                  </button>
                  <button className="btn py-1.5" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                  <p className="w-full text-xs text-[var(--muted)]">
                    Saved as a new snapshot — earlier figures are kept so scoring
                    can evaluate at a fixed maturity window.
                  </p>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  {m ? (
                    <>
                      <Metric label="Views" value={m.views} />
                      <Metric label="Likes" value={m.likes} />
                      <Metric label="Comments" value={m.comments} />
                      <Metric label="Shares" value={m.shares} />
                      <Metric label="Saves" value={m.saves} />
                    </>
                  ) : (
                    <span className="text-sm text-[var(--muted)]">
                      No metrics recorded yet.
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {unusedAccounts.length > 0 && (
        <div className="mb-6 flex items-center gap-2">
          <select
            className="input max-w-[240px]"
            value={addAccountId}
            onChange={(e) => setAddAccountId(e.target.value)}
          >
            <option value="">Add to a platform…</option>
            {unusedAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.platform_slug} — {a.handle}
              </option>
            ))}
          </select>
          <button className="btn" onClick={attach} disabled={!addAccountId}>
            Attach
          </button>
        </div>
      )}

      <h2 className="mb-2 text-sm font-semibold">Credits</h2>
      <div className="card divide-y divide-[var(--border)] overflow-hidden">
        {roles.map((role) => {
          const holders = assignments.filter((a) => a.role_id === role.id);
          return (
            <div key={role.id} className="flex items-center gap-3 px-3 py-2">
              <span className="w-32 shrink-0 text-sm text-[var(--muted)]">
                {role.name}
              </span>
              <div className="flex flex-1 flex-wrap gap-1.5">
                {holders.map((h) => (
                  <span
                    key={h.id}
                    className="group/chip flex items-center gap-1 rounded bg-[var(--bg-subtle)] px-2 py-0.5 text-xs"
                  >
                    {h.profile?.full_name ?? "Unknown"}
                    <button
                      className="opacity-0 transition-opacity group-hover/chip:opacity-100"
                      onClick={async () => {
                        await unassignRole(h.id);
                        refresh();
                      }}
                      aria-label="Remove"
                    >
                      ×
                    </button>
                  </span>
                ))}
                {holders.length === 0 && (
                  <span className="text-xs text-[var(--muted)]">Unassigned</span>
                )}
              </div>
              <select
                className="input max-w-[150px] py-1 text-xs"
                value=""
                onChange={async (e) => {
                  if (!e.target.value) return;
                  const res = await assignRole({
                    workspaceId,
                    contentItemId: item.id,
                    userId: e.target.value,
                    roleId: role.id,
                  });
                  if (res.error) setError(res.error);
                  refresh();
                }}
              >
                <option value="">Assign…</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-[var(--muted)]">
        Credits can also be derived from tracked time rather than entered by
        hand — see PRD §3.5.
      </p>
    </>
  );
}

function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <span>
      <span className="text-xs text-[var(--muted)]">{label} </span>
      <span className="tabular font-medium">
        {value != null ? value.toLocaleString() : "—"}
      </span>
    </span>
  );
}
