"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createGroup, deleteGroup, setGroupMember, updateCapacity } from "@/app/actions";
import type { SeatType, WorkspaceRole } from "@/lib/types";

type Member = {
  id: string;
  userId: string;
  name: string;
  role: WorkspaceRole;
  seat: SeatType;
  isActive: boolean;
  capacityHours: number;
};
type Group = { id: string; name: string };
type GroupMember = { group_id: string; user_id: string };

const TABS = ["FULL", "LIMITED", "GROUPS"] as const;

export default function TeamManager({
  workspaceId,
  members,
  groups,
  groupMembers,
  canManage,
}: {
  workspaceId: string;
  members: Member[];
  groups: Group[];
  groupMembers: GroupMember[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState<(typeof TABS)[number]>("FULL");
  const [error, setError] = useState<string | null>(null);

  const refresh = () => startTransition(() => router.refresh());

  const filtered = useMemo(
    () => members.filter((m) => tab === "GROUPS" || m.seat === tab.toLowerCase()),
    [members, tab],
  );

  const groupsOf = (userId: string) =>
    groups.filter((g) => groupMembers.some((gm) => gm.group_id === g.id && gm.user_id === userId));

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

      {tab === "GROUPS" ? (
        <GroupsPanel
          workspaceId={workspaceId}
          members={members}
          groups={groups}
          groupMembers={groupMembers}
          canManage={canManage}
          setError={setError}
          refresh={refresh}
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Group</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Capacity / wk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filtered.map((m) => (
                <tr key={m.id} className="transition-colors hover:bg-[var(--bg-subtle)]">
                  <td
                    className={`px-3 py-2.5 ${m.isActive ? "" : "line-through opacity-60"}`}
                  >
                    {m.name}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-xs capitalize">
                      {m.role}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-[var(--muted)]">
                    {groupsOf(m.userId).map((g) => g.name).join(", ") || "—"}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-[var(--muted)]">
                    {m.isActive ? "Active" : "Deactivated"}
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
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-sm text-[var(--muted)]">
                    No {tab.toLowerCase()} members.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
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

function GroupsPanel({
  workspaceId,
  members,
  groups,
  groupMembers,
  canManage,
  setError,
  refresh,
}: {
  workspaceId: string;
  members: Member[];
  groups: Group[];
  groupMembers: GroupMember[];
  canManage: boolean;
  setError: (m: string | null) => void;
  refresh: () => void;
}) {
  const [name, setName] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <>
      {canManage && (
        <div className="card mb-4 flex items-end gap-2 p-3">
          <label className="text-xs text-[var(--muted)]">
            New group
            <input
              className="input mt-1 min-w-[180px]"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Editors, Contractors…"
            />
          </label>
          <button
            className="btn-primary"
            onClick={async () => {
              if (!name.trim()) return setError("Group name is required.");
              const res = await createGroup(workspaceId, name);
              if (res.error) return setError(res.error);
              setName("");
              setError(null);
              refresh();
            }}
          >
            Create
          </button>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="card p-8 text-center text-sm text-[var(--muted)]">
          No groups yet. Groups let reports and filters target a set of
          people at once instead of picking each person individually.
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => {
            const inGroup = new Set(
              groupMembers.filter((gm) => gm.group_id === g.id).map((gm) => gm.user_id),
            );
            return (
              <div key={g.id} className="card overflow-hidden">
                <button
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-[var(--bg-subtle)]"
                  onClick={() => setExpanded(expanded === g.id ? null : g.id)}
                >
                  <span className="text-sm font-medium">{g.name}</span>
                  <span className="text-xs text-[var(--muted)]">{inGroup.size} members</span>
                  <div className="flex-1" />
                  {canManage && (
                    <span
                      role="button"
                      tabIndex={0}
                      className="rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--danger)]"
                      onClick={async (e) => {
                        e.stopPropagation();
                        const res = await deleteGroup(g.id);
                        if (res.error) setError(res.error);
                        refresh();
                      }}
                    >
                      Delete
                    </span>
                  )}
                </button>
                {expanded === g.id && (
                  <div className="animate-rise divide-y divide-[var(--border)] border-t border-[var(--border)]">
                    {members.map((m) => (
                      <label
                        key={m.userId}
                        className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm"
                      >
                        <input
                          type="checkbox"
                          disabled={!canManage}
                          checked={inGroup.has(m.userId)}
                          onChange={async (e) => {
                            const res = await setGroupMember(g.id, m.userId, e.target.checked);
                            if (res.error) return setError(res.error);
                            refresh();
                          }}
                        />
                        {m.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
