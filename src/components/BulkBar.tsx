"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Merge, X } from "lucide-react";
import Select from "@/components/ui/Select";
import {
  bulkAssignRole,
  bulkSetClient,
  mergeContentItems,
  type ClientAssignment,
} from "@/app/actions";
import { useToast } from "@/components/ui/Toast";
import type { TileMember, TileRole } from "@/components/VideoTile";

/**
 * Sentinel for "take these off their client".
 *
 * Not the empty string, because the empty string is what an untouched select
 * holds -- and conflating the two is precisely how three videos were
 * unassigned by pressing Move without choosing anything.
 */
const CLEAR_CLIENT = "__clear__";

/**
 * What you can do to several videos at once, as a bar that appears when
 * something is selected.
 *
 * Deliberately not a page and not a mode you navigate into: it appears over
 * the list you are already reading, and it goes away when you clear the
 * selection. The whole point of the feature is to avoid opening 255 videos one
 * at a time; making people open a separate screen to avoid opening screens
 * would be a poor joke.
 *
 * MERGE IS THE DANGEROUS ONE and is treated differently from the rest. It
 * deletes rows, so it asks which title survives before doing anything, and it
 * says plainly what will happen. Everything else here is additive and
 * reversible by repeating the action with a different value.
 */
export default function BulkBar({
  workspaceId,
  selected,
  titles,
  roles,
  members,
  clients,
  onClear,
  onUndoableMove,
}: {
  workspaceId: string;
  selected: string[];
  /** id -> title, for the merge survivor picker. */
  titles: Record<string, string>;
  roles: TileRole[];
  members: TileMember[];
  clients: { id: string; name: string }[];
  onClear: () => void;
  /**
   * Hands the parent what a move overwrote, so it can offer to take it back.
   *
   * It has to leave this component: finishing a move clears the selection,
   * which is what makes this bar disappear -- an undo living here would
   * vanish at the exact moment it became useful.
   */
  onUndoableMove?: (undo: { label: string; previous: ClientAssignment[] }) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [roleId, setRoleId] = useState("");
  const [userId, setUserId] = useState("");
  const [clientId, setClientId] = useState("");
  const [merging, setMerging] = useState(false);
  const [survivor, setSurvivor] = useState("");

  const done = (msg: string) => {
    toast("success", msg);
    onClear();
    startTransition(() => router.refresh());
  };

  async function assign() {
    if (!roleId || !userId) return;
    setBusy(true);
    const res = await bulkAssignRole({ workspaceId, contentItemIds: selected, userId, roleId });
    setBusy(false);
    if (res.error) return toast("danger", res.error);
    const name = members.find((m) => m.userId === userId)?.name ?? "Someone";
    const role = roles.find((r) => r.id === roleId)?.name ?? "that role";
    done(`${name} credited as ${role} on ${res.added ?? 0} video${res.added === 1 ? "" : "s"}.`);
  }

  async function setClient() {
    // Guarded, not just disabled: the button below cannot be pressed without
    // a choice, but this is the function that actually clears data.
    if (!clientId) return;
    const target = clientId === CLEAR_CLIENT ? null : clientId;
    setBusy(true);
    const res = await bulkSetClient({ workspaceId, contentItemIds: selected, clientId: target });
    setBusy(false);
    if (res.error) return toast("danger", res.error);
    const where = target
      ? `to ${clients.find((c) => c.id === target)?.name ?? "that client"}`
      : "out of their client";
    const n = res.updated ?? 0;
    if (res.previous?.length) {
      onUndoableMove?.({ label: `${n} video${n === 1 ? "" : "s"} moved ${where}.`, previous: res.previous });
    }
    done(`${n} video${n === 1 ? "" : "s"} moved ${where}.`);
  }

  async function merge() {
    if (!survivor) return;
    setBusy(true);
    const res = await mergeContentItems({
      survivorId: survivor,
      loserIds: selected.filter((id) => id !== survivor),
      title: titles[survivor],
    });
    setBusy(false);
    // The database refuses with a sentence written for a person -- "these are
    // different videos: two of them are posted to the same account" -- so it
    // is shown as-is rather than softened into something less useful.
    if (res.error) return toast("danger", res.error);
    setMerging(false);
    done("Merged into one video.");
  }

  return (
    <div className="card animate-rise mb-3 flex flex-wrap items-center gap-2 p-2.5">
      <span className="text-sm font-medium">
        {selected.length} selected
      </span>
      <button
        className="rounded p-1 text-[var(--muted)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)]"
        onClick={onClear}
        aria-label="Clear selection"
      >
        <X size={13} />
      </button>

      <span className="mx-1 h-4 w-px bg-[var(--border)]" />

      {/* Credit someone. The reason the whole feature exists: credits sit at
          8% because assigning them one video at a time is not something anyone
          will do 255 times. */}
      <Select
        className="max-w-[150px]"
        value={roleId}
        onChange={setRoleId}
        placeholder="Role"
        ariaLabel="Role to credit"
        options={roles.map((r) => ({ value: r.id, label: r.name }))}
      />
      <Select
        className="max-w-[160px]"
        value={userId}
        onChange={setUserId}
        placeholder="Person"
        ariaLabel="Person to credit"
        options={members.map((m) => ({ value: m.userId, label: m.name }))}
      />
      <button
        className="btn-primary px-2.5 py-1 text-xs"
        disabled={busy || !roleId || !userId}
        onClick={assign}
      >
        Credit
      </button>

      <span className="mx-1 h-4 w-px bg-[var(--border)]" />

      {/* The placeholder used to read "No client", which is also a real
          destination -- so an untouched dropdown looked like a valid choice
          and Move silently unassigned everything selected. It has to read as
          an empty field, and clearing has to be something you pick on
          purpose. */}
      <Select
        className="max-w-[160px]"
        value={clientId}
        onChange={setClientId}
        placeholder="Move to…"
        ariaLabel="Move to client"
        options={[
          ...clients.map((c) => ({ value: c.id, label: c.name })),
          { value: CLEAR_CLIENT, label: "— Remove from client —" },
        ]}
      />
      <button
        className="btn px-2.5 py-1 text-xs"
        disabled={busy || !clientId}
        onClick={setClient}
        title={clientId ? undefined : "Pick a destination first"}
      >
        Move
      </button>

      <div className="flex-1" />

      {selected.length > 1 && (
        <button
          className="btn flex items-center gap-1 px-2.5 py-1 text-xs"
          disabled={busy}
          onClick={() => {
            setSurvivor(selected[0]);
            setMerging((v) => !v);
          }}
          title="Same video posted to several platforms? Merge them into one."
        >
          <Merge size={12} /> Merge {selected.length}
        </button>
      )}

      {merging && (
        <div className="w-full border-t border-[var(--border)] pt-2">
          <p className="mb-1.5 text-xs text-[var(--muted)]">
            Keeping one video and moving the others&apos; posts, credits and hours onto
            it. Which title should it keep?
          </p>
          <div className="mb-2 space-y-1">
            {selected.map((id) => (
              <label key={id} className="flex items-center gap-2 text-xs">
                <input
                  type="radio"
                  name="survivor"
                  className="accent-[var(--accent)]"
                  checked={survivor === id}
                  onChange={() => setSurvivor(id)}
                />
                <span className="min-w-0 flex-1 truncate">{titles[id] ?? id}</span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-primary px-2.5 py-1 text-xs" disabled={busy || !survivor} onClick={merge}>
              {busy ? "Merging…" : `Merge ${selected.length} into one`}
            </button>
            <button className="btn px-2.5 py-1 text-xs" onClick={() => setMerging(false)}>
              Cancel
            </button>
            <span className="text-[11px] text-[var(--muted)]">
              Reversible — the originals are kept and can be restored.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
