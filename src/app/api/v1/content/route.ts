import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveApiKey, isErrorResponse } from "@/lib/publicApi";
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
  const { data: items, error } = await admin
    .from("content_items")
    .select("id, title, client_id, produced_at")
    .eq("workspace_id", auth.workspaceId)
    .order("produced_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

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
