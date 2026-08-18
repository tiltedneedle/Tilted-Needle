"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { attachPostByUrl, lookupContentUrl } from "@/app/actions";
import Select from "@/components/ui/Select";
import type { Account } from "@/lib/types";

/**
 * Pastes a link onto a video that already exists.
 *
 * The gap this fills: a video entered by hand or imported from a spreadsheet
 * has a title and a date but no platform post, so the dashboard showed it as
 * "not posted yet" when it had in fact been posted -- the system simply had no
 * link for it. The only repair available was an account picker that stored
 * `url: null`, producing a row the sync could never match and which therefore
 * never gained a metric.
 *
 * Resolving the URL rather than just filing it is what makes this worth doing.
 * parseContentUrl yields the external id, which is the key runSync matches on,
 * so the video joins the normal refresh cycle instead of sitting inert -- and
 * it stops being a latent duplicate, because discovery that later reaches the
 * post recognises it rather than creating a twin.
 *
 * The account is SUGGESTED and never applied silently. A TikTok link names its
 * creator in the path so the account is known; YouTube and Instagram links do
 * not carry it, so the only safe suggestion is the sole account when there is
 * exactly one. Attaching someone else's video to your own account would poison
 * that account's baseline with numbers nobody on the team produced.
 */
export default function AttachByUrl({
  workspaceId,
  contentItemId,
  accounts,
  onDone,
}: {
  workspaceId: string;
  contentItemId: string;
  /** Accounts not already carrying a post for this video. */
  accounts: Account[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [url, setUrl] = useState("");
  const [accountId, setAccountId] = useState("");
  const [platform, setPlatform] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ id: string; title: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  // Resolved on blur or paste rather than on every keystroke: the lookup can
  // reach YouTube or TikTok for a title, and a half-typed URL is never a
  // question worth asking them.
  async function resolve(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      setPlatform(null);
      setNote(null);
      setError(null);
      return;
    }
    setBusy(true);
    setError(null);
    setConflict(null);
    const res = await lookupContentUrl({ workspaceId, url: trimmed });
    setBusy(false);
    if ("error" in res) {
      setPlatform(null);
      setError(res.error);
      return;
    }
    setPlatform(res.data.platform);
    setNote(res.data.note);
    // Only accept a suggestion that is actually attachable here -- the picker
    // lists accounts this video does not already use.
    const ok = accounts.some((a) => a.id === res.data.suggestedAccountId);
    if (ok && res.data.suggestedAccountId) setAccountId(res.data.suggestedAccountId);
    if (res.data.existingContentItemId && res.data.existingContentItemId !== contentItemId) {
      setConflict({ id: res.data.existingContentItemId, title: res.data.existingTitle });
    }
  }

  async function submit() {
    if (!url.trim() || !accountId) return;
    setBusy(true);
    setError(null);
    const res = await attachPostByUrl({
      workspaceId,
      contentItemId,
      url: url.trim(),
      accountId,
    });
    setBusy(false);
    if ("error" in res) return setError(res.error);
    if ("conflict" in res) {
      return setConflict({ id: res.conflict.contentItemId, title: res.conflict.title });
    }
    setUrl("");
    setAccountId("");
    setPlatform(null);
    setNote(null);
    onDone?.();
    startTransition(() => router.refresh());
  }

  const platformAccounts = platform
    ? accounts.filter((a) => a.platform_slug === platform)
    : accounts;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input min-w-0 flex-1 sm:max-w-[380px]"
          placeholder="Paste the link to this video…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={(e) => resolve(e.target.value)}
          onPaste={(e) => {
            const v = e.clipboardData.getData("text");
            // The paste has not landed in state yet, so resolve the clipboard
            // value directly instead of waiting a tick for React.
            setUrl(v);
            void resolve(v);
          }}
        />
        {platformAccounts.length > 0 && (
          <Select
            className="max-w-[240px]"
            value={accountId}
            onChange={setAccountId}
            placeholder="Which account?"
            options={platformAccounts.map((a) => ({
              value: a.id,
              label: `${a.platform_slug} — @${a.handle}`,
            }))}
          />
        )}
        <button className="btn" onClick={submit} disabled={busy || !url.trim() || !accountId}>
          {busy ? "Checking…" : "Attach"}
        </button>
      </div>

      {platform && !conflict && (
        <p className="text-xs text-[var(--muted)]">
          Recognised as {platform}. Once attached, the sync refreshes it like any other post.
        </p>
      )}
      {note && <p className="text-xs text-[var(--muted)]">{note}</p>}
      {conflict && (
        <p className="text-xs text-[var(--muted)]">
          That link is already on{" "}
          <Link className="underline" href={`/content/${conflict.id}`}>
            {conflict.title ?? "another video"}
          </Link>
          . The same video is in here twice — merge them rather than attaching it again.
        </p>
      )}
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
      {/* No account for this platform yet: say what is missing rather than
          leaving a picker that cannot be satisfied.

          "for this client", not "for this workspace". The accounts handed to
          this component are scoped to the video's client -- attaching to
          another client's account would move this video's reach onto their
          books -- so a workspace that has a TikTok account can still land
          here, and being told the workspace has none would send someone
          looking for a setting that is already set. */}
      {platform && platformAccounts.length === 0 && (
        <p className="text-xs text-[var(--muted)]">
          No {platform} account is set up for this client yet — add one on Data sync first.
        </p>
      )}
    </div>
  );
}
