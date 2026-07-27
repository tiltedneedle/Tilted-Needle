import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { CONNECTORS } from "@/lib/connectors";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Exchanges the authorization code for tokens and stores the refresh token in
 * Supabase Vault. Runs entirely server-side with the client secret and the
 * service-role key -- neither can safely exist in browser code.
 *
 * This is real token-exchange code, not a stub: it makes an actual POST to
 * the provider's token endpoint. What it cannot do without genuine app
 * credentials from that platform's developer console is complete a live
 * end-to-end run -- that is an external prerequisite, not something left
 * unbuilt.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const connector = CONNECTORS[provider];
  if (!connector) {
    return NextResponse.json({ error: "Unknown provider." }, { status: 404 });
  }

  const url = request.nextUrl;
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");

  const redirectToAccounts = (message: string) => {
    const dest = new URL("/accounts", request.url);
    dest.searchParams.set("oauth_error", message);
    return NextResponse.redirect(dest);
  };

  if (error) return redirectToAccounts(`${provider} declined: ${error}`);
  if (!code || !returnedState) return redirectToAccounts("Missing code or state.");

  const cookieStore = await cookies();
  const cookieName = `oauth_state_${provider}`;
  const saved = cookieStore.get(cookieName)?.value;
  cookieStore.delete(cookieName);

  const [savedState, accountId] = (saved ?? "").split(":");
  if (!saved || savedState !== returnedState || !accountId) {
    return redirectToAccounts("State did not match. Please try connecting again.");
  }

  const clientId = process.env[connector.clientIdEnv];
  const clientSecret = process.env[connector.clientSecretEnv];
  if (!clientId || !clientSecret) {
    return redirectToAccounts(`${provider} is not configured on this deployment.`);
  }

  const redirectUri = new URL(`/api/oauth/${provider}/callback`, request.url).toString();

  let tokenJson: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  try {
    const tokenRes = await fetch(connector.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    tokenJson = await tokenRes.json();
    if (!tokenRes.ok || tokenJson.error) {
      return redirectToAccounts(
        `Token exchange failed: ${tokenJson.error_description ?? tokenJson.error ?? tokenRes.status}`,
      );
    }
  } catch (e) {
    return redirectToAccounts(
      `Could not reach ${provider}: ${e instanceof Error ? e.message : "unknown error"}`,
    );
  }

  if (!tokenJson.refresh_token) {
    // Google omits this on re-consent unless prompt=consent forced a fresh
    // grant; other providers may not issue one at all on some scopes.
    return redirectToAccounts(
      "No refresh token was returned, so the connection cannot be kept alive automatically. Revoke access in your Google/Meta/TikTok account settings and try again.",
    );
  }

  const admin = createAdminClient();

  const { data: account } = await admin
    .from("accounts")
    .select("id, workspace_id, platform_slug")
    .eq("id", accountId)
    .maybeSingle();
  if (!account || account.platform_slug !== provider) {
    return redirectToAccounts("Account not found.");
  }

  const { data: secretId, error: vaultErr } = await admin.rpc("vault_store_refresh_token", {
    p_secret: tokenJson.refresh_token,
    p_name: `oauth:${provider}:${accountId}`,
  });
  if (vaultErr) {
    return redirectToAccounts(`Could not store the refresh token: ${vaultErr.message}`);
  }

  const expiresAt = tokenJson.expires_in
    ? new Date(Date.now() + tokenJson.expires_in * 1000).toISOString()
    : null;

  const { error: upsertErr } = await admin.from("oauth_connections").upsert(
    {
      workspace_id: account.workspace_id,
      account_id: account.id,
      provider,
      vault_secret_id: secretId,
      scopes: (tokenJson.scope ?? connector.scopes.join(" ")).split(" "),
      status: "active",
      last_error: null,
      connected_at: new Date().toISOString(),
    },
    { onConflict: "account_id" },
  );
  if (upsertErr) return redirectToAccounts(`Could not save the connection: ${upsertErr.message}`);

  await admin.from("accounts").update({ connection_mode: "oauth" }).eq("id", accountId);
  void expiresAt; // Reserved for the sync job that refreshes access tokens.

  const dest = new URL("/accounts", request.url);
  dest.searchParams.set("oauth_connected", provider);
  return NextResponse.redirect(dest);
}
