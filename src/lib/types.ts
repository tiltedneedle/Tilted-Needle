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
  description: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  is_billable: boolean;
  project?: Pick<Project, "id" | "name" | "color"> & {
    client?: Pick<Client, "id" | "name"> | null;
  } | null;
  task?: Pick<Task, "id" | "name"> | null;
};

/** Managers and above can see the whole workspace and edit others' entries. */
export const MANAGER_ROLES: WorkspaceRole[] = ["owner", "admin", "manager"];

export function canManage(role: WorkspaceRole | undefined): boolean {
  return !!role && MANAGER_ROLES.includes(role);
}
