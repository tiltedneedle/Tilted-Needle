/**
 * The public-metrics sync runner.
 *
 * For each syncable account: find its recent posts on the platform, attach any
 * that are not tracked yet, then record a metrics snapshot for every tracked
 * post. Snapshots append rather than overwrite, because scoring evaluates at
 * a fixed maturity window and needs the series (PRD 5 Step 1).
 *
 * Runs with the service role, because it executes on a schedule with no user
 * session. That makes it the one place in this codebase where RLS is not the
 * safety net, so every query below is explicitly scoped by workspace_id.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { providerFor, type DiscoveredPost } from "@/lib/providers";
import { fetchVideoDetails } from "@/lib/providers/youtube";
import {
  claim,
  findDuePosts,
  isMetered,
  refund,
  retirePosts,
  type BudgetPool,
} from "@/lib/scrapeBudget";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = SupabaseClient<any>;

export type AccountSyncResult = {
  accountId: string;
  handle: string;
  platform: string;
  status: "ok" | "error" | "skipped";
  postsSeen: number;
  postsCreated: number;
  snapshotsWritten: number;
  error?: string;
};

export function serviceClient(): Db {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required to sync.");
  }
  return createClient(url, secret, { auth: { persistSession: false } });
}

type AccountRow = {
  id: string;
  workspace_id: string;
  client_id: string | null;
  platform_slug: string;
  handle: string;
  external_id: string | null;
  sync_window_days: number | null;
  last_discovered_at: string | null;
};

/**
 * How much of the discovery pool an automatic (cron) attempt asks for, and
 * how long it waits before asking again for the same account.
 *
 * A metered vendor bills per row returned, not per new item found -- there is
 * no cheap "just tell me what's new" call, so every discovery attempt costs
 * roughly the same regardless of whether it turns up anything. At the cron's
 * 15-minute cadence, asking every tick is not a pacing choice, it is an
 * accident: ~10 workspace accounts x 12 rows would exhaust an entire month's
 * 200-credit discovery pool in under half an hour, and then no new upload
 * would be auto-discovered for the rest of the month.
 *
 * 5 x 10 accounts, once every 10 days, is ~150/month -- comfortably inside
 * the pool with headroom left for manual syncs and uneven posting. A manual
 * trigger (the "Sync now" button, or an account's first import) bypasses
 * this: it is a deliberate action a person is not going to click 96 times a
 * day, and it deserves the fuller catch-up.
 */
export {
  AUTO_DISCOVERY_WANT,
  AUTO_DISCOVERY_COOLDOWN_MS,
  MAX_METERED_DISCOVERY_PER_RUN,
  isDueForDiscovery,
} from "./discoveryThrottle.ts";
import {
  AUTO_DISCOVERY_WANT,
  MAX_METERED_DISCOVERY_PER_RUN,
  isDueForDiscovery,
} from "./discoveryThrottle.ts";
import { freeThumbnailFor, THUMBNAIL_FILL_CAP } from "./thumbnails.ts";

/**
 * Fills in poster frames for this account's posts that have none.
 *
 * Deliberately part of the SYNC rather than a script someone remembers to
 * run: a new TikTok post would otherwise never get a thumbnail, because its
 * discovery response does not carry one. Capped per run and paced, because
 * TikTok's oEmbed is a free courtesy endpoint and the fastest way to lose a
 * free route is to hammer it.
 *
 * Instagram is skipped here: its only source is the metered discovery
 * response, which already sets the column when it runs.
 */
async function fillMissingThumbnails(db: Db, account: AccountRow): Promise<void> {
  const { data: gaps } = await db
    .from("platform_posts")
    .select("id, external_id, url")
    .eq("workspace_id", account.workspace_id)
    .eq("account_id", account.id)
    .is("thumbnail_url", null)
    .not("external_id", "is", null)
    .limit(THUMBNAIL_FILL_CAP);

  const rows = (gaps ?? []) as { id: string; external_id: string; url: string | null }[];
  if (rows.length === 0) return;

  for (const row of rows) {
    const src = await freeThumbnailFor(
      account.platform_slug,
      row.external_id,
      account.handle,
      row.url,
    );
    if (!src) {
      // No free route for this platform -- stop rather than walk the whole
      // page asking a question that has the same answer every time.
      if (account.platform_slug !== "tiktok") return;
      continue;
    }
    await db.from("platform_posts").update({ thumbnail_url: src }).eq("id", row.id);
    // Only pace the route that makes a real request; YouTube's is arithmetic.
    if (account.platform_slug === "tiktok") {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

/** The import cutoff as an ISO date, or null when the window is unbounded. */
function cutoffFor(windowDays: number | null): string | null {
  if (windowDays == null) return null;
  return new Date(Date.now() - windowDays * 86400000).toISOString().slice(0, 10);
}

/**
 * Syncs one account. Returns rather than throws: one channel being renamed
 * must not stop every other account in the workspace from refreshing.
 */
export async function syncAccount(
  db: Db,
  account: AccountRow,
  opts: { discoverLimit?: number; pool?: BudgetPool; trigger?: "cron" | "manual" } = {},
): Promise<AccountSyncResult> {
  const base = {
    accountId: account.id,
    handle: account.handle,
    platform: account.platform_slug,
    postsSeen: 0,
    postsCreated: 0,
    snapshotsWritten: 0,
  };

  const provider = providerFor(account.platform_slug);
  if (!provider) {
    return { ...base, status: "skipped", error: `No provider for ${account.platform_slug}.` };
  }
  if (!provider.capability.canFetchMetrics) {
    return { ...base, status: "skipped", error: provider.capability.reason };
  }
  if (!provider.isConfigured()) {
    return {
      ...base,
      status: "skipped",
      error: `Not configured: ${provider.missingEnv().join(", ")} missing.`,
    };
  }

  // A metered platform costs credit per post read, so it takes an entirely
  // different path: only the posts whose age-tier says they are due get
  // fetched, and only as many as the budget actually grants.
  if (await isMetered(db, account.platform_slug)) {
    return syncMeteredAccount(db, account, base, opts.pool ?? "auto", opts.trigger ?? "cron");
  }

  // 1. Discover what the platform currently shows on this account, bounded by
  //    the account's own import window so a channel with a decade of uploads
  //    does not get walked in full on every run.
  //
  //    Some platforms can read a known post but cannot list an account's
  //    posts at all -- TikTok blocks profile pages, so discovery there goes
  //    through a separate, independently-configured helper (see tiktok.ts).
  //    That means discovery and metrics-refresh can fail for entirely
  //    unrelated reasons on the same platform, which is exactly why a
  //    discovery failure is recorded and carried forward rather than
  //    returned early: the free, always-working metrics refresh in step 4
  //    must not go dark just because a discovery helper is unreachable.
  let discoveredPosts: DiscoveredPost[] = [];
  let discoveryError: string | null = null;

  if (provider.capability.canDiscover) {
    /* A platform can be free to REFRESH and still cost money to DISCOVER --
       TikTok is exactly that: finding a new video needs a paid vendor, and
       reading that video's numbers afterwards is free forever.

       So discovery on those platforms goes through the same budget claim and
       the same cooldown as a fully metered platform, while the metrics
       refresh below stays untouched and unlimited. Without this the 15-minute
       cron would re-list the same thirty videos every tick and spend the
       month's discovery pool before lunch, on nothing -- the vendor bills per
       ROW RETURNED, not per new video found. */
    const meteredDiscovery = provider.capability.discoveryMetered === true;
    const trigger = opts.trigger ?? "cron";
    let grantedDiscovery: number | null = null;

    if (meteredDiscovery) {
      if (!isDueForDiscovery(trigger, account.last_discovered_at)) {
        grantedDiscovery = 0;
      } else if (
        trigger === "cron" &&
        meteredDiscoveries >= MAX_METERED_DISCOVERY_PER_RUN
      ) {
        // Out of wall-clock budget for blocking vendor calls this run.
        // Deliberately does NOT stamp last_discovered_at: this account never
        // got its attempt, so it must stay due rather than be pushed to the
        // back of a 10-day cooldown it did not use.
        grantedDiscovery = 0;
      } else {
        meteredDiscoveries++;
        const want = trigger === "manual" ? 12 : AUTO_DISCOVERY_WANT;
        grantedDiscovery = await claim(
          db,
          account.workspace_id,
          account.platform_slug,
          "discovery",
          want,
        );
        // The attempt happened whether or not it was billed, so the cooldown
        // resets either way. Stamping only on success would make a vendor
        // outage retry on every tick -- the exact unthrottled spend this
        // exists to prevent.
        await db
          .from("accounts")
          .update({ last_discovered_at: new Date().toISOString() })
          .eq("id", account.id);
      }
    }

    if (!meteredDiscovery || (grantedDiscovery ?? 0) > 0) {
      const discovered = await provider.discover(account.handle, {
        limit: grantedDiscovery ?? opts.discoverLimit ?? 200,
        since: cutoffFor(account.sync_window_days),
      });
      if (!discovered.ok) {
        discoveryError = discovered.error;
        // Nothing was returned, so nothing should have been charged.
        if (meteredDiscovery && grantedDiscovery) {
          await refund(
            db,
            account.workspace_id,
            account.platform_slug,
            "discovery",
            grantedDiscovery,
          );
        }
      } else {
        discoveredPosts = discovered.data;
        // Hand back the difference between what was reserved and what the
        // vendor actually billed for, so a quiet week does not burn the pool.
        if (meteredDiscovery && grantedDiscovery) {
          const billed = discovered.billedCount ?? discovered.data.length;
          if (billed < grantedDiscovery) {
            await refund(
              db,
              account.workspace_id,
              account.platform_slug,
              "discovery",
              grantedDiscovery - billed,
            );
          }
        }
      }
    } else if (meteredDiscovery && grantedDiscovery === 0) {
      // Not an error: either the cooldown has not elapsed or the pool is
      // spent. Either way the free metrics refresh below carries on.
      discoveryError = null;
    }
  }

  // 1b. Close any thumbnail gaps on this account, using only free routes.
  //     Runs on every sync so the system stays furnished without anybody
  //     running a script: TikTok's discovery carries no image at all, and
  //     anything that arrived before the column existed has none either.
  //     Never allowed to fail a sync -- a missing poster frame is cosmetic,
  //     and letting it break a metrics run would trade something that matters
  //     for something that does not.
  await fillMissingThumbnails(db, account).catch(() => {});

  // 2. Which of those are already tracked as platform_posts?
  const { data: existingRows } = await db
    .from("platform_posts")
    .select("id, external_id, content_item_id")
    .eq("workspace_id", account.workspace_id)
    .eq("account_id", account.id);

  const existing = (existingRows ?? []) as {
    id: string;
    external_id: string | null;
    content_item_id: string;
  }[];
  const byExternalId = new Map(
    existing.filter((p) => p.external_id).map((p) => [p.external_id!, p]),
  );

  let postsCreated = 0;

  // 3. Adopt anything new. Each new post needs a content item to hang from --
  //    one is created per discovered video, carrying the account's client so
  //    it lands under the right client on the dashboard immediately.
  const unseen = discoveredPosts.filter((d) => !byExternalId.has(d.externalId));
  if (unseen.length > 0) {
    // Durations are not in the playlist listing, so they are fetched here
    // rather than left null on every auto-created item.
    const details = await fetchVideoDetails(unseen.map((u) => u.externalId));
    const lengthById = new Map(
      details.ok ? details.data.map((d) => [d.externalId, d.lengthSeconds]) : [],
    );

    for (const post of unseen) {
      // Enrichment the discovery response already carried (PRD §3.2). All of
      // it is optional: a provider that cannot see a field leaves it
      // undefined, and undefined must stay NULL rather than become a value.
      const e = post.enrichment;

      const { data: item, error: itemErr } = await db
        .from("content_items")
        .insert({
          workspace_id: account.workspace_id,
          client_id: account.client_id,
          title: post.title,
          produced_at: post.postedAt,
          length_seconds: lengthById.get(post.externalId) ?? null,
          description: e?.description ?? null,
          topic_labels: e?.topicLabels?.length ? e.topicLabels : null,
          notes: `Discovered automatically from ${account.platform_slug} @${account.handle}.`,
        })
        .select("id")
        .single();
      if (itemErr || !item) continue;

      const { data: created, error: postErr } = await db
        .from("platform_posts")
        .insert({
          workspace_id: account.workspace_id,
          content_item_id: item.id,
          account_id: account.id,
          external_id: post.externalId,
          url: post.url,
          posted_at: post.postedAt,
          // The full instant, before posted_at's date cast throws the hour
          // away for good. Nothing can recover this after the fact.
          posted_at_ts: e?.postedAtTs ?? null,
          has_captions: e?.hasCaptions ?? null,
          thumbnail_url: post.thumbnailUrl ?? null,
          source: "api",
        })
        .select("id, external_id, content_item_id")
        .single();
      if (postErr || !created) continue;

      byExternalId.set(post.externalId, created);
      postsCreated++;
    }
  }

  // 4. Refresh metrics for every tracked post on this account, including ones
  //    added by hand -- as long as somebody recorded the platform's id for it.
  const trackedIds = [...byExternalId.keys()];
  if (trackedIds.length === 0) {
    await db
      .from("accounts")
      .update({ last_synced_at: new Date().toISOString(), last_sync_error: discoveryError })
      .eq("id", account.id);
    return {
      ...base,
      status: "ok",
      postsSeen: discoveredPosts.length,
      postsCreated,
      error: discoveryError ?? undefined,
    };
  }

  const metrics = await provider.fetchMetrics(trackedIds);
  if (!metrics.ok) {
    await db
      .from("accounts")
      .update({ last_sync_error: metrics.error, last_synced_at: new Date().toISOString() })
      .eq("id", account.id);
    return {
      ...base,
      status: "error",
      postsSeen: discoveredPosts.length,
      postsCreated,
      error: metrics.error,
    };
  }

  // 5. Append snapshots -- but only where something actually changed. An
  //    unchanged reading adds a row that says nothing, and the growth figures
  //    read intervals off consecutive snapshots, so padding the series with
  //    duplicates would make "gained 0 views" indistinguishable from "we
  //    polled twice and nothing happened in between".
  const { data: latestRows } = await db
    .from("post_snapshots")
    .select("platform_post_id, views, likes, comments, captured_at")
    .eq("workspace_id", account.workspace_id)
    .in("platform_post_id", [...byExternalId.values()].map((p) => p.id))
    .order("captured_at", { ascending: false });

  const latestByPost = new Map<string, { views: number | null; likes: number | null; comments: number | null }>();
  for (const row of (latestRows ?? []) as {
    platform_post_id: string;
    views: number | null;
    likes: number | null;
    comments: number | null;
  }[]) {
    if (!latestByPost.has(row.platform_post_id)) latestByPost.set(row.platform_post_id, row);
  }

  const toInsert: Record<string, unknown>[] = [];
  for (const m of metrics.data) {
    const post = byExternalId.get(m.externalId);
    if (!post) continue;
    const prev = latestByPost.get(post.id);
    const unchanged =
      prev &&
      prev.views === m.views &&
      prev.likes === m.likes &&
      prev.comments === m.comments;
    if (unchanged) continue;

    toInsert.push({
      workspace_id: account.workspace_id,
      platform_post_id: post.id,
      views: m.views,
      likes: m.likes,
      comments: m.comments,
      source: "api",
    });
  }

  if (toInsert.length > 0) {
    const { error } = await db.from("post_snapshots").insert(toInsert);
    if (error) {
      await db
        .from("accounts")
        .update({ last_sync_error: error.message, last_synced_at: new Date().toISOString() })
        .eq("id", account.id);
      return {
        ...base,
        status: "error",
        postsSeen: discoveredPosts.length,
        postsCreated,
        error: error.message,
      };
    }
  }

  // A metrics refresh that succeeded clears any PREVIOUS error, but a
  // discovery failure from this same run is worth keeping visible -- it is
  // not fatal to this sync, but it is real information for whoever is
  // looking at why new TikTok uploads have not appeared in a while.
  await db
    .from("accounts")
    .update({ last_synced_at: new Date().toISOString(), last_sync_error: discoveryError })
    .eq("id", account.id);

  return {
    ...base,
    status: "ok",
    postsSeen: discoveredPosts.length,
    postsCreated,
    snapshotsWritten: toInsert.length,
    error: discoveryError ?? undefined,
  };
}

/**
 * Syncs every enabled account, optionally narrowed to one workspace or one
 * account. Each account gets its own sync_runs row so a partial failure is
 * legible afterwards rather than collapsing into one status for the batch.
 */
export async function runSync(
  db: Db,
  opts: {
    workspaceId?: string;
    accountId?: string;
    /** Narrow a run to one platform -- the Data panel's per-platform buttons. */
    platformSlug?: string;
    trigger?: "cron" | "manual";
    discoverLimit?: number;
  } = {},
): Promise<AccountSyncResult[]> {
  let q = db
    .from("accounts")
    .select(
      "id, workspace_id, client_id, platform_slug, handle, external_id, sync_window_days, last_discovered_at",
    )
    .eq("sync_enabled", true)
    .eq("is_archived", false);

  if (opts.workspaceId) q = q.eq("workspace_id", opts.workspaceId);
  if (opts.accountId) q = q.eq("id", opts.accountId);
  if (opts.platformSlug) q = q.eq("platform_slug", opts.platformSlug);

  /**
   * Accounts belonging to an ARCHIVED CLIENT are skipped entirely.
   *
   * Archiving a client is the statement "we no longer work with them", and
   * every read the sync makes on their behalf after that costs something
   * real: YouTube quota, and for Instagram actual Apify credit from a monthly
   * ceiling that BLOCKS when exhausted. Continuing to track them spends a
   * finite budget on data nobody will look at, and can starve live clients of
   * the credit they need.
   *
   * Filtered in code rather than by an inner join because an account with NO
   * client (client_id null) must keep syncing -- an inner join would silently
   * drop those, which is the opposite of the intent.
   */
  const archived = await db
    .from("clients")
    .select("id")
    .eq("is_archived", true);
  const archivedClientIds = new Set(
    ((archived.data ?? []) as { id: string }[]).map((c) => c.id),
  );

  // Stalest first, never-synced before everything. The account list used to
  // come back in arbitrary-but-stable order, so when a run hit the function
  // time limit the SAME accounts sat past the cutoff every day -- six
  // Instagram accounts were found six days stale while their siblings
  // refreshed each morning. Ordered this way, a killed run self-heals: the
  // accounts it missed are exactly the ones the next run starts with.
  q = q.order("last_synced_at", { ascending: true, nullsFirst: true });

  const { data, error } = await q;
  if (error) throw new Error(`Could not list accounts: ${error.message}`);

  const accounts = (data ?? []).filter(
    (a) => !(a as AccountRow).client_id || !archivedClientIds.has((a as AccountRow).client_id!),
  ) as AccountRow[];
  const results: AccountSyncResult[] = [];
  // Blocking vendor discovery calls used so far this run -- see
  // MAX_METERED_DISCOVERY_PER_RUN for why wall clock, not spend, is the limit.
  let meteredDiscoveries = 0;

  for (const account of accounts) {
    // Platforms with no public read are skipped without a run row: logging a
    // failure every fifteen minutes for something that is never going to work
    // would bury the failures that are actually actionable.
    const provider = providerFor(account.platform_slug);
    if (!provider?.capability.canFetchMetrics || !provider.isConfigured()) {
      results.push({
        accountId: account.id,
        handle: account.handle,
        platform: account.platform_slug,
        status: "skipped",
        postsSeen: 0,
        postsCreated: 0,
        snapshotsWritten: 0,
        error: provider ? provider.capability.reason : "No provider.",
      });
      continue;
    }

    const { data: run } = await db
      .from("sync_runs")
      .insert({
        workspace_id: account.workspace_id,
        account_id: account.id,
        trigger: opts.trigger ?? "cron",
      })
      .select("id")
      .single();

    const trigger = opts.trigger ?? "cron";
    const result = await syncAccount(db, account, {
      discoverLimit: opts.discoverLimit,
      trigger,
      // A manually-triggered run spends from the reserved manual pool, not
      // the automatic one -- so pressing "Sync now" or importing a new
      // account can never be starved by what the scheduled cron already
      // spent this period, and vice versa.
      pool: trigger === "manual" ? "manual" : "auto",
    });
    results.push(result);

    if (run?.id) {
      await db
        .from("sync_runs")
        .update({
          finished_at: new Date().toISOString(),
          status: result.status,
          posts_seen: result.postsSeen,
          posts_created: result.postsCreated,
          snapshots_written: result.snapshotsWritten,
          error: result.error ?? null,
        })
        .eq("id", run.id);
    }
  }

  return results;
}

/**
 * Sync for a platform that bills per post read.
 *
 * Differs from the free path in three ways, all of them about money:
 * discovery is a separate, separately-capped spend; refreshes address only
 * the posts whose age-tier says they are due; and every fetch is preceded by
 * a budget claim whose granted amount -- not the requested amount -- is what
 * gets spent.
 */
async function syncMeteredAccount(
  db: Db,
  account: AccountRow,
  base: Omit<AccountSyncResult, "status">,
  pool: BudgetPool,
  trigger: "cron" | "manual",
): Promise<AccountSyncResult> {
  const provider = providerFor(account.platform_slug)!;
  const ws = account.workspace_id;
  const platform = account.platform_slug;
  let postsCreated = 0;
  let postsSeen = 0;
  let discoverySnapshots = 0;

  // 1. Retire anything past the last age band before spending anything. This
  //    is free, and it shrinks the due set before budget is claimed.
  const { due, retire } = await findDuePosts(db, ws, account.id, platform);
  if (retire.length > 0) await retirePosts(db, retire);

  // 2. Discovery, from its own pool so it can never starve refreshes. Only
  //    attempted when the platform can list posts at all.
  //
  //    A cron tick waits out its cooldown before spending on this at all.
  //    The cadence, not the pool cap, is what protects the month's budget:
  //    the vendor bills per row returned regardless of whether it turns out
  //    to be new, so an unthrottled 15-minute cron would ask the same
  //    account's mostly-unchanged recent posts 96 times a day and burn the
  //    whole discovery pool before lunch. A manual trigger -- a person
  //    pressing "Sync now", or an account's first import -- always goes
  //    through at the fuller size: nobody clicks that 96 times a day, and it
  //    deserves the real catch-up.
  if (provider.capability.canDiscover && isDueForDiscovery(trigger, account.last_discovered_at)) {
    const want = trigger === "manual" ? 12 : AUTO_DISCOVERY_WANT;
    const granted = await claim(db, ws, platform, "discovery", want);
    if (granted > 0) {
      const found = await provider.discover(account.handle, { limit: granted });
      // An attempt happened -- billed or not -- so the cooldown clock resets
      // either way. Stamping only on success would mean a vendor outage
      // makes every subsequent cron tick retry immediately, which is exactly
      // the unthrottled-spend scenario this exists to prevent.
      await db
        .from("accounts")
        .update({ last_discovered_at: new Date().toISOString() })
        .eq("id", account.id);

      if (!found.ok) {
        // Nothing was returned, so nothing was billed -- hand the claim back
        // rather than letting a vendor outage consume the month's allowance.
        await refund(db, ws, platform, "discovery", granted);
      } else {
        postsSeen = found.data.length;
        // Refund against what was actually billed, not what survived
        // filtering -- a vendor that bills per row returned has already
        // charged for every photo this provider then dropped client-side.
        const billed = found.billedCount ?? found.data.length;
        if (billed < granted) {
          await refund(db, ws, platform, "discovery", granted - billed);
        }

        const { data: existingRows } = await db
          .from("platform_posts")
          .select("external_id")
          .eq("workspace_id", ws)
          .eq("account_id", account.id);
        const known = new Set(
          ((existingRows ?? []) as { external_id: string | null }[])
            .map((r) => r.external_id)
            .filter(Boolean),
        );

        for (const post of found.data.filter((p) => !known.has(p.externalId))) {
          const { data: item } = await db
            .from("content_items")
            .insert({
              workspace_id: ws,
              client_id: account.client_id,
              title: post.title,
              produced_at: post.postedAt,
              length_seconds: post.lengthSeconds,
              notes: `Discovered automatically from ${platform} @${account.handle}.`,
            })
            .select("id")
            .single();
          if (!item) continue;

          // Newly discovered posts arrive already measured by the discovery
          // call, so they are stamped as scraped now -- leaving the stamp
          // null would make every one of them immediately "due" again and
          // pay for the exact same reading twice within one sync. The stamp
          // is only honest once the reading it claims is actually recorded
          // below; a post marked "just scraped" with no snapshot to show
          // for it would sit at a false zero until its next scheduled turn.
          const { data: created } = await db
            .from("platform_posts")
            .insert({
              workspace_id: ws,
              content_item_id: item.id,
              account_id: account.id,
              external_id: post.externalId,
              url: post.url,
              posted_at: post.postedAt,
              thumbnail_url: post.thumbnailUrl ?? null,
              source: "api",
              last_scraped_at: new Date().toISOString(),
            })
            .select("id")
            .single();
          if (!created) continue;
          postsCreated++;

          if (post.metrics) {
            const { error: snapErr } = await db.from("post_snapshots").insert({
              workspace_id: ws,
              platform_post_id: created.id,
              views: post.metrics.views,
              likes: post.metrics.likes,
              comments: post.metrics.comments,
              source: "api",
            });
            if (!snapErr) discoverySnapshots++;
          }
        }
      }
    }
  }

  if (due.length === 0) {
    await db
      .from("accounts")
      .update({ last_synced_at: new Date().toISOString(), last_sync_error: null })
      .eq("id", account.id);
    return { ...base, status: "ok", postsSeen, postsCreated, snapshotsWritten: discoverySnapshots };
  }

  // 3. Claim for the refresh, then take only the most-overdue N the budget
  //    allowed. A partial grant is normal near the end of a period.
  const granted = await claim(db, ws, platform, pool, due.length);
  if (granted === 0) {
    const msg = `Scrape budget exhausted for ${platform}; ${due.length} post(s) waiting for the next period.`;
    await db
      .from("accounts")
      .update({ last_sync_error: msg, last_synced_at: new Date().toISOString() })
      .eq("id", account.id);
    return {
      ...base,
      status: "ok",
      postsSeen,
      postsCreated,
      snapshotsWritten: discoverySnapshots,
      error: msg,
    };
  }

  const batch = due.slice(0, granted);
  const metrics = await provider.fetchMetrics(batch.map((p) => p.externalId));

  if (!metrics.ok) {
    await refund(db, ws, platform, pool, granted);
    await db
      .from("accounts")
      .update({ last_sync_error: metrics.error, last_synced_at: new Date().toISOString() })
      .eq("id", account.id);
    return {
      ...base,
      status: "error",
      postsSeen,
      postsCreated,
      snapshotsWritten: discoverySnapshots,
      error: metrics.error,
    };
  }
  if (metrics.data.length < granted) {
    await refund(db, ws, platform, pool, granted - metrics.data.length);
  }

  // 4. Append snapshots, skipping readings identical to the last one so the
  //    series stays a record of change rather than of polling.
  const idToPost = new Map(batch.map((p) => [p.externalId, p]));
  const { data: latestRows } = await db
    .from("post_snapshots")
    .select("platform_post_id, views, likes, comments, captured_at")
    .eq("workspace_id", ws)
    .in("platform_post_id", batch.map((p) => p.id))
    .order("captured_at", { ascending: false });

  const latest = new Map<string, { views: number | null; likes: number | null; comments: number | null }>();
  for (const r of (latestRows ?? []) as {
    platform_post_id: string;
    views: number | null;
    likes: number | null;
    comments: number | null;
  }[]) {
    if (!latest.has(r.platform_post_id)) latest.set(r.platform_post_id, r);
  }

  const toInsert: Record<string, unknown>[] = [];
  const scrapedIds: string[] = [];
  for (const m of metrics.data) {
    const post = idToPost.get(m.externalId);
    if (!post) continue;
    scrapedIds.push(post.id);

    const prev = latest.get(post.id);
    const unchanged =
      prev && prev.views === m.views && prev.likes === m.likes && prev.comments === m.comments;
    if (unchanged) continue;

    toInsert.push({
      workspace_id: ws,
      platform_post_id: post.id,
      views: m.views,
      likes: m.likes,
      comments: m.comments,
      source: "api",
    });
  }

  if (toInsert.length > 0) {
    const { error } = await db.from("post_snapshots").insert(toInsert);
    if (error) {
      return { ...base, status: "error", postsSeen, postsCreated, error: error.message };
    }
  }

  // Stamp every post we paid to read, including ones whose numbers had not
  // moved -- they were read, and re-reading them tomorrow would bill again.
  if (scrapedIds.length > 0) {
    await db
      .from("platform_posts")
      .update({ last_scraped_at: new Date().toISOString() })
      .in("id", scrapedIds);
  }

  await db
    .from("accounts")
    .update({ last_synced_at: new Date().toISOString(), last_sync_error: null })
    .eq("id", account.id);

  return {
    ...base,
    status: "ok",
    postsSeen: postsSeen + batch.length,
    postsCreated,
    snapshotsWritten: discoverySnapshots + toInsert.length,
  };
}
