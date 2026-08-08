/**
 * Public-metrics providers: fetching what a platform exposes about an account
 * WITHOUT that account's owner authorising anything.
 *
 * Owner-credential flows are retired outright (PRD-video-intelligence §0), so
 * this is the only automated route into a platform's numbers. Owner-only
 * analytics (CTR, retention, impressions) still reach the system, but through
 * a client-supplied Studio/Insights export rather than a connection (§2).
 * These providers need nothing from the client at all -- and can only ever
 * see what the platform makes public.
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
  /**
   * Every fetch costs real money (a paid vendor), rather than a free quota.
   * A first-class flag rather than a sentence, because the UI has to badge it
   * and a fact buried in prose is a fact the interface cannot read -- which
   * is exactly how Instagram came to be labelled "free" on the data panel
   * while every one of its refreshes was spending credit.
   */
  isMetered: boolean;
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
  /**
   * Views/likes/comments, when the same response that found the post also
   * carried its numbers -- true for Instagram's discovery call, which is
   * metered and would otherwise have to be paid for twice: once to find a
   * new post, again moments later through fetchMetrics for a reading it
   * already had. Left undefined for a provider whose discovery call is
   * genuinely metadata-only (YouTube's playlist listing carries no stats).
   */
  metrics?: { views: number | null; likes: number | null; comments: number | null };
  /**
   * Enrichment a provider can supply for free, because the call it already
   * makes carries these fields. All optional: a provider that cannot see a
   * given field must leave it undefined rather than guess, since `false` and
   * "unknown" mean very different things to the transcript queue.
   */
  enrichment?: {
    /** Does the platform say a caption track exists? Undefined = unknown. */
    hasCaptions?: boolean;
    /** Full publication instant. `postedAt` keeps the date-only form. */
    postedAtTs?: string | null;
    /** Description or caption body — free corpus text. */
    description?: string | null;
    /** Platform-assigned topic labels, already reduced to bare names. */
    topicLabels?: string[];
  };
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
  | {
      ok: true;
      data: T;
      /**
       * How many rows the vendor actually billed for, when that can differ
       * from data.length -- e.g. Instagram discovery is billed per row the
       * actor returns, but rows that turn out to be photos are then dropped
       * client-side, so data.length alone would understate spend and the
       * budget refund would hand back credit that was never really unspent.
       * Omitted (falls back to data.length) for providers where the two
       * never diverge.
       */
      billedCount?: number;
    }
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
    isMetered: false,
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
