import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManage } from "@/lib/types";

/**
 * Reverses a connect: deletes the vault secret so the refresh token does not
 * linger after access is revoked, drops the connection row, and returns the
 * account to manual mode. POST, not GET -- this has side effects and must
 * not be triggerable by a prefetch or a stray link click.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const { accountId } = (await request.json().catch(() => ({}))) as {
    accountId?: string;
  };
  if (!accountId) {
    return NextResponse.json({ error: "accountId is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: account } = await supabase
    .from("accounts")
    .select("id, workspace_id, platform_slug")
    .eq("id", accountId)
    .maybeSingle();
  if (!account || account.platform_slug !== provider) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("workspace_id", account.workspace_id)
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!canManage(membership?.role)) {
    return NextResponse.json({ error: "Managers only." }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: conn } = await admin
    .from("oauth_connections")
    .select("id, vault_secret_id")
    .eq("account_id", accountId)
    .maybeSingle();

  if (conn?.vault_secret_id) {
    await admin.rpc("vault_delete_secret", { p_secret_id: conn.vault_secret_id });
  }
  if (conn?.id) {
    await admin.from("oauth_connections").delete().eq("id", conn.id);
  }
  await admin.from("accounts").update({ connection_mode: "manual" }).eq("id", accountId);

  return NextResponse.json({ ok: true });
}
