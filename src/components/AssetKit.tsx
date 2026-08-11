"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  addAsset,
  updateAsset,
  deleteAsset,
  type AssetInput,
} from "@/app/(app)/guidelines/actions";
import Select from "@/components/ui/Select";
import { ASSET_KINDS, ASSET_GROUPS, GROUP_COLOR, kindLabel, kindGroup } from "@/lib/assetKinds";
import type { ClientAsset } from "@/lib/guidelines";

/**
 * The editor kit: the things you actually drop into a timeline.
 *
 * Separate from the written guideline because it is used differently. Nobody
 * reads this section -- they arrive knowing they need the CTA, and the job of
 * the layout is to get them to it in one glance and one click. Hence grouping
 * by what the thing IS (brand / on-screen / sound / footage) rather than
 * alphabetically, and hence copy buttons on any asset that is words.
 */
export default function AssetKit({
  clientId,
  assets,
  canManage,
}: {
  clientId: string;
  assets: ClientAsset[];
  canManage: boolean;
}) {
  const [adding, setAdding] = useState(false);

  const byGroup = new Map<string, ClientAsset[]>();
  for (const a of assets) {
    const g = kindGroup(a.kind);
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(a);
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Editor kit
        </h2>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-[var(--muted)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)]"
          >
            <Plus size={13} /> Add asset
          </button>
        )}
      </div>

      {adding && (
        <AssetForm
          clientId={clientId}
          onDone={() => setAdding(false)}
          onCancel={() => setAdding(false)}
        />
      )}

      {assets.length === 0 && !adding ? (
        <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--border-strong)] p-6 text-center">
          <p className="text-sm text-[var(--muted)]">
            No assets yet — the CTA, outro, logo, SFX and fonts for this client go here.
          </p>
          <button
            onClick={() => setAdding(true)}
            className="mt-3 rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-fg)]"
          >
            Add the first one
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {ASSET_GROUPS.filter((g) => byGroup.has(g)).map((group) => (
            <div key={group}>
              <div className="mb-2 flex items-center gap-2">
                <span
                  className="size-2 rounded-full"
                  style={{ background: GROUP_COLOR[group] }}
                />
                <span className="text-xs font-medium text-[var(--muted)]">{group}</span>
              </div>
              {/* One column: the kit sits in a ~380px rail, and a two-up grid
                  there truncates every label to "Followers ma…". */}
              <div className="grid gap-2.5">
                {byGroup.get(group)!.map((a) => (
                  <AssetCard key={a.id} asset={a} canManage={canManage} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function AssetCard({ asset, canManage }: { asset: ClientAsset; canManage: boolean }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();

  async function remove() {
    setBusy(true);
    const res = await deleteAsset(asset.id);
    setBusy(false);
    if (res.error) return setError(res.error);
    startTransition(() => router.refresh());
  }

  async function copy() {
    if (!asset.body) return;
    await navigator.clipboard.writeText(asset.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  if (editing) {
    return (
      <AssetForm
        clientId=""
        asset={asset}
        onDone={() => setEditing(false)}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="group flex flex-col rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] p-3 transition-shadow hover:shadow-[var(--shadow-card)]">
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span
            className="mb-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium"
            style={{
              background: `${GROUP_COLOR[kindGroup(asset.kind)]}1a`,
              color: GROUP_COLOR[kindGroup(asset.kind)],
            }}
          >
            {kindLabel(asset.kind)}
          </span>
          <h4 className="text-sm font-medium leading-snug">{asset.label}</h4>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            onClick={() => setEditing(true)}
            className="rounded-md p-1.5 text-[var(--muted)] opacity-0 transition-opacity hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)] focus:opacity-100 group-hover:opacity-100"
            title="Edit"
            aria-label={`Edit ${asset.label}`}
          >
            <Pencil size={12} />
          </button>
          {canManage && (
            <button
              onClick={remove}
              disabled={busy}
              className="rounded-md p-1.5 text-[var(--muted)] opacity-0 transition-opacity hover:bg-[var(--danger)]/10 hover:text-[var(--danger)] focus:opacity-100 group-hover:opacity-100"
              title="Delete"
              aria-label={`Delete ${asset.label}`}
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {asset.body && (
        <div className="mb-1.5 flex items-start gap-1.5 rounded-[var(--radius-sm)] bg-[var(--bg-subtle)] px-2 py-1.5">
          <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs leading-relaxed">
            {asset.body}
          </p>
          <button
            onClick={copy}
            className="shrink-0 rounded p-1 text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
            title="Copy"
            aria-label={`Copy ${asset.label}`}
          >
            {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
          </button>
        </div>
      )}

      {asset.url && (
        <a
          href={asset.url}
          target="_blank"
          rel="noreferrer"
          className="mb-1 flex items-center gap-1 truncate text-xs text-[var(--accent)] hover:underline"
        >
          <ExternalLink size={11} className="shrink-0" />
          <span className="truncate">{prettyUrl(asset.url)}</span>
        </a>
      )}

      {asset.notes && (
        <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--muted)]">
          {asset.notes}
        </p>
      )}

      {error && (
        <p className="mt-1 text-[11px] text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function AssetForm({
  clientId,
  asset,
  onDone,
  onCancel,
}: {
  clientId: string;
  asset?: ClientAsset;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState(asset?.kind ?? "cta");
  const [label, setLabel] = useState(asset?.label ?? "");
  const [body, setBody] = useState(asset?.body ?? "");
  const [url, setUrl] = useState(asset?.url ?? "");
  const [notes, setNotes] = useState(asset?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();

  async function submit() {
    const input: AssetInput = { kind, label, body, url, notes };
    setBusy(true);
    const res = asset ? await updateAsset(asset.id, input) : await addAsset(clientId, input);
    setBusy(false);
    if (res.error) return setError(res.error);
    onDone();
    startTransition(() => router.refresh());
  }

  const field =
    "w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--input-bg)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--accent)]";

  return (
    <div className="mb-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] p-3">
      <div className="mb-2 grid gap-2 sm:grid-cols-[150px_1fr]">
        {/* An asset always HAS a kind, so an empty value is ignored rather
            than written -- the clear row Select offers has no meaning here. */}
        <Select
          className="min-w-[150px]"
          value={kind}
          onChange={(v) => v && setKind(v)}
          placeholder={ASSET_KINDS[0]?.label ?? "Kind"}
          ariaLabel="Asset kind"
          options={ASSET_KINDS.map((k) => ({ value: k.slug, label: k.label }))}
        />
        <input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Name, e.g. Younger patient CTA"
          className={field}
        />
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        placeholder="The words themselves, if it is text (CTA copy, outro line, font name)"
        className={`${field} mb-2 resize-y`}
      />
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Link to the file or folder (Drive, Dropbox…)"
        className={`${field} mb-2`}
      />
      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="When to use it, gotchas, who to ask"
        className={`${field} mb-2`}
      />
      <div className="flex items-center gap-2">
        <button
          onClick={submit}
          disabled={busy || !label.trim()}
          className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-fg)] disabled:opacity-50"
        >
          {busy ? "Saving…" : asset ? "Save" : "Add"}
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-1 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--bg-subtle)]"
        >
          <X size={12} /> Cancel
        </button>
        {error && (
          <span className="text-xs text-[var(--danger)]" role="alert">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

/** Drive links are unreadable in full; the host plus a hint is enough. */
function prettyUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "docs.google.com") return `Google ${u.pathname.split("/")[1] ?? "doc"}`;
    if (host === "drive.google.com") return "Google Drive";
    if (host === "youtube.com" || host === "youtu.be") return "YouTube";
    return host;
  } catch {
    return url;
  }
}
