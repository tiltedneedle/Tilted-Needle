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

/* ---- Phase 4: rates, expenses, invoices --------------------------------- */

/** Empty string clears a rate so it falls through to the next level. */
function toRate(v: string): number | null {
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function updateWorkspaceBilling(
  workspaceId: string,
  defaultRate: string,
  currency: string,
): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("workspaces")
    .update({
      default_billable_rate: toRate(defaultRate),
      currency: currency.trim().toUpperCase() || "USD",
    })
    .eq("id", workspaceId);
  if (error) return { error: error.message };
  revalidatePath("/rates");
  return {};
}

export async function updateMemberRates(
  membershipId: string,
  billable: string,
  cost: string,
): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("memberships")
    .update({ billable_rate: toRate(billable), cost_rate: toRate(cost) })
    .eq("id", membershipId);
  if (error) return { error: error.message };
  revalidatePath("/rates");
  return {};
}

export async function updateProjectBilling(
  projectId: string,
  patch: { billable_rate?: string; budget_amount?: string; budget_hours?: string },
): Promise<Result> {
  const supabase = await createClient();
  const row: Record<string, number | null> = {};
  if (patch.billable_rate !== undefined) row.billable_rate = toRate(patch.billable_rate);
  if (patch.budget_amount !== undefined) row.budget_amount = toRate(patch.budget_amount);
  if (patch.budget_hours !== undefined) row.budget_hours = toRate(patch.budget_hours);
  const { error } = await supabase.from("projects").update(row).eq("id", projectId);
  if (error) return { error: error.message };
  revalidatePath("/projects");
  revalidatePath("/rates");
  return {};
}

export async function createExpense(input: {
  workspaceId: string;
  projectId: string | null;
  category: string;
  notes: string;
  amount: number;
  spentOn: string;
  isBillable: boolean;
}): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  if (!(input.amount > 0)) return { error: "Amount must be greater than zero." };

  const { error } = await supabase.from("expenses").insert({
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    user_id: user.id,
    category: input.category.trim() || null,
    notes: input.notes.trim() || null,
    amount: input.amount,
    spent_on: input.spentOn,
    is_billable: input.isBillable,
  });
  if (error) return { error: error.message };
  revalidatePath("/expenses");
  return {};
}

export async function deleteExpense(id: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/expenses");
  return {};
}

/**
 * Builds an invoice from everything unbilled for a client, then marks those
 * rows as invoiced so a second run cannot bill them again.
 *
 * Time is grouped by resolved rate rather than listed per entry: a month of
 * tracking is hundreds of rows, and a client wants "112h at $50", not a ledger.
 */
export async function generateInvoice(input: {
  workspaceId: string;
  clientId: string;
  upToDate: string;
}): Promise<Result & { invoiceId?: string }> {
  const supabase = await createClient();

  const { data: ws } = await supabase
    .from("workspaces")
    .select("currency")
    .eq("id", input.workspaceId)
    .maybeSingle();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .eq("workspace_id", input.workspaceId)
    .eq("client_id", input.clientId);

  const projectIds = (projects ?? []).map((p) => p.id);
  if (projectIds.length === 0)
    return { error: "This client has no projects, so there is nothing to bill." };

  const { data: entries } = await supabase
    .from("time_entries")
    .select("id, project_id, duration_seconds, is_billable")
    .eq("workspace_id", input.workspaceId)
    .in("project_id", projectIds)
    .is("invoice_id", null)
    .eq("is_billable", true)
    .not("ended_at", "is", null)
    .lte("started_at", `${input.upToDate}T23:59:59`);

  const { data: expenses } = await supabase
    .from("expenses")
    .select("id, project_id, amount, category, notes")
    .eq("workspace_id", input.workspaceId)
    .in("project_id", projectIds)
    .is("invoice_id", null)
    .eq("is_billable", true)
    .lte("spent_on", input.upToDate);

  const billableEntries = entries ?? [];
  const billableExpenses = expenses ?? [];
  if (billableEntries.length === 0 && billableExpenses.length === 0)
    return { error: "Nothing unbilled for this client up to that date." };

  // One query for every rate. Resolving per entry meant a round trip per row.
  const rates = new Map<string, number>();
  const { data: rateRows } = await supabase
    .from("time_entry_billing")
    .select("time_entry_id, billable_rate")
    .in(
      "time_entry_id",
      billableEntries.map((e) => e.id),
    );
  for (const r of (rateRows ?? []) as {
    time_entry_id: string;
    billable_rate: number | null;
  }[]) {
    if (r.billable_rate != null) rates.set(r.time_entry_id, Number(r.billable_rate));
  }

  const projectName = new Map((projects ?? []).map((p) => [p.id, p.name]));
  const grouped = new Map<string, { seconds: number; rate: number; project: string }>();
  for (const e of billableEntries) {
    const rate = rates.get(e.id);
    if (rate == null) continue; // No rate configured -- excluded, not billed at 0.
    const key = `${e.project_id}::${rate}`;
    if (!grouped.has(key))
      grouped.set(key, {
        seconds: 0,
        rate,
        project: projectName.get(e.project_id ?? "") ?? "Work",
      });
    grouped.get(key)!.seconds += e.duration_seconds ?? 0;
  }

  if (grouped.size === 0 && billableExpenses.length === 0)
    return {
      error:
        "Unbilled time exists but no billable rate is configured, so nothing could be priced.",
    };

  const { data: existing } = await supabase
    .from("invoices")
    .select("number")
    .eq("workspace_id", input.workspaceId);

  const { nextInvoiceNumber } = await import("@/lib/billing");
  const number = nextInvoiceNumber((existing ?? []).map((i) => i.number));

  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .insert({
      workspace_id: input.workspaceId,
      client_id: input.clientId,
      number,
      currency: ws?.currency ?? "USD",
    })
    .select()
    .single();
  if (invErr || !invoice) return { error: invErr?.message ?? "Could not create invoice." };

  let sort = 0;
  const lines = [...grouped.values()].map((g) => ({
    workspace_id: input.workspaceId,
    invoice_id: invoice.id,
    description: `${g.project} — time`,
    quantity: Number((g.seconds / 3600).toFixed(2)),
    unit_amount: g.rate,
    sort_order: sort++,
  }));

  for (const x of billableExpenses) {
    lines.push({
      workspace_id: input.workspaceId,
      invoice_id: invoice.id,
      description: x.category
        ? `${x.category}${x.notes ? ` — ${x.notes}` : ""}`
        : (x.notes ?? "Expense"),
      quantity: 1,
      unit_amount: Number(x.amount),
      sort_order: sort++,
    });
  }

  const { error: lineErr } = await supabase.from("invoice_lines").insert(lines);
  if (lineErr) {
    // Roll back rather than leave an invoice with no lines behind.
    await supabase.from("invoices").delete().eq("id", invoice.id);
    return { error: lineErr.message };
  }

  const billedEntryIds = billableEntries
    .filter((e) => rates.has(e.id))
    .map((e) => e.id);
  if (billedEntryIds.length)
    await supabase
      .from("time_entries")
      .update({ invoice_id: invoice.id })
      .in("id", billedEntryIds);
  if (billableExpenses.length)
    await supabase
      .from("expenses")
      .update({ invoice_id: invoice.id })
      .in("id", billableExpenses.map((x) => x.id));

  revalidatePath("/invoices");
  return { invoiceId: invoice.id };
}

export async function updateInvoiceStatus(id: string, status: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("invoices").update({ status }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/invoices");
  return {};
}

/** Releases the billed time and expenses so they can be invoiced again. */
export async function deleteInvoice(id: string): Promise<Result> {
  const supabase = await createClient();
  await supabase.from("time_entries").update({ invoice_id: null }).eq("invoice_id", id);
  await supabase.from("expenses").update({ invoice_id: null }).eq("invoice_id", id);
  const { error } = await supabase.from("invoices").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/invoices");
  return {};
}

/* ---- Phase 6: owner-only analytics (manual path) ------------------------ */

/**
 * Manual entry for CTR/retention, the always-available path for a client to
 * hand over Studio-export numbers without waiting on OAuth credentials (PRD
 * 4, 11 open question #2). Same table, same downstream scoring, as an OAuth
 * sync would populate.
 */
export async function recordAnalytics(input: {
  workspaceId: string;
  platformPostId: string;
  impressions: number | null;
  ctrPercent: number | null;
  avgWatchSeconds: number | null;
  retention30sPercent: number | null;
  retention60sPercent: number | null;
}): Promise<Result> {
  const supabase = await createClient();
  const pct = (v: number | null) => (v == null ? null : v / 100);
  const { error } = await supabase.from("post_analytics").insert({
    workspace_id: input.workspaceId,
    platform_post_id: input.platformPostId,
    impressions: input.impressions,
    ctr: pct(input.ctrPercent),
    avg_watch_seconds: input.avgWatchSeconds,
    retention_30s: pct(input.retention30sPercent),
    retention_60s: pct(input.retention60sPercent),
    source: "manual",
  });
  if (error) return { error: error.message };
  revalidatePath("/content");
  return {};
}

/* ---- Phase 7: approvals, time off, groups, capacity --------------------- */

export async function submitTimesheet(input: {
  workspaceId: string;
  periodStart: string;
  periodEnd: string;
}): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase.from("timesheet_submissions").upsert(
    {
      workspace_id: input.workspaceId,
      user_id: user.id,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      status: "submitted",
      submitted_at: new Date().toISOString(),
      reviewed_by: null,
      reviewed_at: null,
    },
    { onConflict: "workspace_id,user_id,period_start" },
  );
  if (error) return { error: error.message };
  revalidatePath("/timesheet");
  revalidatePath("/approvals");
  return {};
}

export async function reviewTimesheet(
  id: string,
  status: "approved" | "rejected",
  note: string,
): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase
    .from("timesheet_submissions")
    .update({
      status,
      review_note: note.trim() || null,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/approvals");
  return {};
}

export async function createGroup(workspaceId: string, name: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("user_groups")
    .insert({ workspace_id: workspaceId, name: name.trim() });
  if (error) {
    if (error.code === "23505") return { error: "A group with that name already exists." };
    return { error: error.message };
  }
  revalidatePath("/team");
  return {};
}

export async function deleteGroup(id: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("user_groups").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/team");
  return {};
}

export async function setGroupMember(
  groupId: string,
  userId: string,
  inGroup: boolean,
): Promise<Result> {
  const supabase = await createClient();
  const { error } = inGroup
    ? await supabase.from("user_group_members").insert({ group_id: groupId, user_id: userId })
    : await supabase
        .from("user_group_members")
        .delete()
        .eq("group_id", groupId)
        .eq("user_id", userId);
  if (error) return { error: error.message };
  revalidatePath("/team");
  return {};
}

export async function updateCapacity(membershipId: string, hoursPerWeek: string): Promise<Result> {
  const n = Number(hoursPerWeek);
  if (!Number.isFinite(n) || n < 0) return { error: "Enter a non-negative number of hours." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("memberships")
    .update({ weekly_capacity_hours: n })
    .eq("id", membershipId);
  if (error) return { error: error.message };
  revalidatePath("/team");
  revalidatePath("/capacity");
  return {};
}

export async function createTimeOffPolicy(
  workspaceId: string,
  name: string,
  daysPerYear: string,
  requiresApproval: boolean,
): Promise<Result> {
  const days = Number(daysPerYear);
  if (!Number.isFinite(days) || days < 0) return { error: "Enter a non-negative number of days." };
  const supabase = await createClient();
  const { error } = await supabase.from("time_off_policies").insert({
    workspace_id: workspaceId,
    name: name.trim(),
    days_per_year: days,
    requires_approval: requiresApproval,
  });
  if (error) {
    if (error.code === "23505") return { error: "A policy with that name already exists." };
    return { error: error.message };
  }
  revalidatePath("/time-off");
  return {};
}

export async function createTimeOffRequest(input: {
  workspaceId: string;
  policyId: string;
  startDate: string;
  endDate: string;
  hours: number;
  note: string;
}): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  if (input.endDate < input.startDate) return { error: "End date is before the start date." };
  if (!(input.hours > 0)) return { error: "Hours must be greater than zero." };

  const { data: policy } = await supabase
    .from("time_off_policies")
    .select("requires_approval")
    .eq("id", input.policyId)
    .maybeSingle();

  const { error } = await supabase.from("time_off_requests").insert({
    workspace_id: input.workspaceId,
    user_id: user.id,
    policy_id: input.policyId,
    start_date: input.startDate,
    end_date: input.endDate,
    hours: input.hours,
    note: input.note.trim() || null,
    // Policies that never require approval auto-approve on submission rather
    // than sitting in a pending queue nobody is meant to review.
    status: policy?.requires_approval === false ? "approved" : "pending",
  });
  if (error) return { error: error.message };
  revalidatePath("/time-off");
  return {};
}

export async function reviewTimeOffRequest(
  id: string,
  status: "approved" | "rejected",
): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { error } = await supabase
    .from("time_off_requests")
    .update({ status, reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/time-off");
  return {};
}

export async function cancelTimeOffRequest(id: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("time_off_requests")
    .update({ status: "cancelled" })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/time-off");
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
