export type WorkspaceRole = "owner" | "admin" | "manager" | "member" | "client";
export type SeatType = "full" | "limited";
export type TaskStatus = "active" | "done";

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  created_at: string;
};

export type Membership = {
  id: string;
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  seat: SeatType;
  is_active: boolean;
};

export type Client = {
  id: string;
  workspace_id: string;
  name: string;
  email: string | null;
  is_archived: boolean;
};

export type Project = {
  id: string;
  workspace_id: string;
  client_id: string | null;
  name: string;
  color: string;
  is_billable: boolean;
  is_archived: boolean;
  client?: Pick<Client, "id" | "name"> | null;
};

export type Task = {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  status: TaskStatus;
  is_archived: boolean;
};

export type Tag = {
  id: string;
  workspace_id: string;
  name: string;
  is_archived: boolean;
};

export type TimeEntry = {
  id: string;
  workspace_id: string;
  user_id: string;
  project_id: string | null;
  task_id: string | null;
  content_item_id: string | null;
  description: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  is_billable: boolean;
  project?: Pick<Project, "id" | "name" | "color"> & {
    client?: Pick<Client, "id" | "name"> | null;
  } | null;
  task?: Pick<Task, "id" | "name"> | null;
  content?: { id: string; title: string } | null;
};

/* ---- Phase 2: multi-platform content ---------------------------------- */

export type Platform = {
  slug: string;
  display_name: string;
  /** Owner-credential flows are retired; 'none' is the only live value. */
  auth_model: "none";
  supports_public_read: boolean;
  view_semantics: string;
  available_metrics: string[];
  maturity_window_days: number;
  sort_order: number;
};

export type Account = {
  id: string;
  workspace_id: string;
  client_id: string | null;
  platform_slug: string;
  handle: string;
  /**
   * 'manual' | 'api'. Near-vestigial: every account currently reads 'manual',
   * including the ones syncing nightly, so it must NOT be used to decide
   * whether an account refreshes itself. Ask the provider instead
   * (PROVIDERS[slug].capability.canFetchMetrics).
   */
  connection_mode: string;
  is_archived: boolean;
  /** Selected by /accounts and /data; optional because lighter queries omit it. */
  sync_enabled?: boolean;
  last_synced_at?: string | null;
  last_sync_error?: string | null;
  client?: Pick<Client, "id" | "name"> | null;
};

export type ContentItem = {
  id: string;
  workspace_id: string;
  client_id: string | null;
  title: string;
  subject: string | null;
  hook: string | null;
  music_used: string | null;
  length_seconds: number | null;
  produced_at: string | null;
  notes: string | null;
  client?: Pick<Client, "id" | "name"> | null;
};

export type PostMetrics = {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  reach: number | null;
  captured_at: string;
};

export type PlatformPost = {
  id: string;
  workspace_id: string;
  content_item_id: string;
  account_id: string;
  url: string | null;
  /** The platform's own id for this post -- a YouTube video id, a TikTok
      numeric id. Populated for anything discovered automatically; null for
      a manual post nobody has attached a URL to. Used to build the free
      official embed player (see VideoEmbed.tsx) without re-parsing url. */
  external_id: string | null;
  posted_at: string | null;
  source: string;
  is_best_performing: boolean;
  comment_sentiment: string | null;
  // Embedded relations may arrive as arrays -- unwrap with one().
  account?: Account | Account[] | null;
  metrics?: PostMetrics | PostMetrics[] | null;
};

export type Role = {
  id: string;
  workspace_id: string;
  slug: string;
  name: string;
  sort_order: number;
};

export type ContentAssignment = {
  id: string;
  content_item_id: string;
  user_id: string;
  role_id: string;
  source: string;
  profile?: { full_name: string | null } | null;
};

/**
 * PostgREST returns embedded rows from a *view* as an array, because a view
 * carries no unique constraint to prove the relationship is one-to-one.
 * post_current_metrics is one row per post by construction, so unwrap it.
 */
export function one<T>(embedded: T | T[] | null | undefined): T | null {
  if (Array.isArray(embedded)) return embedded[0] ?? null;
  return embedded ?? null;
}

/**
 * Brand identity. Dots, icons, chips -- anything whose job is "which platform
 * is this".
 *
 * NOT for chart marks. See CHART_COLORS below: TikTok's brand cyan measures
 * L 0.868, which is outside the usable band on a dark surface, so as a line on
 * a near-black card it glares and out-shouts every other series. A 6px dot at
 * that lightness is fine and instantly recognisable; a 200px line is not.
 */
export const PLATFORM_COLORS: Record<string, string> = {
  instagram: "#e1306c",
  tiktok: "#00f2ea",
  youtube: "#ff0000",
  /**
   * Shorts gets its OWN colour, and that is a reversal.
   *
   * It used to share YouTube red on the reasoning that two near-identical
   * reds in a legend read as a rendering bug, with the icon carrying the
   * distinction. But identical is not near-identical: two swatches the same
   * colour read as ONE platform, which is the worse error -- and these are
   * genuinely different platforms, not two views of one. The platforms table
   * says so itself: a Short counts a view IMMEDIATELY where long-form counts
   * at 30 seconds, and they mature over 7 days versus 28. On live data
   * Shorts pulls 2.8x the likes of long-form on comparable reach, which is a
   * real finding that a shared swatch made impossible to see.
   *
   * #e8590c measured out of eight candidates as the only one clearing both
   * bars: dE 27.8 from its nearest neighbour (YouTube red) and >= 3.0
   * contrast against BOTH page surfaces. The brighter oranges scored higher
   * on distance but fell to 2.0-2.4 against the light background, where a
   * chart series would have gone pale.
   */
  youtube_shorts: "#e8590c",
  facebook: "#1877f2",
};

/** Display names for platform slugs -- was copy-pasted in three pages. */
export const PLATFORM_LABEL: Record<string, string> = {
  youtube: "YouTube",
  youtube_shorts: "YouTube Shorts",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
};

/** One line of the daily assignment sheet: one person, one day, one task. */
export type Todo = {
  id: string;
  workspace_id: string;
  user_id: string;
  client_id: string | null;
  assigned_on: string;
  description: string;
  is_done: boolean;
  done_at: string | null;
  profile?: { full_name: string | null } | { full_name: string | null }[] | null;
  client?: { id: string; name: string } | { id: string; name: string }[] | null;
};

/** A training course: an ordered set of videos watched strictly in sequence. */
export type TrainingModule = {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  sort_order: number;
  is_archived: boolean;
};

export type TrainingVideo = {
  id: string;
  module_id: string;
  title: string;
  youtube_url: string;
  sort_order: number;
  created_at: string;
};

/** Managers and above can see the whole workspace and edit others' entries. */
export const MANAGER_ROLES: WorkspaceRole[] = ["owner", "admin", "manager"];

export function canManage(role: WorkspaceRole | undefined): boolean {
  return !!role && MANAGER_ROLES.includes(role);
}

/**
 * The same platforms, as CHART MARKS.
 *
 * Separate from PLATFORM_COLORS because identity and legibility are different
 * jobs with different constraints. A brand colour only has to be recognisable;
 * a chart mark has to sit in a lightness band, hold its chroma, stay apart from
 * its neighbours under colour-blind simulation, and clear 3:1 against the
 * surface it is drawn on.
 *
 * Validated with the dataviz palette checker rather than by eye. TikTok's
 * #00f2ea failed the lightness band on a dark surface at L 0.868 -- it was the
 * brightest thing on the home page and pulled the eye off every other series.
 * #1aa9a3 passes every check on the dark surface and all but contrast on
 * white, where it lands at 2.9:1 against a 3:1 bar.
 *
 * That remaining WARN is discharged rather than ignored: the checker allows a
 * sub-3:1 mark when the chart carries visible labels, and every chart here is
 * directly labelled -- "TikTok +498k" on the momentum cards, "TikTok
 * 59,823,484 views" on the reach rows. Darkening it further to win the point
 * outright fails the chroma floor instead and the teal starts reading grey,
 * which is the worse trade.
 *
 * YouTube and Instagram passed unchanged, so they keep their brand values and
 * a chart still reads as the platform it describes.
 */
export const CHART_COLORS: Record<string, string> = {
  instagram: "#e1306c",
  tiktok: "#1aa9a3",
  youtube: "#ff0000",
  // Distinct from YouTube for the reasons given on PLATFORM_COLORS above --
  // these two must never read as one series on a chart.
  youtube_shorts: "#e8590c",
  facebook: "#1877f2",
};
