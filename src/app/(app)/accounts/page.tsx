import PageHeader from "@/components/PageHeader";
import AccountsManager from "@/components/AccountsManager";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { canManage } from "@/lib/types";
import type { Account, Client, Platform } from "@/lib/types";

export default async function AccountsPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;

  const [accountsRes, platformsRes, clientsRes] = await Promise.all([
    supabase
      .from("accounts")
      .select(
        "id, workspace_id, client_id, platform_slug, handle, connection_mode, is_archived, client:clients(id, name)",
      )
      .eq("workspace_id", ws)
      .order("handle"),
    supabase
      .from("platforms")
      .select("*")
      .eq("is_enabled", true)
      .order("sort_order"),
    supabase
      .from("clients")
      .select("id, workspace_id, name, email, is_archived")
      .eq("workspace_id", ws)
      .order("name"),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <PageHeader
        title="Accounts"
        subtitle="One account per platform a client publishes to. Each is scored on its own metrics and baseline."
      />
      <AccountsManager
        workspaceId={ws}
        accounts={(accountsRes.data ?? []) as unknown as Account[]}
        platforms={(platformsRes.data ?? []) as unknown as Platform[]}
        clients={(clientsRes.data ?? []) as unknown as Client[]}
        canManage={canManage(session.active.role)}
      />
    </div>
  );
}
