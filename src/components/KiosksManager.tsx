"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Select from "@/components/ui/Select";
import { createKiosk, setMemberKioskPin, toggleKiosk } from "@/app/actions";

type Kiosk = {
  id: string;
  name: string;
  deviceToken: string;
  projectName: string | null;
  isActive: boolean;
};
type Member = { id: string; name: string; hasPin: boolean };

export default function KiosksManager({
  workspaceId,
  kiosks,
  projects,
  members,
}: {
  workspaceId: string;
  kiosks: Kiosk[];
  projects: { id: string; name: string }[];
  members: Member[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = () => startTransition(() => router.refresh());

  const kioskUrl = (token: string) =>
    typeof window === "undefined" ? "" : `${window.location.origin}/kiosk/${token}`;

  return (
    <>
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold">Devices</h2>
        <div className="card mb-3 flex flex-wrap items-end gap-2 p-3">
          <label className="text-xs text-[var(--muted)]">
            Name
            <input
              className="input mt-1 min-w-[160px]"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Front Desk"
            />
          </label>
          <label className="text-xs text-[var(--muted)]">
            Project
            {/* A kiosk pinned to no project clocks general time, which is a
                real setup, so the clear row means what it says. */}
            <Select
              className="mt-1 min-w-[150px]"
              value={projectId}
              onChange={setProjectId}
              placeholder="No project"
              ariaLabel="Project"
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
            />
          </label>
          <button
            className="btn-primary"
            onClick={async () => {
              const res = await createKiosk(workspaceId, name, projectId || null);
              if (res.error) return setError(res.error);
              setName("");
              setError(null);
              refresh();
            }}
          >
            Add device
          </button>
        </div>

        {error && (
          <p className="mb-3 text-sm text-[var(--danger)]" role="alert">
            {error}
          </p>
        )}

        {kiosks.length === 0 ? (
          <div className="empty">
            No kiosk devices yet.
          </div>
        ) : (
          <div className="card divide-y divide-[var(--border)] overflow-hidden">
            {kiosks.map((k) => (
              <div key={k.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                <span className={`text-sm ${k.isActive ? "" : "line-through opacity-60"}`}>
                  {k.name}
                </span>
                {k.projectName && (
                  <span className="text-xs text-[var(--muted)]">{k.projectName}</span>
                )}
                <div className="flex-1" />
                <button
                  className="rounded bg-[var(--bg-subtle)] px-2 py-1 text-xs transition-colors hover:bg-[var(--border)]"
                  onClick={() => {
                    navigator.clipboard.writeText(kioskUrl(k.deviceToken));
                    setCopied(k.id);
                    setTimeout(() => setCopied(null), 1500);
                  }}
                >
                  {copied === k.id ? "Copied" : "Copy device link"}
                </button>
                <button
                  className="btn px-2 py-1 text-xs"
                  onClick={async () => {
                    await toggleKiosk(k.id, !k.isActive);
                    refresh();
                  }}
                >
                  {k.isActive ? "Deactivate" : "Reactivate"}
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="mt-1.5 text-xs text-[var(--muted)]">
          Open a device&apos;s link on the shared tablet or computer at that
          location. It stays signed in to that one device; no account login
          is needed there.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Member PINs</h2>
        <div className="card divide-y divide-[var(--border)] overflow-hidden">
          {members.map((m) => (
            <MemberPinRow key={m.id} member={m} onError={setError} refresh={refresh} />
          ))}
        </div>
        <p className="mt-1.5 text-xs text-[var(--muted)]">
          A PIN is not the member&apos;s account password -- it only works at
          a kiosk device, and only to clock in or out.
        </p>
      </section>
    </>
  );
}

function MemberPinRow({
  member,
  onError,
  refresh,
}: {
  member: Member;
  onError: (m: string) => void;
  refresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [pin, setPin] = useState("");

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <span className="flex-1 text-sm">{member.name}</span>
      {editing ? (
        <>
          <input
            className="input tabular w-24 py-1"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            placeholder="4-8 digits"
            maxLength={8}
          />
          <button
            className="btn-primary px-2 py-1 text-xs"
            onClick={async () => {
              const res = await setMemberKioskPin(member.id, pin);
              if (res.error) return onError(res.error);
              setEditing(false);
              setPin("");
              refresh();
            }}
          >
            Save
          </button>
          <button className="btn px-2 py-1 text-xs" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <span className="text-xs text-[var(--muted)]">
            {member.hasPin ? "PIN set" : "No PIN"}
          </span>
          <button className="btn px-2 py-1 text-xs" onClick={() => setEditing(true)}>
            {member.hasPin ? "Change" : "Set"} PIN
          </button>
        </>
      )}
    </div>
  );
}
