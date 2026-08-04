import PageHeader from "@/components/PageHeader";
import AccountsManager from "@/components/AccountsManager";
import FilterBar from "@/components/FilterBar";
import SyncStatus from "@/components/SyncStatus";
import { PROVIDERS } from "@/lib/providers";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { canManage } from "@/lib/types";
import { CONNECTORS, isConfigured, missingEnvVars } from "@/lib/connectors";
import type { Account, Client, Platform } from "@/lib/types";

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{
    oauth_error?: string;
    oauth_connected?: string;
    platform?: string;
    client?: string;
    connection?: string;
    status?: string;
  }>;
}) {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;
  const params = await searchParams;

  const [accountsRes, platformsRes, clientsRes, connectionsRes] = await Promise.all([
    supabase
      .from("accounts")
      .select(
        "id, workspace_id, client_id, platform_slug, handle, connection_mode, is_archived, last_synced_at, last_sync_error, sync_enabled, client:clients(id, name)",
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

  const allAccounts = (accountsRes.data ?? []) as unknown as Account[];
  const platforms = (platformsRes.data ?? []) as unknown as Platform[];
  const clients = (clientsRes.data ?? []) as unknown as Client[];
  const connections = (connectionsRes.data ?? []) as {
    account_id: string;
    status: string;
    connected_at: string;
  }[];
  const connectedIds = new Set(
    connections.filter((c) => c.status === "active").map((c) => c.account_id),
  );

  // Archived accounts are hidden unless asked for -- they exist for history,
  // and a list that leads with dead accounts buries the live ones.
  let accounts = allAccounts.filter((a) =>
    params.status === "archived" ? a.is_archived : params.status === "all" ? true : !a.is_archived,
  );
  if (params.platform) accounts = accounts.filter((a) => a.platform_slug === params.platform);
  if (params.client) accounts = accounts.filter((a) => a.client_id === params.client);
  if (params.connection === "connected")
    accounts = accounts.filter((a) => connectedIds.has(a.id));
  else if (params.connection === "manual")
    accounts = accounts.filter((a) => !connectedIds.has(a.id));

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
      <SyncStatus
        workspaceId={ws}
        canManage={canManage(session.active.role)}
        platforms={platforms.map((p) => {
          const provider = PROVIDERS[p.slug];
          return {
            slug: p.slug,
            displayName: p.display_name,
            canFetch: provider?.capability.canFetchMetrics ?? false,
            configured: provider?.isConfigured() ?? false,
            missingEnv: provider?.missingEnv() ?? [],
            reason: provider?.capability.reason ?? "No provider for this platform.",
            remedy: provider?.capability.remedy,
            accountCount: allAccounts.filter(
              (a) => a.platform_slug === p.slug && !a.is_archived,
            ).length,
          };
        })}
        accounts={allAccounts
          .filter((a) => !a.is_archived)
          .map((a) => ({
            id: a.id,
            handle: a.handle,
            platform: a.platform_slug,
            lastSyncedAt: (a as { last_synced_at?: string | null }).last_synced_at ?? null,
            lastError: (a as { last_sync_error?: string | null }).last_sync_error ?? null,
          }))}
      />

      <FilterBar
        basePath="/accounts"
        filters={[
          {
            key: "platform",
            label: "Filter by platform",
            allLabel: "All platforms",
            value: params.platform ?? null,
            options: platforms.map((p) => ({ value: p.slug, label: p.display_name })),
          },
          {
            key: "client",
            label: "Filter by client",
            allLabel: "All clients",
            value: params.client ?? null,
            options: clients
              .filter((c) => !c.is_archived)
              .map((c) => ({ value: c.id, label: c.name })),
          },
          {
            key: "connection",
            label: "Filter by connection",
            allLabel: "Any connection",
            value: params.connection ?? null,
            options: [
              { value: "connected", label: "Connected" },
              { value: "manual", label: "Manual entry" },
            ],
          },
          {
            key: "status",
            label: "Filter by status",
            allLabel: "Active only",
            value: params.status ?? null,
            options: [
              { value: "archived", label: "Archived only" },
              { value: "all", label: "Active and archived" },
            ],
          },
        ]}
      />

      <AccountsManager
        workspaceId={ws}
        accounts={accounts}
        platforms={platforms}
        clients={clients}
        canManage={canManage(session.active.role)}
        connections={connections}
        connectorStatus={connectorStatus}
      />
    </div>
  );
}

/** Browser-tab identity; the root layout template appends the app name. */
export const metadata = { title: "Accounts" };
