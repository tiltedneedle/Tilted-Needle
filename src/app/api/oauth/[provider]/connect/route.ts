import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { canManage } from "@/lib/types";
import { buildAuthorizeUrl, isConfigured } from "@/lib/connectors";

/**
 * Starts the OAuth handshake for one account. Requires the account's own
 * client to grant access, which is the whole point of Phase 6 (PRD 4) --
 * this route cannot do that on anyone's behalf, only ask.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const accountId = request.nextUrl.searchParams.get("account_id");
  if (!accountId) {
    return NextResponse.json({ error: "account_id is required" }, { status: 400 });
  }

  if (!isConfigured(provider)) {
    return NextResponse.json(
      {
        error: `${provider} is not configured on this deployment. It needs a registered OAuth app before any account can connect -- see the Accounts page for which environment variables are missing.`,
      },
      { status: 501 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

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

  // Bound to this browser via an httpOnly cookie and checked byte-for-byte on
  // return, so a forged callback cannot bind an attacker's tokens to this
  // account (a standard OAuth CSRF concern, not specific to this app).
  const state = randomUUID();
  const cookieStore = await cookies();
  cookieStore.set(`oauth_state_${provider}`, `${state}:${accountId}`, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  const redirectUri = new URL(`/api/oauth/${provider}/callback`, request.url).toString();
  const url = buildAuthorizeUrl(provider, redirectUri, state);
  return NextResponse.redirect(url);
}
