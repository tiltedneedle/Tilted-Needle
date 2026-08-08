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

/** Platform brand colours, for chips and legends only -- never for data encoding. */
export const PLATFORM_COLORS: Record<string, string> = {
  instagram: "#e1306c",
  tiktok: "#00f2ea",
  youtube: "#ff0000",
  facebook: "#1877f2",
};

/** Display names for platform slugs -- was copy-pasted in three pages. */
export const PLATFORM_LABEL: Record<string, string> = {
  youtube: "YouTube",
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
