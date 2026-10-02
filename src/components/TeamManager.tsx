"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Select from "@/components/ui/Select";
import {
  inviteClientUser,
  inviteMember,
  removeMember,
  resendInvite,
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
  /**
   * Set only on a client user: the one client their account is bound to.
   * The name is null when that client has since been archived or binned.
   */
  clientId?: string | null;
  clientName?: string | null;
};

type ClientOption = { id: string; name: string };

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
 *
 * CLIENTS is its own tab, not a role among the others. A client user is
 * someone outside the company: one of a client's own people, whose account
 * shows them that client's delivered work and their client system on the
 * portal, and nothing of anyone else's. They are not staff with a smaller
 * seat, so they never appear under FULL or LIMITED, have no capacity, and
 * cannot be given a staff role from a dropdown.
 */
const TABS = ["FULL", "LIMITED", "CLIENTS"] as const;

export default function TeamManager({
  workspaceId,
  members,
  clients = [],
  portalHost = null,
  canManage,
  isOwnerOrAdmin = false,
  selfUserId,
}: {
  workspaceId: string;
  members: Member[];
  /** The clients a client user can be bound to. */
  clients?: ClientOption[];
  /** The client system portal's host, when this deployment knows it. */
  portalHost?: string | null;
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

  const onClients = tab === "CLIENTS";
  const filtered = useMemo(
    () =>
      members.filter((m) =>
        tab === "CLIENTS" ? m.role === "client" : m.role !== "client" && m.seat === tab.toLowerCase(),
      ),
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
          {canManage &&
            (onClients ? (
              <ClientInviteRow
                workspaceId={workspaceId}
                clients={clients}
                portalHost={portalHost}
                onError={setError}
                refresh={refresh}
              />
            ) : (
              <InviteRow workspaceId={workspaceId} onError={setError} refresh={refresh} />
            ))}
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
                {/* In the order the cells below are in. "Account" and "Role"
                    were the other way round: the role picker sat under
                    "Account" and the email under "Role". */}
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">{onClients ? "Client" : "Role"}</th>
                <th className="px-3 py-2 font-medium">Account</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">{onClients ? "Portal id" : "Capacity / wk"}</th>
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
                    {m.role === "client" ? (
                      // Which client, never a role picker: a dropdown here
                      // would be one slip from making an outsider staff.
                      <span className="text-xs">
                        {m.clientName ?? <span className="text-[var(--muted)]">a client no longer listed</span>}
                      </span>
                    ) : editable ? (
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
                    {m.role === "client" ? (
                      // No capacity: a client user is nobody's working week.
                      // What goes here instead is the id the portal knows
                      // their client by.
                      m.clientId ? <CopyId id={m.clientId} /> : <span className="text-xs text-[var(--muted)]">—</span>
                    ) : canManage ? (
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
                    {onClients ? "No client users yet." : `No ${tab.toLowerCase()} members.`}
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
 * Invite someone by email. This is the ONLY way an account is created: there
 * is no sign-up form, so every account in the project is one an owner, admin
 * or manager vouched for here. An address that already has an account is
 * simply added; a new one gets an invite link and chooses its own password.
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
      {/* ONE button, named for the person's state. Someone who has never
          signed in holds an invite that may have expired, so the useful act
          is to send it again; someone who has signed in needs a password
          reset. Offering both would put a link that SETS a password one
          click from an active account. */}
      {(() => {
        const pending = !member.lastSignInAt;
        return (
          <button
            className="rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)] disabled:opacity-50"
            disabled={busy || sent || !member.email}
            title={
              !member.email
                ? "No email on file for this account."
                : pending
                  ? `Send ${member.email} a fresh invite link. They choose their own password from it.`
                  : `Email ${member.email} a link to set a new password. Nobody, including you, can read their existing one.`
            }
            onClick={async () => {
              setBusy(true);
              onError(null);
              const res = pending ? await resendInvite(member.id) : await sendPasswordReset(member.id);
              setBusy(false);
              if (res.error) return onError(res.error);
              setSent(true);
            }}
          >
            {sent ? (pending ? "Invite sent" : "Link sent") : busy ? "Sending…" : pending ? "Resend invite" : "Reset link"}
          </button>
        );
      })()}

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

function InviteRow({
  workspaceId,
  onError,
  refresh,
}: {
  workspaceId: string;
  onError: (m: string) => void;
  refresh: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function invite() {
    if (!email.trim()) return;
    setBusy(true);
    setNotice(null);
    const res = await inviteMember({ workspaceId, email, fullName: name, role });
    setBusy(false);
    if (res.error) return onError(res.error);
    onError("");
    setNotice(
      res.outcome === "invited"
        ? `Invite sent to ${email.trim()}. They choose their own password from the link and land here as ${role}.`
        : `${email.trim()} already had an account — added as ${role}.`,
    );
    setName("");
    setEmail("");
    refresh();
  }

  return (
    <div className="card mb-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input min-w-[150px] flex-1 py-1.5"
          placeholder="Full name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          aria-label="Full name of the person to invite"
        />
        <input
          className="input min-w-[220px] flex-[2] py-1.5"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void invite();
          }}
          autoComplete="off"
          aria-label="Email of the person to invite"
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
          onClick={() => void invite()}
          disabled={busy || !email.trim()}
        >
          {busy ? "Inviting…" : "Invite"}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-[var(--muted)]">
        {notice ??
          "The only way an account gets made. They receive a link, set their own password, and open the app already in this workspace at the role you chose."}
      </p>
    </div>
  );
}

/**
 * Invite one of a client's own people. Its own row, not a fourth role in the
 * staff invite: the two acts differ in everything that matters. This one
 * needs a client, and makes an account that sees that client's work and
 * nothing else; choosing "client" from a list of staff roles, with the
 * client an afterthought, is how an outsider ends up invited as a member.
 *
 * The same account signs them in to the client system portal. The id the
 * portal knows the client by is shown as soon as a client is chosen, since
 * the portal has to be told it once (README there: `--ops-client`).
 */
function ClientInviteRow({
  workspaceId,
  clients,
  portalHost,
  onError,
  refresh,
}: {
  workspaceId: string;
  clients: ClientOption[];
  portalHost: string | null;
  onError: (m: string) => void;
  refresh: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [clientId, setClientId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function invite() {
    if (!email.trim() || !clientId) return;
    setBusy(true);
    setNotice(null);
    const res = await inviteClientUser({ workspaceId, email, fullName: name, clientId });
    setBusy(false);
    if (res.error) return onError(res.error);
    onError("");
    const where =
      res.landsOn === "portal"
        ? `on the portal${portalHost ? ` (${portalHost})` : ""}`
        : "in this app, then they sign in to the portal with the same email and password";
    setNotice(
      res.outcome === "invited"
        ? `Invite sent to ${email.trim()} for ${res.clientName}. They choose their own password ${where}.`
        : `${email.trim()} already had an account — now a client user of ${res.clientName}. No email was sent.`,
    );
    setName("");
    setEmail("");
    refresh();
  }

  if (clients.length === 0) {
    return (
      <div className="card mb-3 p-3 text-xs text-[var(--muted)]">
        Add a client first (Clients). A client user is always one client&apos;s.
      </div>
    );
  }

  return (
    <div className="card mb-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input min-w-[150px] flex-1 py-1.5"
          placeholder="Full name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          aria-label="Full name of the client's person to invite"
        />
        <input
          className="input min-w-[220px] flex-[2] py-1.5"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void invite();
          }}
          autoComplete="off"
          aria-label="Email of the client's person to invite"
        />
        <Select
          className="max-w-[200px]"
          value={clientId}
          onChange={(v) => setClientId(v ?? "")}
          placeholder="Which client"
          ariaLabel="The client this person belongs to"
          options={clients.map((c) => ({ value: c.id, label: c.name }))}
        />
        <button
          className="btn-primary py-1.5"
          onClick={() => void invite()}
          disabled={busy || !email.trim() || !clientId}
        >
          {busy ? "Inviting…" : "Invite client"}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-[var(--muted)]">
        {notice ??
          "For a client's own people. They see that client's delivered work and their client system on the portal, and nothing of anyone else's. They receive a link and set their own password."}
      </p>
      {clientId && (
        <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]">
          The portal knows this client by <CopyId id={clientId} />
        </p>
      )}
    </div>
  );
}

/**
 * A client's id, short enough to sit in a table and copied whole. It is not
 * a secret (it opens nothing by itself); it is what the client system
 * portal is given, once, to know which client an account belongs to.
 */
function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="rounded px-1.5 py-0.5 font-mono text-[11px] text-[var(--muted)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)]"
      title={`${id} — copy for the client system portal (--ops-client)`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(id);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // No clipboard access: the full id is in the tooltip.
        }
      }}
    >
      {copied ? "copied" : `${id.slice(0, 8)}… copy`}
    </button>
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
