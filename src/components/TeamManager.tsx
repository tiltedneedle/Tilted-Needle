"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Select from "@/components/ui/Select";
import {
  addMemberByEmail,
  removeMember,
  sendPasswordReset,
  setMemberActive,
  setMemberRole,
  updateCapacity,
} from "@/app/actions";
import type { SeatType, WorkspaceRole } from "@/lib/types";

type Member = {
  id: string;
  userId: string;
  name: string;
  role: WorkspaceRole;
  seat: SeatType;
  isActive: boolean;
  capacityHours: number;
  /**
   * From auth.users, which no RLS policy can reach -- so these arrive already
   * resolved by the server component. Null means the service role could not
   * read the account, not that the person has no email.
   *
   * There is deliberately no password field, here or anywhere. Supabase keeps
   * a one-way hash; the reset link is the only route back into an account.
   */
  email?: string | null;
  lastSignInAt?: string | null;
};

/**
 * GROUPS is gone from the tabs.
 *
 * user_groups and user_group_members were read and written by this page and
 * by nothing else in the codebase -- not permissions, not reports, not
 * filters, not billing. A member's "Group" was a label with no consequence
 * anywhere, which is worse than an absent feature: it invites people to
 * organise around a distinction the system does not act on.
 *
 * The tables and their CRUD actions are left in place, so nothing is lost if
 * groups are given a job later (scoping a report or a filter by team is the
 * obvious one). Until then the page does not claim they do something.
 */
const TABS = ["FULL", "LIMITED"] as const;

export default function TeamManager({
  workspaceId,
  members,
  canManage,
  isOwnerOrAdmin = false,
  selfUserId,
}: {
  workspaceId: string;
  members: Member[];
  canManage: boolean;
  /**
   * Removal is a level above the rest of this page. A manager can change a
   * role or capacity; taking someone off the workspace is owner-or-admin,
   * matching the memberships_delete policy that enforces it for real.
   */
  isOwnerOrAdmin?: boolean;
  /** Own row renders static -- no demoting or deactivating yourself. */
  selfUserId?: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState<(typeof TABS)[number]>("FULL");
  const [error, setError] = useState<string | null>(null);

  const refresh = () => startTransition(() => router.refresh());

  const filtered = useMemo(
    () => members.filter((m) => m.seat === tab.toLowerCase()),
    [members, tab],
  );

  return (
    <>
      <div className="mb-4 flex gap-1 border-b border-[var(--border)]">
        {TABS.map((t) => (
          <button
            key={t}
            className={`px-3 py-2 text-xs font-medium tracking-wide transition-colors ${
              tab === t
                ? "border-b-2 border-[var(--accent)] text-[var(--fg)]"
                : "text-[var(--muted)] hover:text-[var(--fg)]"
            }`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {error && (
        <p className="mb-3 text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}

      {(
        <>
          {canManage && (
            <AddMemberRow workspaceId={workspaceId} onError={setError} refresh={refresh} />
          )}
          {/* The card clips to its own rounded corners, so a table placed
              straight inside it gets clipped too -- with no way to reach what
              was cut. On a 375px phone this table measured 466px wide in a
              316px box: "Capacity / wk" was not merely cramped, it was
              unreachable. Every other table in the app already sits in a
              scroll wrapper; this was the one that missed it. */}
          <div className="card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-[10.5px] font-medium uppercase tracking-[0.06em] text-[var(--muted)]">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Account</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Capacity / wk</th>
                <th className="px-3 py-2 text-right font-medium">Access</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filtered.map((m) => {
                // Own and owner rows stay read-only: the server action
                // refuses both anyway; the UI just doesn't offer it.
                const editable = canManage && m.role !== "owner" && m.userId !== selfUserId;
                return (
                <tr key={m.id} className="transition-colors hover:bg-[var(--bg-subtle)]">
                  <td
                    className={`px-3 py-2.5 ${m.isActive ? "" : "line-through opacity-60"}`}
                  >
                    {m.name}
                  </td>
                  <td className="px-3 py-2.5">
                    {/* A member always HAS a role, so there is no clear row.
                        It used to render anyway and get swallowed by the
                        `if (!v) return` below -- a greyed "member" above the
                        three real options that looked like a fourth choice
                        and did nothing when clicked. The guard stays as a
                        belt-and-braces against writing "" over a role. */}
                    {editable ? (
                      <Select
                        className="max-w-[140px]"
                        value={m.role}
                        ariaLabel={`Role for ${m.name}`}
                        clearable={false}
                        onChange={async (v) => {
                          if (!v) return;
                          const res = await setMemberRole(m.id, v);
                          if (res.error) setError(res.error);
                          refresh();
                        }}
                        options={[
                          { value: "member", label: "member" },
                          { value: "manager", label: "manager" },
                          { value: "admin", label: "admin" },
                        ]}
                      />
                    ) : (
                      <span className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-xs capitalize">
                        {m.role}
                      </span>
                    )}
                  </td>
                  {/* Who this row actually IS. A roster of display names left
                      no way to tell which account a person holds, or whether
                      anyone had ever signed in with it -- both live in
                      auth.users, which no RLS policy can read, so the server
                      component resolves them with the service role.

                      Never a password. There is no such column to show. */}
                  <td className="px-3 py-2.5">
                    <div className="min-w-0 truncate text-xs text-[var(--muted)]" title={m.email ?? undefined}>
                      {m.email ?? "no email on file"}
                    </div>
                    <div className="text-[11px] text-[var(--muted)]">
                      {m.lastSignInAt
                        ? `last seen ${new Date(m.lastSignInAt).toLocaleDateString()}`
                        : "never signed in"}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {editable ? (
                      <button
                        className={`rounded px-2 py-1 transition-colors ${
                          m.isActive
                            ? "text-[var(--muted)] hover:bg-[var(--border)] hover:text-[var(--danger)]"
                            : "bg-[var(--success-100)] text-[var(--success)] hover:opacity-80"
                        }`}
                        onClick={async () => {
                          const res = await setMemberActive(m.id, !m.isActive);
                          if (res.error) setError(res.error);
                          refresh();
                        }}
                        title={
                          m.isActive
                            ? "Deactivate — removes access, keeps all their history"
                            : "Restore access"
                        }
                      >
                        {m.isActive ? "Deactivate" : "Reactivate"}
                      </button>
                    ) : (
                      <span className="text-[var(--muted)]">
                        {m.isActive ? "Active" : "Deactivated"}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {canManage ? (
                      <CapacityInput
                        membershipId={m.id}
                        value={m.capacityHours}
                        onError={setError}
                        refresh={refresh}
                      />
                    ) : (
                      <span className="tabular text-xs text-[var(--muted)]">
                        {m.capacityHours}h
                      </span>
                    )}
                  </td>
                  {/* Getting someone back in, and taking someone out -- the
                      two account operations that used to live nowhere, which
                      is why "deletion" had to happen in the Supabase console
                      and a forgotten password had no answer at all. */}
                  <td className="px-3 py-2.5 text-right">
                    {editable ? (
                      <AccessCell
                        member={m}
                        canRemove={isOwnerOrAdmin}
                        onError={setError}
                        refresh={refresh}
                      />
                    ) : (
                      <span className="text-xs text-[var(--muted)]">—</span>
                    )}
                  </td>
                </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-sm text-[var(--muted)]">
                    No {tab.toLowerCase()} members.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
          </div>
        </>
      )}
    </>
  );
}

/**
 * Adds an existing account to the workspace by email. No invite emails to
 * configure or break: signup is open on the login page, so the flow is
 * "they sign up, you add them" -- the action explains exactly that when
 * the email isn't found.
 */
/**
 * The two account operations: hand the account back, or take access away.
 *
 * WHY THERE IS NO "SHOW PASSWORD". Supabase stores a one-way hash. Nothing --
 * not this app, not the service role, not the Supabase dashboard -- can read
 * a user's password back. A reset link is the only honest answer to "they
 * cannot get in", and it has the property that no password is ever handled by
 * anyone but its owner.
 *
 * REMOVE is not delete-the-person. Time entries, role credits, to-dos and
 * training progress all hang off `profiles`, never off `memberships`, so
 * dropping the membership revokes access and leaves every record intact --
 * their hours still count and the videos they edited still say so. Deleting
 * the account would cascade through all of it, which is why nothing in this
 * app offers that.
 *
 * Confirmation is a second click on the same button rather than a dialog:
 * removal is reversible by re-adding the person, so the cost of a slip is a
 * re-add, not a loss. Deactivate, sitting one column left, remains the
 * gentler option and says so.
 */
function AccessCell({
  member,
  canRemove,
  onError,
  refresh,
}: {
  member: Member;
  canRemove: boolean;
  onError: (msg: string | null) => void;
  refresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sent, setSent] = useState(false);

  return (
    <span className="flex items-center justify-end gap-1">
      <button
        className="rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)] disabled:opacity-50"
        disabled={busy || sent || !member.email}
        title={
          member.email
            ? `Email ${member.email} a link to set a new password. Nobody, including you, can read their existing one.`
            : "No email on file for this account."
        }
        onClick={async () => {
          setBusy(true);
          onError(null);
          const res = await sendPasswordReset(member.id);
          setBusy(false);
          if (res.error) return onError(res.error);
          setSent(true);
        }}
      >
        {sent ? "Link sent" : busy ? "Sending…" : "Reset link"}
      </button>

      {canRemove &&
        (confirming ? (
          <span className="flex items-center gap-1">
            <button
              className="rounded bg-[var(--danger)]/15 px-2 py-1 text-xs font-medium text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/25 disabled:opacity-50"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                onError(null);
                const res = await removeMember(member.id);
                setBusy(false);
                if (res.error) {
                  setConfirming(false);
                  return onError(res.error);
                }
                refresh();
              }}
              title={`${member.name} loses access. Their tracked time and credits stay.`}
            >
              {busy ? "Removing…" : "Confirm"}
            </button>
            <button
              className="rounded px-1.5 py-1 text-xs text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            className="rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--danger)]"
            onClick={() => setConfirming(true)}
            title="Remove from this workspace — access only; their history is kept"
          >
            Remove
          </button>
        ))}
    </span>
  );
}

function AddMemberRow({
  workspaceId,
  onError,
  refresh,
}: {
  workspaceId: string;
  onError: (m: string) => void;
  refresh: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!email.trim()) return;
    setBusy(true);
    const res = await addMemberByEmail({ workspaceId, email, role });
    setBusy(false);
    if (res.error) return onError(res.error);
    onError("");
    setEmail("");
    refresh();
  }

  return (
    <div className="card mb-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input min-w-[220px] flex-1 py-1.5"
          type="email"
          placeholder="Add a member by email (they must have signed up first)"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void add();
          }}
          aria-label="Email of the account to add"
        />
        <Select
          className="max-w-[130px]"
          value={role}
          onChange={(v) => v && setRole(v)}
          placeholder="member"
          ariaLabel="Role for the new member"
          options={[
            { value: "member", label: "member" },
            { value: "manager", label: "manager" },
            { value: "admin", label: "admin" },
          ]}
        />
        <button
          className="btn-primary py-1.5"
          onClick={() => void add()}
          disabled={busy || !email.trim()}
        >
          {busy ? "Adding…" : "Add member"}
        </button>
      </div>
    </div>
  );
}

function CapacityInput({
  membershipId,
  value,
  onError,
  refresh,
}: {
  membershipId: string;
  value: number;
  onError: (m: string) => void;
  refresh: () => void;
}) {
  const [v, setV] = useState(String(value));
  return (
    <div className="flex items-center justify-end gap-1">
      <input
        className="input tabular w-16 py-1 text-right"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={async () => {
          if (v === String(value)) return;
          const res = await updateCapacity(membershipId, v);
          if (res.error) return onError(res.error);
          refresh();
        }}
      />
      <span className="text-xs text-[var(--muted)]">h</span>
    </div>
  );
}
