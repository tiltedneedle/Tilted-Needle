/**
 * Instagram metrics via Apify's official actor (apify/instagram-scraper).
 *
 * Instagram is the one platform here that costs money to read. Every other
 * provider is free; this one bills per post returned, which is why it is the
 * only one wired into the budget ledger (see 20260729140000_scrape_budget).
 *
 * The actor is billed PER RESULT, not per call. That single fact shapes the
 * whole design: asking for a profile returns -- and charges for -- every
 * recent post, so refreshes address specific post URLs and pay only for the
 * posts actually due. Profile scraping is reserved for discovery, where
 * returning the whole recent page is the point.
 *
 * Two failure modes worth knowing, both reported widely by Apify users:
 * the actor can return an empty set after an Instagram change, and the
 * shared proxy pool sometimes draws an IP Instagram has already flagged. In
 * both cases the run "succeeds" and yields nothing. That is why an empty
 * result here is treated as an error to surface rather than as "this post
 * has no metrics" -- the latter would quietly overwrite real numbers with
 * silence.
 */
import type {
  AccountCandidate,
  DiscoverOptions,
  DiscoveredPost,
  ProviderCapability,
  ProviderResult,
  PublicMetrics,
  PublicProvider,
} from "./types.ts";

const API = "https://api.apify.com/v2";

/** Overridable so a cheaper actor can be swapped in without a code change. */
function actorId(): string {
  return process.env.APIFY_INSTAGRAM_ACTOR ?? "apify~instagram-scraper";
}

const capability: ProviderCapability = {
  canDiscover: true,
  canFetchMetrics: true,
  reason:
    "Read through Apify's official Instagram actor. Metered: each post returned costs credit, so refreshes are scheduled by post age and capped by a monthly budget.",
  remedy:
    "Connect the account with OAuth to additionally unlock reach, impressions and saves, which no public source exposes.",
};

/** One post as the actor reports it. Field names follow its output schema. */
type ApifyPost = {
  id?: string;
  shortCode?: string;
  url?: string;
  caption?: string;
  timestamp?: string;
  likesCount?: number;
  commentsCount?: number;
  videoViewCount?: number;
  videoPlayCount?: number;
  videoDuration?: number;
  ownerUsername?: string;
  type?: string;
  error?: string;
};

/**
 * Instagram lets an account hide its like count, and the actor reports that
 * as -1. It must become null, never 0: a zero reads as "nobody liked this"
 * and would drag every score derived from it downward, silently.
 */
function count(v: number | undefined): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  return v;
}

/** Posts carry a caption, not a title. First line, trimmed, is the closest thing. */
function titleFrom(caption: string | undefined): string {
  const first = (caption ?? "").split("\n").find((l) => l.trim().length > 0);
  if (!first) return "Untitled";
  const t = first.trim();
  return t.length > 120 ? `${t.slice(0, 117)}…` : t;
}

async function runActor(
  input: Record<string, unknown>,
  timeoutMs = 120_000,
): Promise<ProviderResult<ApifyPost[]>> {
  const token = process.env.APIFY_TOKEN;
  if (!token) return { ok: false, error: "APIFY_TOKEN is not set." };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // run-sync-get-dataset-items runs the actor and returns its rows in one
    // call, which avoids polling a run id and keeps the sync loop simple.
    const res = await fetch(
      `${API}/acts/${actorId()}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: controller.signal,
        cache: "no-store",
      },
    );

    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "Apify rejected the token. Check APIFY_TOKEN." };
    }
    if (res.status === 402) {
      // The free plan blocks rather than bills, so this is the ceiling being
      // hit. Named precisely because the remedy is "wait for the reset", not
      // "fix the configuration".
      return {
        ok: false,
        error: "Apify monthly credit exhausted — Instagram syncing pauses until the plan resets.",
      };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Apify returned HTTP ${res.status}. ${body.slice(0, 160)}` };
    }

    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows)) {
      return { ok: false, error: "Apify returned an unexpected response shape." };
    }
    return { ok: true, data: rows as ApifyPost[] };
  } catch (e) {
    const err = e as Error;
    if (err.name === "AbortError") {
      return { ok: false, error: `Apify run exceeded ${Math.round(timeoutMs / 1000)}s and was abandoned.` };
    }
    return { ok: false, error: `Could not reach Apify: ${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

/** Accepts a handle, an @handle, or any instagram.com profile URL. */
export function parseHandle(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const fromUrl = raw.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  const candidate = fromUrl ? fromUrl[1] : raw.replace(/^@/, "").split(/[/?#]/)[0];
  if (!candidate || /^(p|reel|reels|stories|explore)$/i.test(candidate)) return null;
  return /^[A-Za-z0-9._]{1,30}$/.test(candidate) ? candidate : null;
}

/** Pulls the shortcode out of a post/reel URL, which is the id we store. */
export function parseShortcode(input: string): string | null {
  const m = input.trim().match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{5,20}$/.test(input.trim()) ? input.trim() : null;
}

function toDiscovered(p: ApifyPost): DiscoveredPost | null {
  const code = p.shortCode ?? (p.url ? parseShortcode(p.url) : null);
  if (!code) return null;
  return {
    externalId: code,
    title: titleFrom(p.caption),
    url: p.url ?? `https://www.instagram.com/p/${code}/`,
    postedAt: p.timestamp ? p.timestamp.slice(0, 10) : null,
    lengthSeconds:
      typeof p.videoDuration === "number" ? Math.round(p.videoDuration) : null,
  };
}

export const instagramProvider: PublicProvider = {
  slug: "instagram",
  capability,

  isConfigured: () => Boolean(process.env.APIFY_TOKEN),
  missingEnv: () => (process.env.APIFY_TOKEN ? [] : ["APIFY_TOKEN"]),

  /**
   * Verification only: one post is fetched purely to prove the handle exists
   * and to read back its owner. Deliberately the smallest possible spend --
   * a search that returned a full page would cost a page of credit every
   * time somebody typed.
   */
  async search(query) {
    const handle = parseHandle(query);
    if (!handle) return { ok: true, data: [] };

    const res = await runActor({
      directUrls: [`https://www.instagram.com/${handle}/`],
      resultsType: "posts",
      resultsLimit: 1,
      addParentData: false,
    });
    if (!res.ok) return res;
    if (res.data.length === 0) {
      // Either no such account, or private, or the actor was blocked. They
      // are indistinguishable from here, so the message says so rather than
      // asserting the account does not exist.
      return { ok: true, data: [] };
    }

    const owner = res.data[0].ownerUsername ?? handle;
    return {
      ok: true,
      data: [
        {
          externalId: owner,
          title: owner,
          handle: owner,
          description: "",
          thumbnailUrl: null,
          subscriberCount: null,
          videoCount: null,
          url: `https://www.instagram.com/${owner}/`,
          exact: true,
        } satisfies AccountCandidate,
      ],
    };
  },

  /**
   * Recent posts for an account. `limit` is a hard cost ceiling, not a hint:
   * every row returned is billed, so the caller must have claimed budget for
   * exactly this many before calling.
   */
  async discover(handle, options: DiscoverOptions = {}) {
    const user = parseHandle(handle);
    if (!user) return { ok: false, error: `"${handle}" is not a valid Instagram handle.` };

    const limit = Math.max(1, Math.min(options.limit ?? 12, 100));
    const res = await runActor({
      directUrls: [`https://www.instagram.com/${user}/`],
      resultsType: "posts",
      resultsLimit: limit,
      addParentData: false,
    });
    if (!res.ok) return res;

    let posts = res.data
      .map(toDiscovered)
      .filter((p): p is DiscoveredPost => p !== null);

    if (options.since) {
      posts = posts.filter((p) => p.postedAt != null && p.postedAt >= options.since!);
    }
    return { ok: true, data: posts };
  },

  /**
   * Metrics for specific posts, addressed by shortcode. One result per post,
   * so cost is exactly the number of ids passed in.
   */
  async fetchMetrics(externalIds) {
    if (externalIds.length === 0) return { ok: true, data: [] };

    const urls = externalIds.map((id) => `https://www.instagram.com/p/${id}/`);
    const res = await runActor({
      directUrls: urls,
      resultsType: "posts",
      resultsLimit: externalIds.length,
      addParentData: false,
    });
    if (!res.ok) return res;

    // An empty set for posts we know exist means the actor was blocked or
    // Instagram changed under it. Reporting that as "no metrics" would let
    // the sync record silence as though it were data.
    if (res.data.length === 0) {
      return {
        ok: false,
        error:
          "Apify returned no rows for posts that should exist — the actor is likely blocked or needs an update.",
      };
    }

    const out: PublicMetrics[] = [];
    for (const p of res.data) {
      if (p.error) continue; // per-row failures are omitted, never zeroed
      const code = p.shortCode ?? (p.url ? parseShortcode(p.url) : null);
      if (!code) continue;
      out.push({
        externalId: code,
        // Photo posts have no play count at all; video/reel posts report one
        // under either key depending on the actor version.
        views: count(p.videoPlayCount) ?? count(p.videoViewCount),
        likes: count(p.likesCount),
        comments: count(p.commentsCount),
      });
    }
    return { ok: true, data: out };
  },
};
