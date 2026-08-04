import PageHeader from "@/components/PageHeader";
import FilterBar from "@/components/FilterBar";
import TodoBoard from "@/components/TodoBoard";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { canManage, type Todo } from "@/lib/types";
import { loadClientOptions, loadMemberOptions } from "@/lib/dashboards";

/**
 * The daily assignment sheet, structured. A manager fills in who does what
 * today (per client, no deadlines -- the date IS the record); everyone else
 * opens this page and sees exactly their own list for the day. RLS enforces
 * that split, not the UI: a non-manager's query physically cannot return
 * anyone else's rows.
 *
 * The page can also emit the day as clean text -- the same daily message
 * the team already sends around, but generated FROM the system with full
 * names instead of shorthand, so the system is the source of truth and the
 * text is its output rather than the other way around.
 */
export default async function TodosPage({
  searchParams,
}: {
  searchParams: Promise<{
    date?: string;
    person?: string;
    client?: string;
    status?: string;
  }>;
}) {
  const sp = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;
  const manages = canManage(session.active.role);

  // "Today" in the team's own timezone (the workspace is Dubai-based) --
  // the Vercel server runs UTC, where Dubai's early morning is still
  // yesterday's date.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
  }).format(new Date());
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : today;

  let query = supabase
    .from("todos")
    .select(
      "id, workspace_id, user_id, client_id, assigned_on, description, is_done, done_at, profile:profiles(full_name), client:clients(id, name)",
    )
    .eq("workspace_id", ws)
    .eq("assigned_on", date)
    .order("created_at");
  if (manages && sp.person) query = query.eq("user_id", sp.person);
  if (sp.client) query = query.eq("client_id", sp.client);
  if (sp.status === "open") query = query.eq("is_done", false);
  else if (sp.status === "done") query = query.eq("is_done", true);

  const [todosRes, members, clients] = await Promise.all([
    query,
    loadMemberOptions(supabase, ws),
    loadClientOptions(supabase, ws),
  ]);
  const todos = (todosRes.data ?? []) as unknown as Todo[];

  const filters = (
    <FilterBar
      basePath="/todos"
      primaryCount={3}
      filters={[
        ...(manages
          ? [
              {
                key: "person",
                label: "Filter by person",
                allLabel: "Everyone",
                value: sp.person ?? null,
                options: members.map((m) => ({ value: m.userId, label: m.name })),
              },
            ]
          : []),
        {
          key: "client",
          label: "Filter by client",
          allLabel: "All clients",
          value: sp.client ?? null,
          options: clients.map((c) => ({ value: c.id, label: c.name })),
        },
        {
          key: "status",
          label: "Filter by status",
          allLabel: "Any status",
          value: sp.status ?? null,
          options: [
            { value: "open", label: "Open" },
            { value: "done", label: "Done" },
          ],
        },
      ]}
    />
  );

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <PageHeader
        title="To-dos"
        subtitle={
          manages
            ? "The daily assignment sheet — assign work per person and client, then share it as text."
            : "Your assignments for the day."
        }
      />
      {filters}
      <TodoBoard
        workspaceId={ws}
        todos={todos}
        members={members}
        clients={clients}
        manages={manages}
        selfId={session.userId}
        date={date}
        today={today}
      />
    </div>
  );
}

/** Browser-tab identity; the root layout template appends the app name. */
export const metadata = { title: "To-dos" };
