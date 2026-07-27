import PageHeader from "@/components/PageHeader";
import AccountsManager from "@/components/AccountsManager";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { canManage } from "@/lib/types";
import { CONNECTORS, isConfigured, missingEnvVars } from "@/lib/connectors";
import type { Account, Client, Platform } from "@/lib/types";

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ oauth_error?: string; oauth_connected?: string }>;
}) {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;
  const params = await searchParams;

  const [accountsRes, platformsRes, clientsRes, connectionsRes] = await Promise.all([
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
    supabase
      .from("oauth_connections")
      .select("account_id, status, connected_at, scopes")
      .eq("workspace_id", ws),
  ]);

  const connectorStatus = Object.fromEntries(
    Object.keys(CONNECTORS).map((slug) => [
      slug,
      { configured: isConfigured(slug), missing: missingEnvVars(slug) },
    ]),
  );

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <PageHeader
        title="Accounts"
        subtitle="One account per platform a client publishes to. Each is scored on its own metrics and baseline."
      />
      {params.oauth_error && (
        <p className="mb-4 rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {decodeURIComponent(params.oauth_error)}
        </p>
      )}
      {params.oauth_connected && (
        <p className="mb-4 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-500">
          Connected to {params.oauth_connected}. Enhanced metrics will appear
          on content as they sync.
        </p>
      )}
      <AccountsManager
        workspaceId={ws}
        accounts={(accountsRes.data ?? []) as unknown as Account[]}
        platforms={(platformsRes.data ?? []) as unknown as Platform[]}
        clients={(clientsRes.data ?? []) as unknown as Client[]}
        canManage={canManage(session.active.role)}
        connections={
          (connectionsRes.data ?? []) as {
            account_id: string;
            status: string;
            connected_at: string;
          }[]
        }
        connectorStatus={connectorStatus}
      />
    </div>
  );
}
