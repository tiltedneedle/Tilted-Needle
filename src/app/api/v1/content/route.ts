import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveApiKey, isErrorResponse } from "@/lib/publicApi";
import { loadExcludedItemIds } from "@/lib/excludedItems";
import { selectAll } from "@/lib/selectAll";
import { one } from "@/lib/types";

/**
 * GET /api/v1/content?limit=100
 *
 * Per-platform metrics only, deliberately: pooling views across platforms
 * into one number here would ship the exact mistake this app's scoring
 * model exists to avoid (PRD 5 Step 2) to every external integration built
 * on this endpoint.
 */
export async function GET(request: NextRequest) {
  const auth = await resolveApiKey(request);
  if (isErrorResponse(auth)) return auth;

  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit")) || 100, 500);

  const admin = createAdminClient();

  /* Archived clients' work does not leave this endpoint.
   *
   * This runs on the admin client, so RLS is not a backstop here -- the
   * filter has to be explicit or it does not exist. And of every read path in
   * the app, this is the one where being wrong is least recoverable: whatever
   * comes out lands in somebody else's spreadsheet or dashboard, where it
   * will be reconciled against /content by a human who then has to work out
   * which of the two is lying.
   *
   * The exclusion is applied BEFORE the limit, so `limit=100` returns 100
   * live items rather than 100 rows of which some were quietly dropped.
   */
  const excluded = await loadExcludedItemIds(admin as never, auth.workspaceId);

  const { data: allItems, error } = await selectAll<{
    id: string;
    title: string;
    client_id: string | null;
    produced_at: string | null;
  }>(() =>
    admin
      .from("content_items")
      .select("id, title, client_id, produced_at")
      .eq("workspace_id", auth.workspaceId)
      .order("produced_at", { ascending: false, nullsFirst: false })
      .order("id"),
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items = (allItems ?? []).filter((i) => !excluded.has(i.id)).slice(0, limit);

  const ids = (items ?? []).map((i) => i.id);
  const { data: posts } = ids.length
    ? await admin
        .from("platform_posts")
        .select(
          "content_item_id, account:accounts(platform_slug), metrics:post_current_metrics(views, likes, comments)",
        )
        .in("content_item_id", ids)
    : { data: [] };

  type PostRow = {
    content_item_id: string;
    account: { platform_slug: string } | { platform_slug: string }[] | null;
    metrics:
      | { views: number | null; likes: number | null; comments: number | null }
      | { views: number | null; likes: number | null; comments: number | null }[]
      | null;
  };

  const byItem = new Map<string, Record<string, unknown>[]>();
  for (const p of (posts ?? []) as unknown as PostRow[]) {
    const acct = one(p.account);
    if (!acct) continue;
    const m = one(p.metrics);
    if (!byItem.has(p.content_item_id)) byItem.set(p.content_item_id, []);
    byItem.get(p.content_item_id)!.push({
      platform: acct.platform_slug,
      views: m?.views ?? null,
      likes: m?.likes ?? null,
      comments: m?.comments ?? null,
    });
  }

  const data = (items ?? []).map((i) => ({
    id: i.id,
    title: i.title,
    client_id: i.client_id,
    produced_at: i.produced_at,
    platforms: byItem.get(i.id) ?? [],
  }));

  return NextResponse.json({ data });
}
