/**
 * Public-metrics providers: fetching what a platform exposes about an account
 * WITHOUT that account's owner authorising anything.
 *
 * This is a different axis from the OAuth connectors in lib/connectors.ts.
 * Those need the client to grant access and unlock owner-only analytics (CTR,
 * retention, impressions). These need nothing from the client at all -- but
 * can only ever see what the platform makes public.
 *
 * The honest state of that, per platform, as of this writing:
 *
 *   YouTube    YES. The Data API v3 serves public statistics (views, likes,
 *              comments) for any public video, keyed by OUR developer API
 *              key. The client is not involved and never has to be.
 *
 *   Instagram  NO. There is no public metrics API. The Graph API requires the
 *              account owner to authorise, plus Meta app review. The Basic
 *              Display API was retired. oEmbed returns embed markup, not
 *              numbers.
 *
 *   TikTok     NO. The Display API requires user authorisation; the Research
 *              API is limited to approved academic institutions. oEmbed
 *              returns title and thumbnail, no metrics.
 *
 *   Facebook   NO. Page Public Content Access is a restricted permission
 *              granted only through app review with a justified use case.
 *
 * A provider that cannot fetch says so through `capability`, rather than
 * failing at call time or -- worse -- returning zeros that would read as
 * "this post got no views" and silently corrupt every score derived from it.
 * That distinction is the whole reason this interface exists.
 */

export type ProviderCapability = {
  /** Can list an account's recent posts without owner authorisation. */
  canDiscover: boolean;
  /** Can read public metrics for a known post without owner authorisation. */
  canFetchMetrics: boolean;
  /** Shown in the UI to explain why a platform is not syncing. */
  reason: string;
  /** What the workspace owner would have to do to change that, if anything. */
  remedy?: string;
};

/** One post found on an account, before it is matched to a content item. */
export type DiscoveredPost = {
  externalId: string;
  title: string;
  url: string;
  /** ISO date (YYYY-MM-DD) the post went live, when the platform reports it. */
  postedAt: string | null;
  lengthSeconds: number | null;
};

/** A metrics reading for one post at one moment. */
export type PublicMetrics = {
  externalId: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
};

/**
 * A candidate account, returned while someone is searching for the one they
 * mean. Carries enough to tell two similarly named channels apart -- a
 * thumbnail and a subscriber count settle it far faster than a name alone.
 */
export type AccountCandidate = {
  /** Platform-native id, stored so later syncs skip handle resolution. */
  externalId: string;
  title: string;
  handle: string | null;
  description: string;
  thumbnailUrl: string | null;
  subscriberCount: number | null;
  videoCount: number | null;
  url: string;
  /** True when the query resolved to exactly this account, not a guess. */
  exact: boolean;
};

/** Narrowing options for a discovery pass. */
export type DiscoverOptions = {
  limit?: number;
  /** ISO date (YYYY-MM-DD). Posts published before this are not returned. */
  since?: string | null;
};

export type ProviderResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface PublicProvider {
  slug: string;
  capability: ProviderCapability;
  /** Whether the API key this provider needs is actually present. */
  isConfigured(): boolean;
  /** Which env var is missing, for a UI that explains itself. */
  missingEnv(): string[];
  /**
   * Finds accounts matching free text, a handle, or a URL. Used to confirm an
   * account exists *before* it is saved, so a typo surfaces immediately rather
   * than as an empty dashboard days later.
   */
  search(query: string): Promise<ProviderResult<AccountCandidate[]>>;
  discover(
    handle: string,
    options?: DiscoverOptions,
  ): Promise<ProviderResult<DiscoveredPost[]>>;
  fetchMetrics(externalIds: string[]): Promise<ProviderResult<PublicMetrics[]>>;
}

/**
 * A provider for a platform that genuinely cannot be read without the
 * account owner's authorisation.
 *
 * It exists so the sync runner and the UI have something uniform to talk to,
 * and so the reason is carried in the data rather than hard-coded into a
 * message somewhere far from the fact. It never returns fabricated numbers.
 */
export function unavailableProvider(
  slug: string,
  reason: string,
  remedy: string,
): PublicProvider {
  const capability: ProviderCapability = {
    canDiscover: false,
    canFetchMetrics: false,
    reason,
    remedy,
  };
  return {
    slug,
    capability,
    isConfigured: () => false,
    missingEnv: () => [],
    search: async () => ({ ok: false, error: reason }),
    discover: async () => ({ ok: false, error: reason }),
    fetchMetrics: async () => ({ ok: false, error: reason }),
  };
}
