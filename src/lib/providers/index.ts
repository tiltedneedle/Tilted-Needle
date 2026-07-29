/**
 * The provider registry: which platforms this app can read *without* the
 * client authorising anything.
 *
 * Exactly one of the four can, and pretending otherwise would be the most
 * expensive mistake available here -- a dashboard that silently shows stale
 * or zeroed numbers for three platforms is worse than one that says plainly
 * it cannot see them.
 */
import { youtubeProvider } from "./youtube.ts";
import { tiktokProvider } from "./tiktok.ts";
import { unavailableProvider, type PublicProvider } from "./types.ts";

export const PROVIDERS: Record<string, PublicProvider> = {
  youtube: youtubeProvider,
  tiktok: tiktokProvider,

  // Tested directly rather than assumed, and every route is closed: the embed
  // pages return a login-walled shell carrying no metric fields at all, the
  // profile API rate-limits unauthenticated callers immediately, and the
  // public mirror sites that used to proxy this are gone or blocking. The
  // paid scraping vendors exist precisely because none of it works for free.
  instagram: unavailableProvider(
    "instagram",
    "Instagram publishes no public metrics. Its embed pages carry no numbers, its profile API blocks unauthenticated callers, and the Graph API only returns insights for an account that has authorised the app.",
    "Have the client connect the account (one click on a permission screen — they never hand over credentials), or enter metrics by hand from their Insights screen.",
  ),

  facebook: unavailableProvider(
    "facebook",
    "Reading another Page's content needs Page Public Content Access, a restricted Meta permission granted only through app review.",
    "Either have the client connect the Page, or enter metrics by hand.",
  ),
};

export function providerFor(slug: string): PublicProvider | null {
  return PROVIDERS[slug] ?? null;
}

/** Platforms that can actually sync right now, key present and all. */
export function syncablePlatforms(): string[] {
  return Object.values(PROVIDERS)
    .filter((p) => p.capability.canFetchMetrics && p.isConfigured())
    .map((p) => p.slug);
}

export type { PublicProvider, ProviderCapability, DiscoveredPost, PublicMetrics } from "./types.ts";
