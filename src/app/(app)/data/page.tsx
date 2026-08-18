import { OPERATING_TZ, formatInstant } from "@/lib/tz";
import PageHeader from "@/components/PageHeader";
import DataPanel, { type PanelAccount } from "@/components/DataPanel";
import AnalyticsImport from "@/components/AnalyticsImport";
import PeriodSheet from "@/components/PeriodSheet";
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
      .select("id, name").is("deleted_at", null)
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
  /**
   * The live accounts the period sheet can be filled in for.
   *
   * Archived accounts are excluded: nobody writes a monthly report for a
   * channel that has been switched off, and offering them would make the
   * picker longer than the job it exists for.
   */
  const periodAccounts = ((accountsRes.data ?? []) as unknown as Row[])
    .filter((a) => !a.is_archived)
    .map((a) => ({
      id: a.id,
      platform: a.platform_slug,
      handle: a.handle,
      clientName: one(a.client)?.name ?? null,
    }))
    .sort((x, y) => (x.clientName ?? "").localeCompare(y.clientName ?? ""));

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
    discoverySharedToken: PROVIDERS[a.platform_slug]?.capability.discoverySharedToken ?? false,
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
  /**
   * DISCOVERY only, and every metered platform -- not a pooled total for one.
   *
   * This tile used to read "Instagram budget 301/1800" by summing auto,
   * discovery and manual. Both halves of that hid the thing that matters.
   * Discovery is the pool that finds NEW videos, it is a tenth the size of the
   * refresh pool, and it is the one that runs out: Instagram sat at 143/200
   * while the tile said 301/1800, which reads as comfortable. Meanwhile TikTok
   * was at 200/200 -- completely exhausted, discovery silently stopped -- and
   * the tile did not mention TikTok at all.
   *
   * Worst-off platform first, so the tile shows the problem rather than an
   * average that hides it.
   */
  const budgets = ((budgetRes.data ?? []) as Budget[])
    .filter((b) => b.limit_discovery > 0)
    .map((b) => ({
      platform: b.platform_slug,
      used: b.used_discovery,
      limit: b.limit_discovery,
      pct: b.limit_discovery > 0 ? b.used_discovery / b.limit_discovery : 0,
      resets: b.period_end,
    }))
    .sort((a, b) => b.pct - a.pct);

  const worst = budgets[0] ?? null;
  // 80% is where "keep an eye on it" becomes "this will stop before the reset".
  const tightBudgets = budgets.filter((b) => b.pct >= 0.8);

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
      {/* Two settings that must agree eventually will not, and a one-hour
          disagreement between what buckets the data and what defaults the
          dates is invisible until someone reconciles an invoice. So it is
          stated on the page rather than left to be discovered. */}
      {session.active.timezone !== OPERATING_TZ && (
        <div
          className="mb-4 rounded-[var(--radius-sm)] border px-3 py-2 text-xs"
          style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
          role="alert"
        >
          <strong>Timezone mismatch.</strong> The database buckets this
          workspace&apos;s days in <code>{session.active.timezone}</code>, but the app
          is aggregating in <code>{OPERATING_TZ}</code>. To-do dates and budget
          windows will disagree with reports by the difference between them. Set{" "}
          <code>OPERATING_TZ={session.active.timezone}</code> in the deployment
          environment.
        </div>
      )}

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
          // toLocale* with no zone resolves to the SERVER's zone, which on
          // Vercel is UTC -- so this read five hours behind a Karachi reader
          // and four behind a Dubai one, while looking like a local time.
          // formatInstant puts a moment where the person reading it is.
          value={formatInstant(lastSync, session.timezone, {
            hour: "2-digit",
            minute: "2-digit",
          })}
          hint={
            lastSync
              ? formatInstant(lastSync, session.timezone, {
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
          label={worst ? `${worst.platform} discovery` : "Discovery budget"}
          value={worst ? `${worst.used}/${worst.limit}` : "—"}
          // Accented once a platform is within a fifth of its ceiling, because
          // the number alone did not read as urgent: 143/200 looks fine until
          // you know it stops finding new videos at 200 and says nothing.
          accent={!!worst && worst.pct >= 0.8}
          hint={
            worst
              ? worst.pct >= 1
                ? "exhausted — no new videos until reset"
                : `${tightBudgets.length > 1 ? `${tightBudgets.length} platforms low · ` : ""}resets ${new Date(worst.resets).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
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

      {/* The audience figures a client report needs and no interface serves.
          Instagram publishes no account-level export -- Meta withholds one
          deliberately -- and OAuth is banned here by schema constraint, so for
          the largest platform this form is the data path permanently, not a
          stopgap waiting on an integration. */}
      <SectionHeading
        title="Monthly audience figures"
        note="Followers, reach and demographics — read off each platform's own dashboard, because nothing publishes them"
      />
      <div className="mb-7">
        <PeriodSheet workspaceId={ws} accounts={periodAccounts} />
      </div>

      <SectionHeading
        title="Platforms"
        note="Manual refresh uses the same path as the daily cron — metered platforms still spend from their budget"
      />
      <DataPanel
        workspaceId={ws}
        accounts={accounts}
        // Discovery, not the pooled total. This panel is about finding new
        // videos, and the refresh pool is seven times larger -- summing them
        // made a nearly-spent discovery allowance look like plenty.
        instagramBudget={(() => {
          const ig = budgets.find((b) => b.platform === "instagram");
          return ig ? { used: ig.used, limit: ig.limit, resetsOn: ig.resets } : null;
        })()}
        tiktokBox={tiktokBox}
        clients={clients}
        platforms={platforms}
      />
    </div>
  );
}
