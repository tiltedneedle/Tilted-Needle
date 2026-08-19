import PageHeader from "@/components/PageHeader";
import SimpleListManager from "@/components/SimpleListManager";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { canManage } from "@/lib/types";
import { createTag } from "@/app/actions";

export default async function TagsPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;

  const { data } = await supabase
    .from("tags")
    .select("id, name, is_archived")
    .eq("workspace_id", ws)
    .order("name");

  async function create(name: string) {
    "use server";
    return createTag(ws, name);
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <PageHeader
        title="Tags"
        subtitle="Tags cut across projects for reporting."
      />
      <SimpleListManager
        rows={data ?? []}
        table="tags"
        addLabel="Add tag"
        placeholder="Tag name"
        emptyText="No tags yet"
        emptyHint="A tag cuts across projects, so you can report on a theme rather than on a client — “paid social”, “launch”, “evergreen”. Add one and it becomes available on every project and time entry."
        canManage={canManage(session.active.role)}
        onCreate={create}
      />
    </div>
  );
}
