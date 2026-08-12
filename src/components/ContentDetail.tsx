"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addPlatformPost,
  assignRole,
  deleteContentItem,
  deletePlatformPost,
  recordAnalytics,
  recordSnapshot,
  unassignRole,
  updateContentItem,
  updatePlatformPost,
} from "@/app/actions";
import { formatDurationShort, formatVideoLength, parseVideoLength } from "@/lib/format";
import { ChevronDown } from "lucide-react";
import Select from "@/components/ui/Select";
import VideoEmbed from "@/components/VideoEmbed";
import Avatar from "@/components/Avatar";
import ScreenshotImport from "@/components/ScreenshotImport";
import ScrapeNowButton, { type ScrapeAllowance } from "@/components/ScrapeNowButton";
import TranscriptPanel from "@/components/TranscriptPanel";
import { PLATFORM_COLORS, one } from "@/lib/types";
import type {
  Account,
  Client,
  ContentAssignment,
  ContentItem,
  PlatformPost,
  Role,
} from "@/lib/types";

export type SnapshotRow = {
  platform_post_id: string;
  captured_at: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
};

export type AnalyticsRow = {
  platform_post_id: string;
  captured_at: string;
  impressions: number | null;
  ctr: number | null;
  avg_watch_seconds: number | null;
  retention_30s: number | null;
  retention_60s: number | null;
  source: string;
};

export default function ContentDetail({
  workspaceId,
  item,
  posts,
  accounts,
  roles,
  assignments,
  members,
  trackedSeconds,
  history,
  analytics,
  clients,
  transcript = null,
  visionDrafts = {},
  scrapeAllowance = null,
}: {
  workspaceId: string;
  /** Existing transcript, when one has been fetched or pasted. */
  transcript?: { fullText: string; source: string; isGenerated: boolean | null } | null;
  /** Remaining metered reads, so the counter sits beside the button. */
  scrapeAllowance?: ScrapeAllowance;
  /** Vision drafts awaiting confirmation, keyed by platform post id. */
  visionDrafts?: Record<
    string,
    { values: { name: string; rawText: string; value: number | null; confidence: "low" | "medium" | "high"; warning?: string }[]; storagePath: string; ownerOnlyCount: number }
  >;
  item: ContentItem;
  posts: PlatformPost[];
  accounts: Account[];
  roles: Role[];
  assignments: ContentAssignment[];
  members: { userId: string; name: string }[];
  trackedSeconds: number;
  history: SnapshotRow[];
  analytics: AnalyticsRow[];
  clients: Client[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [addAccountId, setAddAccountId] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState<string | null>(null);
  const [editingAnalytics, setEditingAnalytics] = useState<string | null>(null);
  const [analyticsDraft, setAnalyticsDraft] = useState({
    impressions: "",
    ctr: "",
    avgWatch: "",
    retention30: "",
    retention60: "",
  });
  const [advanced, setAdvanced] = useState<string | null>(null);
  const [showAttach, setShowAttach] = useState(false);
  const [editMeta, setEditMeta] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [meta, setMeta] = useState({
    title: item.title,
    clientId: item.client_id ?? "",
    subject: item.subject ?? "",
    hook: item.hook ?? "",
    musicUsed: item.music_used ?? "",
    // Seeded and parsed by the same pair, so opening this form and saving it
    // untouched is a no-op. It used to seed M:SS and parse H:MM, which meant
    // that round trip multiplied every video's length by sixty.
    length: item.length_seconds ? formatVideoLength(item.length_seconds) : "",
    producedAt: item.produced_at ?? "",
    notes: item.notes ?? "",
  });
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

  /**
   * Owner-only numbers, typed in. One of three routes into `post_analytics`
   * -- manual, CSV import, screenshot extraction -- none of which need a
   * credential from the client (PRD-video-intelligence §2.1).
   */
  async function saveAnalytics(postId: string) {
    const num = (v: string) => (v.trim() === "" ? null : Number(v));
    const res = await recordAnalytics({
      workspaceId,
      platformPostId: postId,
      impressions: num(analyticsDraft.impressions),
      ctrPercent: num(analyticsDraft.ctr),
      avgWatchSeconds: num(analyticsDraft.avgWatch),
      retention30sPercent: num(analyticsDraft.retention30),
      retention60sPercent: num(analyticsDraft.retention60),
    });
    if (res.error) return setError(res.error);
    setEditingAnalytics(null);
    setAnalyticsDraft({ impressions: "", ctr: "", avgWatch: "", retention30: "", retention60: "" });
    refresh();
  }

  async function saveMeta() {
    const secs = meta.length.trim() ? parseVideoLength(meta.length) : null;
    if (meta.length.trim() && secs == null)
      return setError("Length must look like 0:38, 38s, or 1m30s.");
    if (!meta.title.trim()) return setError("Title is required.");
    const res = await updateContentItem(item.id, {
      title: meta.title.trim(),
      client_id: meta.clientId || null,
      subject: meta.subject.trim() || null,
      hook: meta.hook.trim() || null,
      music_used: meta.musicUsed.trim() || null,
      length_seconds: secs,
      produced_at: meta.producedAt || null,
      notes: meta.notes.trim() || null,
    });
    if (res.error) return setError(res.error);
    setEditMeta(false);
    setError(null);
    refresh();
  }

  if (editMeta) {
    return (
      <div className="card animate-rise space-y-2 p-3">
        <h2 className="text-sm font-semibold">Edit content</h2>
        <div className="flex flex-wrap gap-2">
          <input
            className="input min-w-[240px] flex-1"
            value={meta.title}
            onChange={(e) => setMeta({ ...meta, title: e.target.value })}
            placeholder="Title"
          />
          {/* "No client" is a real state for a video, so the clear row means
              what it says. An archived client stays listed while it is THIS
              video's current one -- otherwise the field would read blank and
              reassigning would be the only way out of a state nobody chose. */}
          <Select
            className="max-w-[190px]"
            value={meta.clientId}
            onChange={(v) => setMeta({ ...meta, clientId: v })}
            placeholder="No client"
            ariaLabel="Client"
            options={clients
              .filter((c) => !c.is_archived || c.id === meta.clientId)
              .map((c) => ({ value: c.id, label: c.name }))}
          />
          <input
            type="date"
            className="input max-w-[160px]"
            value={meta.producedAt}
            onChange={(e) => setMeta({ ...meta, producedAt: e.target.value })}
          />
          <input
            className="input max-w-[110px] text-center"
            value={meta.length}
            onChange={(e) => setMeta({ ...meta, length: e.target.value })}
            placeholder="0:38"
            aria-label="Length"
          />
        </div>
        <input
          className="input"
          value={meta.subject}
          onChange={(e) => setMeta({ ...meta, subject: e.target.value })}
          placeholder="Subject"
        />
        <input
          className="input"
          value={meta.hook}
          onChange={(e) => setMeta({ ...meta, hook: e.target.value })}
          placeholder="Hook"
        />
        <input
          className="input"
          value={meta.musicUsed}
          onChange={(e) => setMeta({ ...meta, musicUsed: e.target.value })}
          placeholder="Music used"
        />
        <textarea
          className="input min-h-[70px]"
          value={meta.notes}
          onChange={(e) => setMeta({ ...meta, notes: e.target.value })}
          placeholder="Notes"
        />
        {error && (
          <p className="text-sm text-[var(--danger)]" role="alert">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button className="btn-primary" onClick={saveMeta}>
            Save
          </button>
          <button
            className="btn"
            onClick={() => {
              setEditMeta(false);
              setError(null);
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mb-1 flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{item.title}</h1>
        {one(item.client) && (
          <Link
            href={`/content?client=${one(item.client)!.id}`}
            className="text-sm text-[var(--muted)] transition-colors hover:text-[var(--accent)]"
          >
            {one(item.client)!.name}
          </Link>
        )}
        <div className="flex-1" />
        <button className="btn px-2 py-1 text-xs" onClick={() => setEditMeta(true)}>
          Edit
        </button>
        {confirmDelete ? (
          <span className="flex items-center gap-1 text-xs">
            <span className="text-[var(--muted)]">Delete this and its posts?</span>
            <button
              className="rounded bg-[var(--danger)] px-2 py-1 text-xs text-[var(--accent-fg)]"
              onClick={async () => {
                const res = await deleteContentItem(item.id);
                if (res.error) {
                  setError(res.error);
                  setConfirmDelete(false);
                  return;
                }
                router.push("/content");
              }}
            >
              Delete
            </button>
            <button className="btn px-2 py-1 text-xs" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button
            className="rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--danger)]"
            onClick={() => setConfirmDelete(true)}
          >
            Delete
          </button>
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
          const forPost = history.filter((h) => h.platform_post_id === p.id);
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

                {/* The "1.2x baseline" chip was here. Removed by request,
                    with the whole baseline model: it compared a post to a
                    median that moves as the account grows, so the same video
                    could read as a win or a failure depending on when you
                    looked, and nobody could act on the difference. The real
                    numbers are directly below. */}

                <button
                  className={`rounded px-1.5 py-1 text-xs transition-colors ${
                    p.is_best_performing
                      ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                      : "text-[var(--muted)] hover:bg-[var(--border)]"
                  }`}
                  onClick={async () => {
                    const res = await updatePlatformPost(p.id, {
                      is_best_performing: !p.is_best_performing,
                    });
                    if (res.error) setError(res.error);
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
                      className="btn px-2 py-1 text-xs"
                      title="Every reading ever taken of this post's numbers, oldest to newest — one per sync. Shows whether it is still growing or has flattened."
                      onClick={() =>
                        setShowHistory(showHistory === p.id ? null : p.id)
                      }
                    >
                      History ({forPost.length})
                    </button>
                    <button
                      className="row-actions rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--danger)]"
                      onClick={async () => {
                        const res = await deletePlatformPost(p.id);
                        if (res.error) setError(res.error);
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

              <VideoEmbed platformSlug={slug} url={p.url} externalId={p.external_id} />

              {showHistory === p.id && <SnapshotHistory rows={forPost} />}

              {/* Refresh THIS post's numbers, with the remaining metered
                  allowance shown before the press rather than after. The
                  account-wide refresh on /data is a different, blunter tool. */}
              <div className="mt-2">
                <ScrapeNowButton platformPostId={p.id} allowance={scrapeAllowance} compact />
              </div>

              {/* The screenshot reader and the owner-only metrics panel are
                  both occasional, deliberate acts -- you go looking for them
                  when a client sends an export, not while reading how a video
                  did. Open by default they pushed the actual numbers off the
                  screen and made every post look like a data-entry form. */}
              <button
                className="mt-3 flex items-center gap-1 text-xs text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
                onClick={() => setAdvanced(advanced === p.id ? null : p.id)}
                aria-expanded={advanced === p.id}
              >
                {advanced === p.id ? "Hide advanced options" : "View advanced options"}
                <ChevronDown
                  size={12}
                  className={`transition-transform duration-150 ${
                    advanced === p.id ? "rotate-180" : ""
                  }`}
                />
              </button>

              {advanced === p.id && (
                <div className="animate-rise mt-2 space-y-3 border-t border-[var(--border)] pt-3">
                  {/* Route B into the same table the form above writes
                      (PRD-video-intelligence §2.1). Instagram has no export,
                      so for reach, saves and shares a screenshot is the only
                      route that exists. */}
                  <ScreenshotImport
                    workspaceId={workspaceId}
                    platformPostId={p.id}
                    draft={visionDrafts[p.id] ?? null}
                  />

                  <EnhancedMetrics
                    analytics={analytics.filter((a) => a.platform_post_id === p.id)}
                    editing={editingAnalytics === p.id}
                    draft={analyticsDraft}
                    setDraft={setAnalyticsDraft}
                    onEdit={() => setEditingAnalytics(p.id)}
                    onCancel={() => setEditingAnalytics(null)}
                    onSave={() => void saveAnalytics(p.id)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Attaching a platform is rare -- it happens once, when a video is
          cross-posted -- so it sits behind the same disclosure rather than
          occupying the page every time anyone opens a video. */}
      {unusedAccounts.length > 0 && (
        <div className="mb-6">
          <button
            className="flex items-center gap-1 text-xs text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
            onClick={() => setShowAttach((v) => !v)}
            aria-expanded={showAttach}
          >
            {showAttach ? "Hide" : "Add this video to another platform"}
            <ChevronDown
              size={12}
              className={`transition-transform duration-150 ${showAttach ? "rotate-180" : ""}`}
            />
          </button>
          {showAttach && (
            <div className="animate-rise mt-2 flex items-center gap-2">
              <Select
                className="max-w-[240px]"
                value={addAccountId}
                onChange={setAddAccountId}
                placeholder="Add to a platform…"
                options={unusedAccounts.map((a) => ({
                  value: a.id,
                  label: `${a.platform_slug} — ${a.handle}`,
                }))}
              />
              <button className="btn" onClick={attach} disabled={!addAccountId}>
                Attach
              </button>
            </div>
          )}
        </div>
      )}

      {/* The transcript sits above credits: it describes the video itself,
          and it is what the whole corpus layer reads (PRD §5.11). */}
      <TranscriptPanel
        workspaceId={workspaceId}
        contentItemId={item.id}
        transcript={transcript}
      />

      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Credits</h2>
        <span className="text-xs text-[var(--muted)]">
          Who did what on this video
        </span>
      </div>
      <div className="card divide-y divide-[var(--border)] overflow-hidden">
        {roles.map((role) => {
          const holders = assignments.filter((a) => a.role_id === role.id);
          return (
            <div key={role.id} className="flex items-center gap-3 px-3 py-2">
              <span className="w-32 shrink-0 text-sm text-[var(--muted)]">
                {role.name}
              </span>
              <div className="flex flex-1 flex-wrap gap-1.5">
                {holders.map((h) => {
                  return (
                    <span
                      key={h.id}
                      className="group/chip flex items-center gap-1.5 rounded-full bg-[var(--bg-subtle)] py-0.5 pl-0.5 pr-2 text-xs"
                      title="See everything they have worked on"
                    >
                      {/* Same colour as this person's circle everywhere else
                          in the app, so credits stay scannable across views. */}
                      <Avatar
                        name={h.profile?.full_name ?? "Unknown"}
                        seed={h.user_id}
                        size={20}
                        title=""
                      />
                      {/* Their whole body of work, on this same surface. */}
                      <Link
                        href={`/content?person=${h.user_id}`}
                        className="transition-colors hover:text-[var(--accent)]"
                      >
                        {h.profile?.full_name ?? "Unknown"}
                      </Link>
                      {/* No score beside the name. A person's performance is
                          the performance of their videos, shown as real
                          totals when they are selected on Content -- not a
                          per-role multiplier stamped on their face here. */}
                      <button
                        className="opacity-0 transition-opacity group-hover/chip:opacity-100"
                        onClick={async () => {
                          const res = await unassignRole(h.id);
                          if (res.error) setError(res.error);
                          refresh();
                        }}
                        aria-label="Remove"
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
                {holders.length === 0 && (
                  <span className="text-xs text-[var(--muted)]">Unassigned</span>
                )}
              </div>
              {/* An ACTION picker, not a value one: it holds "" so it resets
                  after each pick and can assign a second person. The clear
                  row is therefore a no-op, exactly as the empty <option> was. */}
              <Select
                className="max-w-[160px]"
                value=""
                placeholder="Assign…"
                ariaLabel={`Assign ${role.name}`}
                onChange={async (v) => {
                  if (!v) return;
                  const res = await assignRole({
                    workspaceId,
                    contentItemId: item.id,
                    userId: v,
                    roleId: role.id,
                  });
                  if (res.error) setError(res.error);
                  refresh();
                }}
                options={members.map((m) => ({ value: m.userId, label: m.name }))}
              />
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

type AnalyticsDraft = {
  impressions: string;
  ctr: string;
  avgWatch: string;
  retention30: string;
  retention60: string;
};

/**
 * The data PRD section 4 is built around: CTR and retention are what
 * separate "this boosted" from "here is why" -- and both are owner-only.
 * With no connect flow to wait on, the client supplying their own numbers is
 * the route, not a fallback: this section shows the latest reading, labels
 * which route filled it, and keeps manual entry permanently open
 * (PRD-video-intelligence §2).
 */
function EnhancedMetrics({
  analytics,
  editing,
  draft,
  setDraft,
  onEdit,
  onCancel,
  onSave,
}: {
  analytics: AnalyticsRow[];
  editing: boolean;
  draft: AnalyticsDraft;
  setDraft: (d: AnalyticsDraft) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const latest = analytics[0] ?? null;

  return (
    <div className="mt-3 border-t border-[var(--border)] pt-2">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-xs font-medium text-[var(--muted)]">
          Enhanced metrics
        </span>
        {latest && (
          <span className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--muted)]">
            {latest.source}
          </span>
        )}
        <div className="flex-1" />
        {!editing && (
          <button
            className="text-xs text-[var(--muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--fg)]"
            onClick={onEdit}
          >
            {latest ? "Update" : "Add from a Studio export"}
          </button>
        )}
      </div>

      {editing ? (
        <div className="animate-rise flex flex-wrap items-end gap-2">
          <label className="text-xs text-[var(--muted)]">
            Impressions
            <input
              className="input tabular mt-1 w-28 py-1"
              value={draft.impressions}
              onChange={(e) => setDraft({ ...draft, impressions: e.target.value })}
            />
          </label>
          <label className="text-xs text-[var(--muted)]">
            CTR %
            <input
              className="input tabular mt-1 w-20 py-1"
              value={draft.ctr}
              onChange={(e) => setDraft({ ...draft, ctr: e.target.value })}
            />
          </label>
          <label className="text-xs text-[var(--muted)]">
            Avg watch (s)
            <input
              className="input tabular mt-1 w-24 py-1"
              value={draft.avgWatch}
              onChange={(e) => setDraft({ ...draft, avgWatch: e.target.value })}
            />
          </label>
          <label className="text-xs text-[var(--muted)]">
            Retention @30s %
            <input
              className="input tabular mt-1 w-24 py-1"
              value={draft.retention30}
              onChange={(e) => setDraft({ ...draft, retention30: e.target.value })}
            />
          </label>
          <label className="text-xs text-[var(--muted)]">
            Retention @60s %
            <input
              className="input tabular mt-1 w-24 py-1"
              value={draft.retention60}
              onChange={(e) => setDraft({ ...draft, retention60: e.target.value })}
            />
          </label>
          <button className="btn-primary py-1.5" onClick={onSave}>
            Save
          </button>
          <button className="btn py-1.5" onClick={onCancel}>
            Cancel
          </button>
          <p className="w-full text-xs text-[var(--muted)]">
            From YouTube Studio → Analytics, or the connected account once it
            syncs. Percentages, not fractions.
          </p>
        </div>
      ) : latest ? (
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <Metric
            label="Impressions"
            value={latest.impressions}
          />
          <span>
            <span className="text-xs text-[var(--muted)]">CTR </span>
            <span className="tabular font-medium">
              {latest.ctr != null ? `${(latest.ctr * 100).toFixed(1)}%` : "—"}
            </span>
          </span>
          <span>
            <span className="text-xs text-[var(--muted)]">Avg watch </span>
            <span className="tabular font-medium">
              {latest.avg_watch_seconds != null ? `${latest.avg_watch_seconds}s` : "—"}
            </span>
          </span>
          <span>
            <span className="text-xs text-[var(--muted)]">Retention @30s </span>
            <span className="tabular font-medium">
              {latest.retention_30s != null
                ? `${(latest.retention_30s * 100).toFixed(0)}%`
                : "—"}
            </span>
          </span>
        </div>
      ) : (
        <p className="text-xs text-[var(--muted)]">
          No CTR or retention data. Public metrics can show a post boosted,
          not why — that needs this data, from a connected account or a
          Studio export (Accounts page).
        </p>
      )}
    </div>
  );
}

/**
 * The stored time series, made visible. Scoring evaluates at a fixed maturity
 * window rather than on lifetime totals, so the history is the data that
 * matters -- a single current number cannot support it.
 *
 * Every column the snapshot HOLDS is shown. It previously drew views alone
 * while likes, comments, shares and saves were fetched on every page load and
 * silently dropped -- four of the six stored fields, invisible. Anyone asking
 * "did the edit change how people responded, or just how many arrived?" was
 * looking at a panel that had the answer and would not print it.
 *
 * Shares and saves appear only when a platform reports them, rather than as
 * permanent "—" columns: YouTube gives neither, so on a YouTube post those two
 * columns would be dead width on every row forever.
 */
function SnapshotHistory({ rows }: { rows: SnapshotRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="animate-rise mt-2 text-xs text-[var(--muted)]">
        No snapshots recorded yet. One is taken each time this account syncs.
      </p>
    );
  }

  const peak = Math.max(...rows.map((r) => r.views ?? 0), 1);
  const hasShares = rows.some((r) => r.shares != null);
  const hasSaves = rows.some((r) => r.saves != null);
  // Ascending for the reader: growth should run left to right.
  const ordered = [...rows].reverse();

  return (
    <div className="animate-rise mt-3 border-t border-[var(--border)] pt-2">
      <div className="mb-1.5 text-xs text-[var(--muted)]">
        Snapshot history — {rows.length} recorded, one per sync. Each row is
        what the numbers were at that moment; the change column compares it to
        the reading before it.
      </div>

      {/* The row is wider than a phone. Scrolling it beats wrapping or
          dropping columns -- the numbers only mean anything side by side. */}
      <div className="-mx-1 overflow-x-auto px-1">
        <div className="min-w-[440px] space-y-1">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-[var(--muted)]">
            <span className="w-28 shrink-0">Taken</span>
            <span className="flex-1">Views</span>
            <span className="w-20 shrink-0 text-right">Views</span>
            <span className="w-16 shrink-0 text-right">Change</span>
            <span className="w-14 shrink-0 text-right">Likes</span>
            <span className="w-16 shrink-0 text-right">Comments</span>
            {hasShares && <span className="w-14 shrink-0 text-right">Shares</span>}
            {hasSaves && <span className="w-14 shrink-0 text-right">Saves</span>}
          </div>

          {ordered.map((r, i) => {
            const prev = i > 0 ? (ordered[i - 1].views ?? 0) : null;
            const views = r.views ?? 0;
            const delta = prev == null ? null : views - prev;
            return (
              <div key={r.captured_at + i} className="flex items-center gap-2 text-xs">
                <span className="w-28 shrink-0 text-[var(--muted)]">
                  {new Date(r.captured_at).toLocaleDateString([], {
                    day: "numeric",
                    month: "short",
                  })}{" "}
                  {new Date(r.captured_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--bg-subtle)]">
                  <div
                    className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300"
                    style={{ width: `${Math.max(2, (views / peak) * 100)}%` }}
                  />
                </div>
                <span className="tabular w-20 shrink-0 text-right">
                  {views.toLocaleString()}
                </span>
                <span
                  className={`tabular w-16 shrink-0 text-right ${
                    delta && delta > 0 ? "text-emerald-500" : "text-[var(--muted)]"
                  }`}
                >
                  {delta == null ? "—" : delta > 0 ? `+${delta.toLocaleString()}` : delta}
                </span>
                {/* null is "the platform never told us", which is not zero --
                    so it prints as a dash rather than a number nobody
                    measured. */}
                <Cell value={r.likes} />
                <Cell value={r.comments} width="w-16" />
                {hasShares && <Cell value={r.shares} />}
                {hasSaves && <Cell value={r.saves} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Cell({ value, width = "w-14" }: { value: number | null; width?: string }) {
  return (
    <span
      className={`tabular ${width} shrink-0 text-right ${
        value == null ? "text-[var(--muted)]" : ""
      }`}
    >
      {value == null ? "—" : value.toLocaleString()}
    </span>
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
