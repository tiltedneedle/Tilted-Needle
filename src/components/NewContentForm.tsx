"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2, Pencil } from "lucide-react";
import Select from "@/components/ui/Select";
import {
  createContentItem,
  createContentFromUrl,
  lookupContentUrl,
  type UrlLookup,
} from "@/app/actions";
import { parseVideoLength, formatVideoLength } from "@/lib/format";
import type { Client } from "@/lib/types";

/**
 * Two ways in, because there are two situations.
 *
 * A link is the normal one: the video exists, so its id, title, length and
 * publish date are all knowable and nobody should retype them. By hand is for
 * work that has no link yet -- something filmed but not posted, or a platform
 * we do not read.
 *
 * The link path deliberately LOOKS UP before it writes. The costly mistake is
 * not a bad paste; it is creating a second content item for a video the sync
 * already tracks, which splits that video's metrics across two rows that each
 * look complete and which no report would flag as wrong.
 */
export default function NewContentForm({
  workspaceId,
  clients,
}: {
  workspaceId: string;
  clients: Client[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [byHand, setByHand] = useState(false);

  const [url, setUrl] = useState("");
  const [lookup, setLookup] = useState<UrlLookup | null>(null);
  const [accountId, setAccountId] = useState("");

  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState("");
  const [subject, setSubject] = useState("");
  const [hook, setHook] = useState("");
  const [length, setLength] = useState("");
  const [producedAt, setProducedAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setUrl("");
    setLookup(null);
    setAccountId("");
    setTitle("");
    setSubject("");
    setHook("");
    setLength("");
    setProducedAt("");
    setError(null);
  }

  async function look() {
    setBusy(true);
    setError(null);
    const res = await lookupContentUrl({ workspaceId, url });
    setBusy(false);
    if ("error" in res) return setError(res.error);

    const d = res.data;
    setLookup(d);
    if (d.existingContentItemId) return;

    // Everything the platform gave away, filled in. Anything it did not is
    // left empty rather than guessed at.
    setAccountId(d.suggestedAccountId ?? "");
    if (d.title) setTitle(d.title);
    if (d.postedAt) setProducedAt(d.postedAt);
    if (d.lengthSeconds != null) setLength(formatVideoLength(d.lengthSeconds));

    // The account already knows its client, so asking again would be asking
    // someone to repeat a fact the system holds.
    const acc = d.accounts.find((a) => a.id === (d.suggestedAccountId ?? ""));
    if (acc?.clientId) setClientId(acc.clientId);
  }

  async function createFromLink() {
    if (!lookup) return;
    setBusy(true);
    setError(null);
    const res = await createContentFromUrl({
      workspaceId,
      url,
      accountId,
      clientId: clientId || null,
      title,
      producedAt: producedAt || null,
      lengthSeconds: length.trim() ? parseVideoLength(length) : null,
    });
    setBusy(false);
    if ("error" in res) return setError(res.error);

    // A duplicate that appeared between the lookup and the save -- a sync
    // running while the form sat open. Say so and go to the real one.
    setOpen(false);
    reset();
    router.push(`/content?video=${res.contentItemId}`);
  }

  async function createByHand() {
    if (!title.trim()) return setError("Title is required.");
    setBusy(true);
    setError(null);
    const res = await createContentItem({
      workspaceId,
      clientId: clientId || null,
      title,
      subject: subject.trim() || null,
      hook: hook.trim() || null,
      lengthSeconds: length.trim() ? parseVideoLength(length) : null,
      producedAt: producedAt || null,
    });
    setBusy(false);
    if (res.error) return setError(res.error);
    setOpen(false);
    reset();
    startTransition(() => router.refresh());
  }

  if (!open) {
    return (
      <button className="btn-primary mb-4" onClick={() => setOpen(true)}>
        New content
      </button>
    );
  }

  const detected = lookup && !lookup.existingContentItemId;

  return (
    <div className="card animate-rise mb-4 space-y-2 p-3">
      {!byHand && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Link2 size={14} className="shrink-0 text-[var(--muted)]" />
            <input
              autoFocus
              className="input min-w-[240px] flex-1"
              placeholder="Paste the link — YouTube, TikTok or Instagram"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                // The panel below describes the OLD link once this changes,
                // so it goes rather than sits there being wrong.
                if (lookup) setLookup(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && url.trim() && void look()}
            />
            <button
              className="btn-primary"
              onClick={look}
              disabled={busy || !url.trim()}
            >
              {busy && !lookup ? "Looking…" : "Look up"}
            </button>
          </div>

          {lookup?.existingContentItemId && (
            // The whole point of looking up first. Creating this would have
            // split one video's numbers across two records.
            <div className="rounded-[var(--radius-sm)] border border-[var(--accent)]/40 bg-[var(--accent)]/5 p-2.5 text-sm">
              <p className="font-medium">This video is already tracked.</p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {lookup.existingTitle
                  ? `It is here as "${lookup.existingTitle}".`
                  : "It already has a record here."}{" "}
                Adding it again would split its views and likes across two
                entries.
              </p>
              <button
                className="btn mt-2 px-2 py-1 text-xs"
                onClick={() => {
                  setOpen(false);
                  reset();
                  router.push(`/content?video=${lookup.existingContentItemId}`);
                }}
              >
                Open it
              </button>
            </div>
          )}

          {detected && (
            <div className="space-y-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-subtle)] p-2.5">
              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                <span className="rounded bg-[var(--panel)] px-1.5 py-0.5 font-medium capitalize">
                  {lookup.platform}
                </span>
                <span className="tabular">{lookup.externalId}</span>
              </div>

              {lookup.accounts.length === 0 ? (
                // Without an account there is nothing to attach the post to,
                // and no metrics would ever arrive for it.
                <p className="text-xs text-[var(--danger)]">
                  No {lookup.platform} account is set up yet. Add one under
                  Accounts first, or add this video by hand.
                </p>
              ) : (
                <label className="block text-xs text-[var(--muted)]">
                  Posted from
                  <Select
                    className="mt-1 max-w-[240px]"
                    value={accountId}
                    onChange={(v) => {
                      setAccountId(v);
                      const acc = lookup.accounts.find((a) => a.id === v);
                      if (acc?.clientId) setClientId(acc.clientId);
                    }}
                    placeholder="Choose the account"
                    ariaLabel="Posted from"
                    invalid={!accountId}
                    options={lookup.accounts.map((a) => ({
                      value: a.id,
                      label: a.handle,
                    }))}
                  />
                </label>
              )}

              {lookup.note && (
                <p className="text-xs text-[var(--muted)]">{lookup.note}</p>
              )}
            </div>
          )}
        </>
      )}

      {(byHand || detected) && (
        <>
          <div className="flex flex-wrap gap-2">
            <input
              autoFocus={byHand}
              className="input min-w-[240px] flex-1"
              placeholder="Title, e.g. Youmi Beauty Vlog"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Select
              className="max-w-[190px]"
              value={clientId}
              onChange={setClientId}
              placeholder="No client"
              ariaLabel="Client"
              options={clients
                .filter((c) => !c.is_archived)
                .map((c) => ({ value: c.id, label: c.name }))}
            />
            <input
              type="date"
              className="input max-w-[160px]"
              value={producedAt}
              onChange={(e) => setProducedAt(e.target.value)}
              aria-label="Posted on"
            />
            <input
              className="input max-w-[110px] text-center"
              placeholder="0:38"
              value={length}
              onChange={(e) => setLength(e.target.value)}
              aria-label="Video length"
            />
          </div>

          {/* Subject and Hook are filled ~94% of the time in the current sheet
              -- they are the team's manual stand-in for retention data (PRD
              3.5). Only offered on the by-hand path: on a link, the sync
              writes the description itself. */}
          {byHand && (
            <>
              <input
                className="input"
                placeholder="Subject — what the video is about"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
              <input
                className="input"
                placeholder="Hook — the literal opening line"
                value={hook}
                onChange={(e) => setHook(e.target.value)}
              />
            </>
          )}
        </>
      )}

      {error && (
        <p className="text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {byHand ? (
          <button className="btn-primary" onClick={createByHand} disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </button>
        ) : (
          detected && (
            <button
              className="btn-primary"
              onClick={createFromLink}
              disabled={busy || !accountId || !title.trim()}
            >
              {busy ? "Creating…" : "Create"}
            </button>
          )
        )}

        <button
          className="btn"
          onClick={() => {
            setOpen(false);
            reset();
            setByHand(false);
          }}
        >
          Cancel
        </button>

        <div className="flex-1" />

        <button
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)]"
          onClick={() => {
            setByHand((v) => !v);
            setError(null);
            setLookup(null);
          }}
        >
          {byHand ? (
            <>
              <Link2 size={12} /> Paste a link instead
            </>
          ) : (
            <>
              <Pencil size={12} /> No link — add by hand
            </>
          )}
        </button>
      </div>
    </div>
  );
}
