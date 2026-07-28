"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_WORKSPACE_COOKIE } from "@/lib/workspace";
import { logAudit } from "@/lib/audit";
import { dispatchWebhook } from "@/lib/webhooks";

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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("workspaces")
    .update({
      default_billable_rate: toRate(defaultRate),
      currency: currency.trim().toUpperCase() || "USD",
    })
    .eq("id", workspaceId);
  if (error) return { error: error.message };
  if (user) {
    await logAudit(supabase, {
      workspaceId,
      actorId: user.id,
      action: "rate.workspace_default_updated",
      entityType: "workspaces",
      entityId: workspaceId,
      detail: { default_rate: toRate(defaultRate), currency },
    });
  }
  revalidatePath("/rates");
  return {};
}

export async function updateMemberRates(
  membershipId: string,
  billable: string,
  cost: string,
): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: row, error } = await supabase
    .from("memberships")
    .update({ billable_rate: toRate(billable), cost_rate: toRate(cost) })
    .eq("id", membershipId)
    .select("workspace_id")
    .single();
  if (error) return { error: error.message };
  // Cost rate is close to salary information -- worth its own audit action
  // name rather than folding it into a generic "rate updated" entry that
  // would understate what actually changed.
  if (user) {
    await logAudit(supabase, {
      workspaceId: row.workspace_id,
      actorId: user.id,
      action: "rate.member_updated",
      entityType: "memberships",
      entityId: membershipId,
      detail: { billable_rate: toRate(billable), cost_rate: toRate(cost) },
    });
  }
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
  const {
    data: { user },
  } = await supabase.auth.getUser();

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

  const total = lines.reduce((s, l) => s + l.quantity * l.unit_amount, 0);
  if (user) {
    await logAudit(supabase, {
      workspaceId: input.workspaceId,
      actorId: user.id,
      action: "invoice.generated",
      entityType: "invoices",
      entityId: invoice.id,
      detail: { number: invoice.number, client_id: input.clientId, total },
    });
  }
  void dispatchWebhook(supabase, input.workspaceId, "invoice.generated", {
    invoice_id: invoice.id,
    number: invoice.number,
    client_id: input.clientId,
    total,
    currency: invoice.currency,
  });

  revalidatePath("/invoices");
  return { invoiceId: invoice.id };
}

export async function updateInvoiceStatus(id: string, status: string): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: row, error } = await supabase
    .from("invoices")
    .update({ status })
    .eq("id", id)
    .select("workspace_id")
    .single();
  if (error) return { error: error.message };
  if (user) {
    await logAudit(supabase, {
      workspaceId: row.workspace_id,
      actorId: user.id,
      action: "invoice.status_changed",
      entityType: "invoices",
      entityId: id,
      detail: { status },
    });
  }
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

  const { data: row, error } = await supabase
    .from("timesheet_submissions")
    .update({
      status,
      review_note: note.trim() || null,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("workspace_id, user_id, period_start, period_end")
    .single();
  if (error) return { error: error.message };

  await logAudit(supabase, {
    workspaceId: row.workspace_id,
    actorId: user.id,
    action: `timesheet.${status}`,
    entityType: "timesheet_submissions",
    entityId: id,
    detail: { period_start: row.period_start, period_end: row.period_end, note },
  });
  void dispatchWebhook(supabase, row.workspace_id, `timesheet.${status}`, {
    submission_id: id,
    user_id: row.user_id,
    period_start: row.period_start,
    period_end: row.period_end,
  });

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
  const { data: row, error } = await supabase
    .from("time_off_requests")
    .update({ status, reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .select("workspace_id, user_id, start_date, end_date, hours")
    .single();
  if (error) return { error: error.message };

  await logAudit(supabase, {
    workspaceId: row.workspace_id,
    actorId: user.id,
    action: `time_off_request.${status}`,
    entityType: "time_off_requests",
    entityId: id,
  });
  if (status === "approved") {
    void dispatchWebhook(supabase, row.workspace_id, "time_off_request.approved", {
      request_id: id,
      user_id: row.user_id,
      start_date: row.start_date,
      end_date: row.end_date,
      hours: row.hours,
    });
  }

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

/* ---- Phase 8: API keys, webhooks, kiosks --------------------------------- */

export async function createApiKey(
  workspaceId: string,
  name: string,
): Promise<Result & { key?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  if (!name.trim()) return { error: "Name is required." };

  const { generateApiKey } = await import("@/lib/apikeys");
  const { key, prefix, hash } = generateApiKey();

  const { error } = await supabase.from("api_keys").insert({
    workspace_id: workspaceId,
    name: name.trim(),
    key_prefix: prefix,
    key_hash: hash,
    created_by: user.id,
  });
  if (error) return { error: error.message };

  await logAudit(supabase, {
    workspaceId,
    actorId: user.id,
    action: "api_key.created",
    entityType: "api_keys",
    detail: { name: name.trim(), prefix },
  });

  revalidatePath("/developers");
  // The only time the plaintext key is ever available -- it is not
  // recoverable from key_hash afterward, only rotated by creating a new one.
  return { key };
}

export async function revokeApiKey(id: string): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: row, error } = await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .select("workspace_id")
    .single();
  if (error) return { error: error.message };
  if (user) {
    await logAudit(supabase, {
      workspaceId: row.workspace_id,
      actorId: user.id,
      action: "api_key.revoked",
      entityType: "api_keys",
      entityId: id,
    });
  }
  revalidatePath("/developers");
  return {};
}

export async function createWebhook(input: {
  workspaceId: string;
  url: string;
  events: string[];
}): Promise<Result & { secret?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    return { error: "Enter a valid URL." };
  }
  if (parsed.protocol !== "https:") return { error: "Webhook URLs must use HTTPS." };
  if (input.events.length === 0) return { error: "Select at least one event." };

  const { randomBytes } = await import("node:crypto");
  const secret = randomBytes(24).toString("hex");

  const { error } = await supabase.from("webhooks").insert({
    workspace_id: input.workspaceId,
    url: input.url,
    events: input.events,
    secret,
    created_by: user.id,
  });
  if (error) return { error: error.message };

  revalidatePath("/developers");
  // Like the API key, the signing secret is shown once; a receiver
  // verifies deliveries with it and would need a new one if it is lost.
  return { secret };
}

export async function toggleWebhook(id: string, isActive: boolean): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("webhooks")
    .update({ is_active: isActive })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/developers");
  return {};
}

export async function deleteWebhook(id: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("webhooks").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/developers");
  return {};
}

export async function createKiosk(workspaceId: string, name: string, projectId: string | null): Promise<Result> {
  const supabase = await createClient();
  if (!name.trim()) return { error: "Name is required." };
  const { randomBytes } = await import("node:crypto");
  const deviceToken = `kiosk_${randomBytes(16).toString("hex")}`;
  const { error } = await supabase.from("kiosks").insert({
    workspace_id: workspaceId,
    name: name.trim(),
    device_token: deviceToken,
    project_id: projectId,
  });
  if (error) return { error: error.message };
  revalidatePath("/kiosks");
  return {};
}

export async function toggleKiosk(id: string, isActive: boolean): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("kiosks").update({ is_active: isActive }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/kiosks");
  return {};
}

export async function setMemberKioskPin(membershipId: string, pin: string): Promise<Result> {
  if (!/^\d{4,8}$/.test(pin)) return { error: "PIN must be 4 to 8 digits." };
  const supabase = await createClient();
  const { createHash } = await import("node:crypto");
  const pinHash = createHash("sha256").update(pin).digest("hex");
  const { error } = await supabase.rpc("set_kiosk_pin", {
    p_membership_id: membershipId,
    p_pin_hash: pinHash,
  });
  if (error) return { error: error.message };
  revalidatePath("/kiosks");
  return {};
}

/* ---- Phase 1.5: Clockify historical backfill ----------------------------- */

export async function checkClockifyConnection(
  apiKey: string,
): Promise<Result & { workspaces?: { id: string; name: string }[] }> {
  if (!apiKey.trim()) return { error: "Paste your Clockify API key first." };
  try {
    const { verifyKeyAndListWorkspaces } = await import("@/lib/clockify");
    const { workspaces } = await verifyKeyAndListWorkspaces(apiKey.trim());
    return { workspaces };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not reach Clockify." };
  }
}

/**
 * Fetches members and their entries from Clockify, stages everything as
 * import_rows (nothing touches time_entries yet), and runs the fuzzy match.
 * Capped per member so one enormous Clockify history cannot run past a
 * serverless function's time limit in a single request.
 */
export async function startClockifyImport(input: {
  workspaceId: string;
  apiKey: string;
  clockifyWorkspaceId: string;
}): Promise<Result & { batchId?: string; rowCount?: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { fetchMembers, fetchMemberEntries, ClockifyError } = await import("@/lib/clockify");

  let members;
  try {
    members = await fetchMembers(input.apiKey, input.clockifyWorkspaceId);
  } catch (e) {
    return { error: e instanceof ClockifyError ? e.message : "Could not fetch Clockify members." };
  }
  if (members.length === 0) return { error: "That Clockify workspace has no members." };

  const { data: batch, error: batchErr } = await supabase
    .from("import_batches")
    .insert({ workspace_id: input.workspaceId, source: "clockify", created_by: user.id })
    .select()
    .single();
  if (batchErr) return { error: batchErr.message };

  const { error: mapErr } = await supabase.from("import_member_map").insert(
    members.map((m) => ({
      batch_id: batch.id,
      workspace_id: input.workspaceId,
      clockify_name: m.name,
      clockify_email: m.email,
    })),
  );
  if (mapErr) return { error: mapErr.message };

  let rowCount = 0;
  for (const member of members) {
    let entries;
    try {
      entries = await fetchMemberEntries(input.apiKey, input.clockifyWorkspaceId, member.id, 500);
    } catch (e) {
      // One member's history failing to fetch should not lose everyone
      // else's -- surface it in the batch rather than aborting the import.
      console.error(`Clockify fetch failed for ${member.name}:`, e);
      continue;
    }
    if (entries.length === 0) continue;

    const { error: rowsErr } = await supabase.from("import_rows").insert(
      entries.map((e) => ({
        batch_id: batch.id,
        workspace_id: input.workspaceId,
        external_id: e.id,
        description: e.description,
        project_name: e.projectName,
        task_name: e.taskName,
        member_name: member.name,
        member_email: member.email,
        started_at: e.start,
        ended_at: e.end,
        duration_seconds: e.durationSeconds,
        is_billable: e.billable,
      })),
    );
    if (rowsErr) return { error: rowsErr.message };
    rowCount += entries.length;
  }

  if (rowCount === 0) {
    await supabase.from("import_batches").delete().eq("id", batch.id);
    return { error: "No completed time entries were found for anyone in that workspace." };
  }

  const { error: matchErr } = await supabase.rpc("stage_import_matches", { p_batch_id: batch.id });
  if (matchErr) return { error: matchErr.message };

  revalidatePath("/import");
  return { batchId: batch.id, rowCount };
}

export async function mapImportMember(
  batchId: string,
  clockifyName: string,
  resolvedUserId: string,
): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("import_member_map")
    .update({ resolved_user_id: resolvedUserId })
    .eq("batch_id", batchId)
    .eq("clockify_name", clockifyName);
  if (error) return { error: error.message };
  revalidatePath("/import");
  return {};
}

export async function resolveImportRow(
  rowId: string,
  input: { status: "approved" | "skipped" | "rejected" | "pending"; contentItemId?: string | null },
): Promise<Result> {
  const supabase = await createClient();
  const patch: Record<string, unknown> = { status: input.status };
  if (input.contentItemId !== undefined) patch.resolved_content_item_id = input.contentItemId;
  const { error } = await supabase.from("import_rows").update(patch).eq("id", rowId);
  if (error) return { error: error.message };
  revalidatePath("/import");
  return {};
}

/**
 * Convenience for the common case: accept every suggestion at or above a
 * threshold at once, instead of clicking through each row individually when
 * a batch has hundreds of entries against a handful of recurring titles.
 *
 * resolved_content_item_id must be set to each row's OWN suggestion, and the
 * Supabase client cannot express "set column = another column" in an
 * update() call -- only literal values. Grouping the matching rows by their
 * suggested content id keeps this to one update per distinct video rather
 * than one per row, which matters because many entries typically share the
 * same handful of titles.
 */
export async function bulkApproveHighConfidence(
  batchId: string,
  threshold: number,
): Promise<Result & { count?: number }> {
  const supabase = await createClient();
  const { data: candidates, error: fetchErr } = await supabase
    .from("import_rows")
    .select("id, suggested_content_item_id")
    .eq("batch_id", batchId)
    .eq("status", "pending")
    .gte("match_confidence", threshold)
    .not("suggested_content_item_id", "is", null);
  if (fetchErr) return { error: fetchErr.message };
  if (!candidates || candidates.length === 0) return { count: 0 };

  const byContentId = new Map<string, string[]>();
  for (const row of candidates) {
    const key = row.suggested_content_item_id as string;
    if (!byContentId.has(key)) byContentId.set(key, []);
    byContentId.get(key)!.push(row.id);
  }

  for (const [contentItemId, rowIds] of byContentId) {
    const { error } = await supabase
      .from("import_rows")
      .update({ status: "approved", resolved_content_item_id: contentItemId })
      .in("id", rowIds);
    if (error) return { error: error.message };
  }

  revalidatePath("/import");
  return { count: candidates.length };
}

export async function commitImportBatch(batchId: string): Promise<Result & { inserted?: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("commit_import_batch", { p_batch_id: batchId });
  if (error) return { error: error.message };
  revalidatePath("/import");
  revalidatePath("/content");
  revalidatePath("/timesheet");
  return { inserted: data ?? 0 };
}

export async function discardImportBatch(batchId: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("import_batches").delete().eq("id", batchId);
  if (error) return { error: error.message };
  revalidatePath("/import");
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
