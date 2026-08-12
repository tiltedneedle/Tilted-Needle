import PageHeader from "@/components/PageHeader";
import DataPanel, { type PanelAccount } from "@/components/DataPanel";
import AnalyticsImport from "@/components/AnalyticsImport";
import PipelineHealth from "@/components/PipelineHealth";
import { loadPipelineStatus } from "@/lib/pipelineStatus";
import { Stat, StatGrid, SectionHeading } from "@/components/Stat";
import { Database, RefreshCw, AlertTriangle, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { PROVIDERS } from "@/lib/providers";
import { one } from "@/lib/types";

export const metadata = { title: "Data sync" };

/**
 * The scraping control room, manager-only (the member allow-list in the app
 * layout redirects everyone else). Everything the autonomous pipeline does
 * on its own -- the daily cron, discovery cooldowns, the metered budget --
 * is visible here, and all of it can be triggered by hand: per-account or
 * everything at once, through the exact same sync path the cron uses.
 */
export default async function DataPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;

  const today = new Date().toISOString().slice(0, 10);
  const [accountsRes, postsRes, budgetRes, clientsRes, platformsRes] = await Promise.all([
    // Archived accounts are loaded too, now that this page owns account
    // management: a page you can archive from but not restore from is a
    // one-way door, and the row would simply vanish with nowhere to go.
    supabase
      .from("accounts")
      .select(
        "id, platform_slug, handle, connection_mode, sync_enabled, sync_window_days, last_synced_at, last_sync_error, last_discovered_at, is_archived, client_id, client:clients(name, is_archived)",
      )
      .eq("workspace_id", ws)
      .order("platform_slug")
      .order("handle"),
    supabase.from("platform_posts").select("account_id").eq("workspace_id", ws),
    supabase
      .from("scrape_budgets")
      .select("platform_slug, period_end, limit_auto, limit_discovery, limit_manual, used_auto, used_discovery, used_manual")
      .eq("workspace_id", ws)
      .gte("period_end", today)
      .order("period_end")
      .limit(5),
    // Active clients only for the pickers: attaching an account to a client
    // the business has stopped working with is not something to offer.
    supabase
      .from("clients")
      .select("id, name")
      .eq("workspace_id", ws)
      .eq("is_archived", false)
      .order("name"),
    supabase
      .from("platforms")
      .select("slug, display_name")
      .eq("is_enabled", true)
      .order("sort_order"),
  ]);

  const postCount = new Map<string, number>();
  for (const p of (postsRes.data ?? []) as { account_id: string }[]) {
    postCount.set(p.account_id, (postCount.get(p.account_id) ?? 0) + 1);
  }

  type Row = {
    id: string;
    platform_slug: string;
    handle: string;
    connection_mode: string;
    sync_enabled: boolean;
    sync_window_days: number | null;
    last_synced_at: string | null;
    last_sync_error: string | null;
    last_discovered_at: string | null;
    is_archived: boolean;
    client_id: string | null;
    client: { name: string; is_archived: boolean } | { name: string; is_archived: boolean }[] | null;
  };
  const accounts: PanelAccount[] = ((accountsRes.data ?? []) as unknown as Row[]).map((a) => ({
    id: a.id,
    platformSlug: a.platform_slug,
    handle: a.handle,
    clientId: a.client_id,
    clientName: one(a.client)?.name ?? null,
    // Whether this account is quiet because its CLIENT is inactive, rather
    // than because someone paused this page. Two different facts that look
    // identical if you only show one switch -- and only one of them is fixed
    // from this screen.
    clientArchived: one(a.client)?.is_archived ?? false,
    isArchived: a.is_archived,
    isMetered: PROVIDERS[a.platform_slug]?.capability.isMetered ?? false,
    discoveryMetered: PROVIDERS[a.platform_slug]?.capability.discoveryMetered ?? false,
    syncEnabled: a.sync_enabled,
    syncWindowDays: a.sync_window_days,
    lastSyncedAt: a.last_synced_at,
    lastDiscoveredAt: a.last_discovered_at,
    lastError: a.last_sync_error,
    postsTracked: postCount.get(a.id) ?? 0,
  }));

  const clients = (clientsRes.data ?? []) as { id: string; name: string }[];
  const platforms = ((platformsRes.data ?? []) as { slug: string; display_name: string }[]).map(
    (p) => ({ slug: p.slug, name: p.display_name }),
  );

  const lastSync = accounts
    .map((a) => a.lastSyncedAt)
    .filter((t): t is string => !!t)
    .sort()
    .at(-1);
  const errorCount = accounts.filter((a) => a.lastError).length;

  type Budget = {
    platform_slug: string;
    period_end: string;
    limit_auto: number;
    limit_discovery: number;
    limit_manual: number;
    used_auto: number;
    used_discovery: number;
    used_manual: number;
  };
  const budget = ((budgetRes.data ?? []) as Budget[]).find(
    (b) => b.platform_slug === "instagram",
  );
  const budgetUsed = budget
    ? budget.used_auto + budget.used_discovery + budget.used_manual
    : null;
  const budgetLimit = budget
    ? budget.limit_auto + budget.limit_discovery + budget.limit_manual
    : null;

  // The optional TikTok discovery box: /health is unauthenticated by design,
  // so the panel can say "up" or "down" without spending a discovery call.
  let tiktokBox: "ok" | "down" | "unconfigured" = "unconfigured";
  const discoverUrl = process.env.TIKTOK_DISCOVER_URL;
  if (discoverUrl) {
    try {
      const res = await fetch(discoverUrl.replace(/\/discover\/?$/, "/health"), {
        signal: AbortSignal.timeout(4000),
        cache: "no-store",
      });
      tiktokBox = res.ok ? "ok" : "down";
    } catch {
      tiktokBox = "down";
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <PageHeader
        title="Data sync"
        subtitle="Everything the pipeline fetches on its own, and the levers to refresh it by hand."
      />

      <StatGrid>
        <Stat
          hero
          icon={Database}
          label="Accounts syncing"
          value={String(accounts.filter((a) => a.syncEnabled).length)}
          hint={`of ${accounts.length} connected`}
        />
        <Stat
          icon={RefreshCw}
          label="Last sync"
          value={
            lastSync
              ? new Date(lastSync).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—"
          }
          hint={
            lastSync
              ? new Date(lastSync).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })
              : "runs daily via cron"
          }
        />
        <Stat
          icon={AlertTriangle}
          label="Sync errors"
          value={String(errorCount)}
          hint={errorCount ? "see rows below" : "all clear"}
          accent={errorCount > 0}
        />
        <Stat
          icon={Wallet}
          label="Instagram budget"
          value={budgetUsed != null ? `${budgetUsed}/${budgetLimit}` : "—"}
          hint={
            budget
              ? `resets ${new Date(budget.period_end).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
              : "no window open yet"
          }
        />
      </StatGrid>

      <PipelineHealth status={await loadPipelineStatus(supabase, ws)} />

      {/* Owner-only figures arrive here, by export rather than by credential
          (PRD-video-intelligence §2). Placed above the platform panel because
          it is the only source of CTR and true retention in the system. */}
      <SectionHeading
        title="Owner-only analytics"
        note="Impressions, CTR and average percentage viewed — supplied by the client, never fetchable"
      />
      <div className="mb-7">
        <AnalyticsImport workspaceId={ws} />
      </div>

      <SectionHeading
        title="Platforms"
        note="Manual refresh uses the same path as the daily cron — metered platforms still spend from their budget"
      />
      <DataPanel
        workspaceId={ws}
        accounts={accounts}
        instagramBudget={
          budget && budgetUsed != null && budgetLimit != null
            ? { used: budgetUsed, limit: budgetLimit, resetsOn: budget.period_end }
            : null
        }
        tiktokBox={tiktokBox}
        clients={clients}
        platforms={platforms}
      />
    </div>
  );
}
