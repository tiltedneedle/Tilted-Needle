"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_WORKSPACE_COOKIE } from "@/lib/workspace";

type Result = { error?: string };

/** Shape consumed by useActionState-driven forms. */
export type ActionState = { error?: string };

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "workspace"
  );
}

export async function createWorkspaceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name is required." };

  const supabase = await createClient();
  // Slug is globally unique; suffix keeps two "Studio" workspaces from colliding.
  const slug = `${slugify(name)}-${Math.random().toString(36).slice(2, 7)}`;

  const { data, error } = await supabase.rpc("create_workspace", {
    ws_name: name,
    ws_slug: slug,
  });
  if (error) return { error: error.message };

  const store = await cookies();
  store.set(ACTIVE_WORKSPACE_COOKIE, data.id, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });

  redirect("/track");
}

export async function switchWorkspace(workspaceId: string) {
  const store = await cookies();
  store.set(ACTIVE_WORKSPACE_COOKIE, workspaceId, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  revalidatePath("/", "layout");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/* ---- Time entries ------------------------------------------------------- */

export async function startTimer(input: {
  workspaceId: string;
  description: string;
  projectId: string | null;
  taskId: string | null;
  isBillable: boolean;
}): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase.from("time_entries").insert({
    workspace_id: input.workspaceId,
    user_id: user.id,
    description: input.description,
    project_id: input.projectId,
    task_id: input.taskId,
    is_billable: input.isBillable,
    started_at: new Date().toISOString(),
  });

  if (error) {
    // Surfaced by the one-running-timer-per-user unique index.
    if (error.code === "23505") return { error: "A timer is already running." };
    return { error: error.message };
  }
  revalidatePath("/", "layout");
  return {};
}

export async function stopTimer(entryId: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("time_entries")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", entryId)
    .is("ended_at", null);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return {};
}

export async function createManualEntry(input: {
  workspaceId: string;
  description: string;
  projectId: string | null;
  taskId: string | null;
  startedAt: string;
  endedAt: string;
  isBillable: boolean;
}): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  if (new Date(input.endedAt) <= new Date(input.startedAt)) {
    return { error: "End time must be after start time." };
  }

  const { error } = await supabase.from("time_entries").insert({
    workspace_id: input.workspaceId,
    user_id: user.id,
    description: input.description,
    project_id: input.projectId,
    task_id: input.taskId,
    is_billable: input.isBillable,
    started_at: input.startedAt,
    ended_at: input.endedAt,
  });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return {};
}

export async function updateEntry(
  entryId: string,
  patch: {
    description?: string;
    projectId?: string | null;
    taskId?: string | null;
    contentItemId?: string | null;
    startedAt?: string;
    endedAt?: string;
    isBillable?: boolean;
  },
): Promise<Result> {
  const supabase = await createClient();
  const row: Record<string, unknown> = {};
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.projectId !== undefined) row.project_id = patch.projectId;
  if (patch.taskId !== undefined) row.task_id = patch.taskId;
  if (patch.contentItemId !== undefined) row.content_item_id = patch.contentItemId;
  if (patch.startedAt !== undefined) row.started_at = patch.startedAt;
  if (patch.endedAt !== undefined) row.ended_at = patch.endedAt;
  if (patch.isBillable !== undefined) row.is_billable = patch.isBillable;

  const { error } = await supabase.from("time_entries").update(row).eq("id", entryId);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return {};
}

export async function deleteEntry(entryId: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("time_entries").delete().eq("id", entryId);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return {};
}

/* ---- Clients, projects, tasks, tags ------------------------------------- */

export async function createClientRecord(
  workspaceId: string,
  name: string,
): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("clients")
    .insert({ workspace_id: workspaceId, name: name.trim() });
  if (error) return { error: error.message };
  revalidatePath("/clients");
  return {};
}

export async function createProject(input: {
  workspaceId: string;
  name: string;
  clientId: string | null;
  color: string;
  isBillable: boolean;
}): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("projects").insert({
    workspace_id: input.workspaceId,
    name: input.name.trim(),
    client_id: input.clientId,
    color: input.color,
    is_billable: input.isBillable,
  });
  if (error) return { error: error.message };
  revalidatePath("/projects");
  return {};
}

export async function createTask(
  workspaceId: string,
  projectId: string,
  name: string,
): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .insert({ workspace_id: workspaceId, project_id: projectId, name: name.trim() });
  if (error) return { error: error.message };
  revalidatePath("/projects");
  return {};
}

export async function createTag(workspaceId: string, name: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("tags")
    .insert({ workspace_id: workspaceId, name: name.trim() });
  if (error) return { error: error.message };
  revalidatePath("/tags");
  return {};
}

/* ---- Phase 2: accounts, content, posts, metrics ------------------------- */

export async function createAccount(input: {
  workspaceId: string;
  clientId: string | null;
  platformSlug: string;
  handle: string;
}): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("accounts").insert({
    workspace_id: input.workspaceId,
    client_id: input.clientId,
    platform_slug: input.platformSlug,
    handle: input.handle.trim(),
  });
  if (error) {
    if (error.code === "23505")
      return { error: "That handle already exists for this platform." };
    return { error: error.message };
  }
  revalidatePath("/accounts");
  return {};
}

export async function createContentItem(input: {
  workspaceId: string;
  clientId: string | null;
  title: string;
  subject: string | null;
  hook: string | null;
  lengthSeconds: number | null;
  producedAt: string | null;
}): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("content_items").insert({
    workspace_id: input.workspaceId,
    client_id: input.clientId,
    title: input.title.trim(),
    subject: input.subject,
    hook: input.hook,
    length_seconds: input.lengthSeconds,
    produced_at: input.producedAt,
  });
  if (error) return { error: error.message };
  revalidatePath("/content");
  return {};
}

export async function updateContentItem(
  id: string,
  patch: Record<string, unknown>,
): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("content_items").update(patch).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/content");
  return {};
}

export async function deleteContentItem(id: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("content_items").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/content");
  return {};
}

/** Attaches a content item to a platform account -- one row per platform. */
export async function addPlatformPost(input: {
  workspaceId: string;
  contentItemId: string;
  accountId: string;
  url: string | null;
  postedAt: string | null;
}): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("platform_posts").insert({
    workspace_id: input.workspaceId,
    content_item_id: input.contentItemId,
    account_id: input.accountId,
    url: input.url,
    posted_at: input.postedAt,
    source: "manual",
  });
  if (error) {
    if (error.code === "23505")
      return { error: "This content is already posted to that account." };
    return { error: error.message };
  }
  revalidatePath("/content");
  return {};
}

export async function updatePlatformPost(
  id: string,
  patch: Record<string, unknown>,
): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("platform_posts").update(patch).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/content");
  return {};
}

export async function deletePlatformPost(id: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("platform_posts").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/content");
  return {};
}

/**
 * Records metrics as a new snapshot rather than overwriting. Scoring evaluates
 * at a fixed maturity window, which needs the history (PRD 5 Step 1).
 */
export async function recordSnapshot(input: {
  workspaceId: string;
  platformPostId: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
}): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("post_snapshots").insert({
    workspace_id: input.workspaceId,
    platform_post_id: input.platformPostId,
    views: input.views,
    likes: input.likes,
    comments: input.comments,
    shares: input.shares,
    saves: input.saves,
    source: "manual",
  });
  if (error) return { error: error.message };
  revalidatePath("/content");
  return {};
}

export async function assignRole(input: {
  workspaceId: string;
  contentItemId: string;
  userId: string;
  roleId: string;
}): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("content_assignments").insert({
    workspace_id: input.workspaceId,
    content_item_id: input.contentItemId,
    user_id: input.userId,
    role_id: input.roleId,
    source: "manual",
  });
  if (error) {
    if (error.code === "23505") return { error: "Already assigned." };
    return { error: error.message };
  }
  revalidatePath("/content");
  return {};
}

export async function unassignRole(id: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("content_assignments").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/content");
  return {};
}

/** Archive rather than delete: entries reference these rows as history. */
export async function setArchived(
  table: "clients" | "projects" | "tasks" | "tags" | "accounts",
  id: string,
  archived: boolean,
): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from(table)
    .update({ is_archived: archived })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return {};
}
