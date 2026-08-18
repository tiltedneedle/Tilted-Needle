"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Merge, Plus, X } from "lucide-react";
import Avatar from "@/components/Avatar";
import PlatformIcon from "@/components/PlatformIcon";
import Popover from "@/components/ui/Popover";
import Select from "@/components/ui/Select";
import {
  bulkAssignRole,
  bulkSetClient,
  mergeContentItems,
  type ClientAssignment,
} from "@/app/actions";
import { useToast } from "@/components/ui/Toast";
import { PLATFORM_LABEL } from "@/lib/types";
import { SHORT_ROLE, type TileCredit, type TileMember, type TileRole } from "@/components/VideoTile";

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
  platformsById,
  creditsById,
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
  /**
   * id -> the platforms that video is posted to, for the merge gate.
   *
   * Merge is same-platform only now, and that has to be decided here rather
   * than by letting people press the button and reading the refusal.
   */
  platformsById: Record<string, string[]>;
  /** id -> its credits, so the master assigner can show who already holds what. */
  creditsById: Record<string, TileCredit[]>;
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
  const [clientId, setClientId] = useState("");
  const [merging, setMerging] = useState(false);
  const [survivor, setSurvivor] = useState("");

  const done = (msg: string) => {
    toast("success", msg);
    onClear();
    startTransition(() => router.refresh());
  };

  /**
   * MERGE IS SAME-PLATFORM ONLY.
   *
   * It used to be the cross-platform tool: pick a TikTok and its Instagram
   * twin, fold them into one row. That is not a duplicate. Two platforms
   * carrying the same video are two posts with two audiences and two reach
   * curves; merging them hides one and invents a cross-post record that
   * describes nothing that happened.
   *
   * So the button only appears when everything selected sits on one and the
   * same platform. Computed rather than left to the server's refusal, because
   * "press it and read the error" is a worse way to learn a rule than not
   * being offered the button.
   */
  const mergePlatform = useMemo(() => {
    if (selected.length < 2) return null;
    const all = selected.flatMap((id) => platformsById[id] ?? []);
    // Nothing selected carries a post. These are the hand-added rows -- the
    // "41 with no link" -- and two of them with the same title really are one
    // video entered twice, with no posts to conflict. Offered, labelled as
    // what it is rather than borrowing a platform name it does not have.
    if (all.length === 0) return "none";
    const distinct = [...new Set(all)];
    return distinct.length === 1 ? distinct[0] : null;
  }, [selected, platformsById]);

  /**
   * Who already holds each role, across the selection, and on how many.
   *
   * Rolled up here rather than in the parent so the bar owns the whole idea of
   * "the selection": the parent hands over raw per-video credits and does not
   * have to know that the strip cares about counts. Sorted by coverage so the
   * avatar the strip shows is the person credited on the most of them, which
   * is the one that best describes the batch.
   */
  const creditedByRole = useMemo(() => {
    const out = new Map<string, { userId: string; name: string; count: number }[]>();
    for (const id of selected) {
      for (const c of creditsById[id] ?? []) {
        const list = out.get(c.roleSlug) ?? [];
        const found = list.find((h) => h.userId === c.userId);
        if (found) found.count++;
        else list.push({ userId: c.userId, name: c.userName, count: 1 });
        out.set(c.roleSlug, list);
      }
    }
    for (const list of out.values()) {
      list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    }
    return out;
  }, [selected, creditsById]);

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

      {/* The master assigner: the same five circles that sit on every row,
          except this one writes to the whole selection.
          It replaced Role ▾ + Person ▾ + Credit, which asked for three
          interactions and two of them were dropdowns whose options you had to
          read before you could choose. The circles are the control people
          already know from the rows, and the role is implied by which circle
          you open -- so crediting twelve videos is now click, click. */}
      <MasterCredit
        workspaceId={workspaceId}
        ids={selected}
        roles={roles}
        members={members}
        creditedByRole={creditedByRole}
        busy={busy}
        onDone={done}
      />

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

      {mergePlatform && (
        <button
          className="btn flex items-center gap-1 px-2.5 py-1 text-xs"
          disabled={busy}
          onClick={() => {
            setSurvivor(selected[0]);
            setMerging((v) => !v);
          }}
          title={
            mergePlatform === "none"
              ? "Two rows for the same video, neither linked to a post? Merge them into one."
              : `Two rows for the same ${PLATFORM_LABEL[mergePlatform] ?? mergePlatform} post? Merge them into one.`
          }
        >
          <Merge size={12} />
          {mergePlatform !== "none" && <PlatformIcon platform={mergePlatform} size={11} />}
          Merge {selected.length}
        </button>
      )}

      {merging && mergePlatform && (
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

/**
 * The master assigner: one credit strip that writes to every selected video.
 *
 * This replaced Role ▾ + Person ▾ + Credit. Those three controls were the
 * slow path -- two dropdowns you had to open and read before you could choose,
 * for a job people do dozens of times in a sitting -- and they were the second
 * way to do something the rows already did, which is how the confusion started.
 *
 * WHY THE ROW MENUS NO LONGER DO THIS. Until now, opening a role menu on a
 * TICKED row credited the whole selection, and on an unticked row credited
 * just that row. Same control, same gesture, blast radius depending on a
 * checkbox somewhere else on screen. That is a trap: the one place you want
 * to fix a single video is while you have a batch selected, and that was
 * exactly the click that changed all of them. Rows are now always one video.
 * Everything that acts on the selection lives in this bar, where the words
 * "N selected" are two inches away.
 *
 * Add-only, deliberately. Removal stays per-row: an assignment id belongs to
 * one video, adding a credit is idempotent and visible, and taking one away
 * from twelve videos on a single click is a far worse accident. What is
 * already held is shown, so the strip still reports rather than just writes.
 */
function MasterCredit({
  workspaceId,
  ids,
  roles,
  members,
  creditedByRole,
  busy,
  onDone,
}: {
  workspaceId: string;
  ids: string[];
  roles: TileRole[];
  members: TileMember[];
  /** roleSlug -> everyone credited on any selected video, with how many. */
  creditedByRole: Map<string, { userId: string; name: string; count: number }[]>;
  busy: boolean;
  onDone: (msg: string) => void;
}) {
  const [openRole, setOpenRole] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const anchorRef = useRef<HTMLDivElement>(null);

  function credit(role: TileRole, m: TileMember) {
    startTransition(async () => {
      const res = await bulkAssignRole({
        workspaceId,
        contentItemIds: ids,
        userId: m.userId,
        roleId: role.id,
      });
      setOpenRole(null);
      if (res.error) return toast("danger", res.error);
      // "added", not the selection size: people already credited in this role
      // are skipped, and reporting 12 when 4 changed teaches the wrong thing
      // about what the button does.
      const n = res.added ?? 0;
      onDone(
        n === 0
          ? `${m.name} was already credited as ${role.name} on all ${ids.length}.`
          : `${m.name} credited as ${role.name} on ${n} video${n === 1 ? "" : "s"}.`,
      );
    });
  }

  return (
    <div className="flex items-start gap-0.5">
      {roles.map((role) => {
        const holders = creditedByRole.get(role.slug) ?? [];
        const lead = holders[0];
        const isOpen = openRole === role.slug;
        // "on all of them" is the thing worth knowing at a glance, and it is
        // not the same question as "credited at all" once a batch is mixed.
        const onAll = lead?.count === ids.length;

        return (
          <div key={role.id} ref={isOpen ? anchorRef : undefined} className="relative">
            <button
              type="button"
              disabled={busy || pending}
              onClick={() => setOpenRole(isOpen ? null : role.slug)}
              className={`flex w-[42px] flex-col items-center gap-0.5 rounded-[8px] px-0.5 py-1 transition-colors hover:bg-[var(--bg-subtle)] disabled:opacity-50 ${
                isOpen ? "bg-[var(--bg-subtle)]" : ""
              }`}
              title={
                holders.length
                  ? `${role.name} on the selection: ${holders
                      .map((h) => `${h.name} (${h.count}/${ids.length})`)
                      .join(", ")}`
                  : `Credit someone as ${role.name} on all ${ids.length} selected`
              }
              aria-label={`Credit ${role.name} on all ${ids.length} selected videos`}
            >
              <span className="relative">
                {lead ? (
                  <span className="block rounded-full shadow-[0_0_0_2px_var(--panel)]">
                    <Avatar name={lead.name} seed={lead.userId} size={22} title="" />
                  </span>
                ) : (
                  <span className="flex size-[22px] items-center justify-center rounded-full border border-dashed border-[var(--border-strong)] bg-[var(--panel)] text-[var(--muted)]">
                    <Plus size={10} strokeWidth={2} />
                  </span>
                )}
                {/* A dot, not a number: "some but not all" is the whole
                    message, and the exact count is in the tooltip and the
                    menu header for anyone who wants it. */}
                {lead && !onAll && (
                  <span className="absolute -bottom-0.5 -right-0.5 size-[8px] rounded-full bg-[var(--warn)] shadow-[0_0_0_1.5px_var(--panel)]" />
                )}
              </span>
              <span className="w-full truncate text-center text-[9px] leading-tight text-[var(--muted)]">
                {SHORT_ROLE[role.slug] ?? role.name}
              </span>
            </button>

            {isOpen && (
              <Popover
                anchorRef={anchorRef}
                onClose={() => setOpenRole(null)}
                align="left"
                role="menu"
                ariaLabel={`${role.name} across the selection`}
                width={228}
                maxHeight={340}
                className="!py-0"
              >
                <div className="border-b border-[var(--border)] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  {role.name}
                  <span className="ml-1 font-medium normal-case tracking-normal text-[var(--accent)]">
                    · all {ids.length} selected
                  </span>
                </div>

                {holders.length > 0 && (
                  <div className="border-b border-[var(--border)] py-1">
                    {holders.map((h) => (
                      <div key={h.userId} className="flex items-center gap-2 px-2.5 py-1">
                        <Avatar name={h.name} seed={h.userId} size={18} />
                        <span className="min-w-0 flex-1 truncate text-xs">{h.name}</span>
                        <span className="tabular shrink-0 text-[11px] text-[var(--muted)]">
                          {h.count}/{ids.length}
                        </span>
                      </div>
                    ))}
                    {/* Says where removal lives rather than leaving people
                        hunting the menu for a Remove that is not here. */}
                    <p className="px-2.5 pb-0.5 pt-1 text-[10px] leading-snug text-[var(--muted)]">
                      Picking someone below credits all {ids.length}. To take a credit
                      away, use the circles on the video itself.
                    </p>
                  </div>
                )}

                <div className="max-h-52 overflow-y-auto py-1">
                  {members.map((m) => {
                    const held = holders.find((h) => h.userId === m.userId);
                    const everywhere = held?.count === ids.length;
                    return (
                      <button
                        key={m.userId}
                        type="button"
                        disabled={everywhere}
                        className="flex w-full items-center gap-2 px-2.5 py-1 text-left transition-colors hover:bg-[var(--bg-subtle)] disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent"
                        onClick={() => credit(role, m)}
                      >
                        <Avatar name={m.name} seed={m.userId} size={20} />
                        <span className="min-w-0 flex-1 truncate text-xs">{m.name}</span>
                        {/* The useful state is the partial one: it means
                            clicking fills the gap rather than doing nothing. */}
                        {held && (
                          <span className="tabular shrink-0 text-[10px] text-[var(--muted)]">
                            {everywhere ? "all" : `+${ids.length - held.count}`}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </Popover>
            )}
          </div>
        );
      })}
    </div>
  );
}
