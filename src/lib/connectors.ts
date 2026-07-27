/**
 * OAuth connector registry (PRD 9.5).
 *
 * Each provider needs a developer-console app registered with that platform
 * before any connect flow can run -- a client ID, a client secret, and a
 * verified redirect URI. Those are credentials only the workspace owner can
 * obtain; this app cannot provision them. `isConfigured()` reflects exactly
 * that: whether the corresponding env vars are present, not whether the
 * feature is "done." The UI must show the difference plainly rather than a
 * greyed-out button with no explanation.
 */

export type ConnectorConfig = {
  slug: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Extra query params the authorize URL needs beyond the OAuth basics. */
  extraAuthorizeParams?: Record<string, string>;
};

export const CONNECTORS: Record<string, ConnectorConfig> = {
  youtube: {
    slug: "youtube",
    clientIdEnv: "YOUTUBE_CLIENT_ID",
    clientSecretEnv: "YOUTUBE_CLIENT_SECRET",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    // Analytics scope is what actually unlocks CTR and retention; readonly
    // alone would only re-fetch what the public Data API already gives us.
    scopes: [
      "https://www.googleapis.com/auth/yt-analytics.readonly",
      "https://www.googleapis.com/auth/youtube.readonly",
    ],
    extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
  },
  // Instagram and Facebook both sit behind Meta's Graph API and additionally
  // require app review before any account other than the developer's own can
  // authorize -- see PRD auth_model = 'oauth_review'. Registered here so the
  // "not configured" UI is consistent, not because the flow is ready.
  instagram: {
    slug: "instagram",
    clientIdEnv: "META_CLIENT_ID",
    clientSecretEnv: "META_CLIENT_SECRET",
    authorizeUrl: "https://www.facebook.com/v19.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v19.0/oauth/access_token",
    scopes: ["instagram_basic", "instagram_manage_insights"],
  },
  facebook: {
    slug: "facebook",
    clientIdEnv: "META_CLIENT_ID",
    clientSecretEnv: "META_CLIENT_SECRET",
    authorizeUrl: "https://www.facebook.com/v19.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v19.0/oauth/access_token",
    scopes: ["pages_read_engagement", "read_insights"],
  },
  tiktok: {
    slug: "tiktok",
    clientIdEnv: "TIKTOK_CLIENT_ID",
    clientSecretEnv: "TIKTOK_CLIENT_SECRET",
    authorizeUrl: "https://www.tiktok.com/v2/auth/authorize",
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    scopes: ["user.info.basic", "video.list"],
  },
};

export function isConfigured(slug: string): boolean {
  const c = CONNECTORS[slug];
  if (!c) return false;
  return Boolean(process.env[c.clientIdEnv] && process.env[c.clientSecretEnv]);
}

export function missingEnvVars(slug: string): string[] {
  const c = CONNECTORS[slug];
  if (!c) return [];
  const missing: string[] = [];
  if (!process.env[c.clientIdEnv]) missing.push(c.clientIdEnv);
  if (!process.env[c.clientSecretEnv]) missing.push(c.clientSecretEnv);
  return missing;
}

export function buildAuthorizeUrl(
  slug: string,
  redirectUri: string,
  state: string,
): string {
  const c = CONNECTORS[slug];
  if (!c) throw new Error(`Unknown connector: ${slug}`);
  const clientId = process.env[c.clientIdEnv];
  if (!clientId) throw new Error(`${c.clientIdEnv} is not set`);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: c.scopes.join(" "),
    state,
    ...c.extraAuthorizeParams,
  });
  return `${c.authorizeUrl}?${params.toString()}`;
}
