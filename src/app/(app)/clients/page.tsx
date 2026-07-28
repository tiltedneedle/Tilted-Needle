import PageHeader from "@/components/PageHeader";
import SimpleListManager from "@/components/SimpleListManager";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { canManage } from "@/lib/types";
import { createClientRecord } from "@/app/actions";

export default async function ClientsPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;

  const { data } = await supabase
    .from("clients")
    .select("id, name, is_archived")
    .eq("workspace_id", ws)
    .order("name");

  async function create(name: string) {
    "use server";
    return createClientRecord(ws, name);
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <PageHeader
        title="Clients"
        subtitle="Clients own projects, and roll up into per-client reporting."
      />
      <SimpleListManager
        rows={data ?? []}
        table="clients"
        addLabel="Add client"
        placeholder="Client name"
        emptyText="No clients yet."
        canManage={canManage(session.active.role)}
        onCreate={create}
        detailHref="/content?client="
      />
    </div>
  );
}
