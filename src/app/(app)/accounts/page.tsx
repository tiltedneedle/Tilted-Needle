import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import AccountsManager from "@/components/AccountsManager";
import FilterBar from "@/components/FilterBar";
import SyncStatus from "@/components/SyncStatus";
import { PROVIDERS } from "@/lib/providers";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { canManage } from "@/lib/types";
import type { Account, Client, Platform } from "@/lib/types";

/**
 * Accounts are identified by handle and read through public APIs only. There
 * is no connect flow: owner-credential access is a hard constraint of this
 * product (PRD-video-intelligence §0), and the richer owner-only metrics
 * arrive by client-supplied export instead (§2).
 */
export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{
    platform?: string;
    client?: string;
    status?: string;
  }>;
}) {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;
  const params = await searchParams;

  const [accountsRes, platformsRes, clientsRes] = await Promise.all([
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
  ]);

  const allAccounts = (accountsRes.data ?? []) as unknown as Account[];
  const platforms = (platformsRes.data ?? []) as unknown as Platform[];
  const clients = (clientsRes.data ?? []) as unknown as Client[];

  // Archived accounts are hidden unless asked for -- they exist for history,
  // and a list that leads with dead accounts buries the live ones.
  let accounts = allAccounts.filter((a) =>
    params.status === "archived" ? a.is_archived : params.status === "all" ? true : !a.is_archived,
  );
  if (params.platform) accounts = accounts.filter((a) => a.platform_slug === params.platform);
  if (params.client) accounts = accounts.filter((a) => a.client_id === params.client);

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <PageHeader
        title="Accounts"
        subtitle="One account per platform a client publishes to. Each is scored on its own metrics and baseline."
      />
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
            lastSyncedAt: a.last_synced_at ?? null,
            lastError: a.last_sync_error ?? null,
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
        // Whether an account's numbers arrive on their own is a property of
        // the PROVIDER, not of accounts.connection_mode -- that column reads
        // 'manual' for every account in the workspace, including the fourteen
        // that sync nightly, so badging on it would print a falsehood.
        fetchByPlatform={Object.fromEntries(
          platforms.map((p) => {
            const provider = PROVIDERS[p.slug];
            return [
              p.slug,
              {
                auto: Boolean(provider?.capability.canFetchMetrics && provider?.isConfigured()),
                metered: provider?.capability.isMetered ?? false,
              },
            ];
          }),
        )}
      />

      {/* Archived accounts are hidden by the default status filter, which
          made archiving read as deletion -- an account someone had just
          archived was "not anywhere". One visible line keeps them a single
          click away without cluttering the default view. */}
      {!params.status &&
        (() => {
          const hidden = allAccounts.filter(
            (a) =>
              a.is_archived &&
              (!params.platform || a.platform_slug === params.platform) &&
              (!params.client || a.client_id === params.client),
          ).length;
          if (hidden === 0) return null;
          const qs = new URLSearchParams();
          if (params.platform) qs.set("platform", params.platform);
          if (params.client) qs.set("client", params.client);
          qs.set("status", "all");
          return (
            <p className="mt-3 text-center text-xs text-[var(--muted)]">
              {hidden} archived account{hidden === 1 ? "" : "s"} hidden —{" "}
              <Link
                href={`/accounts?${qs.toString()}`}
                className="text-[var(--accent)] hover:underline"
              >
                show
              </Link>
            </p>
          );
        })()}
    </div>
  );
}

/** Browser-tab identity; the root layout template appends the app name. */
export const metadata = { title: "Accounts" };
