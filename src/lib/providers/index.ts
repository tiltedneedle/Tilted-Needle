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
import { instagramProvider } from "./instagram.ts";
import { unavailableProvider, type PublicProvider } from "./types.ts";

export const PROVIDERS: Record<string, PublicProvider> = {
  youtube: youtubeProvider,
  tiktok: tiktokProvider,
  // Free routes were tested directly and all are closed: embed pages carry no
  // metric fields, the profile API rate-limits unauthenticated callers, and
  // the public mirrors are gone. This one goes through a paid vendor, which
  // is why it -- alone -- is metered against a budget.
  instagram: instagramProvider,

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
