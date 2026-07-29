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
import { providerFor } from "@/lib/providers";
import { fetchVideoDetails } from "@/lib/providers/youtube";

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
};

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
  opts: { discoverLimit?: number } = {},
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

  // 1. Discover what the platform currently shows on this account, bounded by
  //    the account's own import window so a channel with a decade of uploads
  //    does not get walked in full on every run.
  //
  //    Some platforms can read a known post but cannot list an account's
  //    posts at all -- TikTok blocks profile pages. For those, discovery is
  //    skipped rather than attempted and failed: their posts are registered
  //    by URL, and everything from step 4 down still refreshes normally.
  let discoveredPosts: { externalId: string; title: string; url: string; postedAt: string | null }[] = [];

  if (provider.capability.canDiscover) {
    const discovered = await provider.discover(account.handle, {
      limit: opts.discoverLimit ?? 200,
      since: cutoffFor(account.sync_window_days),
    });
    if (!discovered.ok) {
      await db
        .from("accounts")
        .update({ last_sync_error: discovered.error, last_synced_at: new Date().toISOString() })
        .eq("id", account.id);
      return { ...base, status: "error", error: discovered.error };
    }
    discoveredPosts = discovered.data;
  }

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
      const { data: item, error: itemErr } = await db
        .from("content_items")
        .insert({
          workspace_id: account.workspace_id,
          client_id: account.client_id,
          title: post.title,
          produced_at: post.postedAt,
          length_seconds: lengthById.get(post.externalId) ?? null,
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
      .update({ last_synced_at: new Date().toISOString(), last_sync_error: null })
      .eq("id", account.id);
    return { ...base, status: "ok", postsSeen: discoveredPosts.length, postsCreated };
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

  await db
    .from("accounts")
    .update({ last_synced_at: new Date().toISOString(), last_sync_error: null })
    .eq("id", account.id);

  return {
    ...base,
    status: "ok",
    postsSeen: discoveredPosts.length,
    postsCreated,
    snapshotsWritten: toInsert.length,
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
    trigger?: "cron" | "manual";
    discoverLimit?: number;
  } = {},
): Promise<AccountSyncResult[]> {
  let q = db
    .from("accounts")
    .select("id, workspace_id, client_id, platform_slug, handle, external_id, sync_window_days")
    .eq("sync_enabled", true)
    .eq("is_archived", false);

  if (opts.workspaceId) q = q.eq("workspace_id", opts.workspaceId);
  if (opts.accountId) q = q.eq("id", opts.accountId);

  const { data, error } = await q;
  if (error) throw new Error(`Could not list accounts: ${error.message}`);

  const accounts = (data ?? []) as AccountRow[];
  const results: AccountSyncResult[] = [];

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

    const result = await syncAccount(db, account, { discoverLimit: opts.discoverLimit });
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
