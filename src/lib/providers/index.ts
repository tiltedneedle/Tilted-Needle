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

/**
 * Shorts is the SAME channel read through the same key, filtered the other
 * way -- so it delegates rather than duplicating a provider file. Only
 * `discover` differs, and only by forcing shortsOnly; search, fetchMetrics
 * and the config checks are the YouTube ones verbatim, because they key on a
 * video id and a channel handle, neither of which knows what a Short is.
 *
 * It is a separate PLATFORM because a Shorts view and a long-form YouTube
 * view are different events (impression vs ~30 seconds watched), and the
 * whole per-platform model exists so those never get pooled. It is not a
 * separate provider because there is nothing different to fetch.
 */
const youtubeShortsProvider: PublicProvider = {
  ...youtubeProvider,
  slug: "youtube_shorts",
  discover: (handle, options = {}) =>
    youtubeProvider.discover(handle, { ...options, shortsOnly: true }),
};

export const PROVIDERS: Record<string, PublicProvider> = {
  youtube: youtubeProvider,
  youtube_shorts: youtubeShortsProvider,
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
