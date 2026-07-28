import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashApiKey } from "@/lib/apikeys";

/**
 * Resolves a Bearer API key to its workspace using the admin client with a
 * manual, explicit workspace_id filter on every subsequent query -- there is
 * no Supabase session here for RLS to key off, so every route built on this
 * must filter by the returned workspaceId itself. Skipping that filter on
 * any query would leak every workspace's data through the one route that
 * forgot it.
 */
export async function resolveApiKey(
  request: Request,
): Promise<{ workspaceId: string; keyId: string } | NextResponse> {
  const auth = request.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(tn_live_[a-f0-9]+)$/);
  if (!match) {
    return NextResponse.json(
      { error: "Missing or malformed Authorization: Bearer <key> header." },
      { status: 401 },
    );
  }

  const admin = createAdminClient();
  const hash = hashApiKey(match[1]);
  const { data: row } = await admin
    .from("api_keys")
    .select("id, workspace_id, revoked_at")
    .eq("key_hash", hash)
    .maybeSingle();

  if (!row || row.revoked_at) {
    return NextResponse.json({ error: "Invalid or revoked API key." }, { status: 401 });
  }

  // Best-effort; a failed write here must never block the actual request.
  void admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", row.id);

  return { workspaceId: row.workspace_id, keyId: row.id };
}

export function isErrorResponse(x: unknown): x is NextResponse {
  return x instanceof NextResponse;
}
