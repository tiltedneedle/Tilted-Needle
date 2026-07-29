/**
 * YouTube public metrics, via Data API v3 and OUR OWN developer key.
 *
 * This is the one platform in the registry that can be read without the
 * client authorising anything: public videos expose viewCount, likeCount and
 * commentCount to any API key. The client never sees a consent screen, never
 * hands over credentials, and does not have to be involved at all.
 *
 * What this still cannot see, because YouTube reserves it for the channel
 * owner: impressions, click-through rate, watch time, retention, demographics.
 * Those need the OAuth connector in lib/connectors.ts. Public metrics can show
 * *that* a video performed; they cannot explain why (PRD 4).
 *
 * Quota: the free tier allows 10,000 units/day. Every call used here costs 1
 * unit and accepts up to 50 ids, so a few hundred videos refreshed every
 * fifteen minutes uses a small fraction of it. Polling faster than that buys
 * nothing -- YouTube's own public counts lag by minutes to hours regardless.
 */
// Relative imports carry an explicit .ts extension because the test suite
// loads these through Node's native ESM resolver, which -- unlike the Next
// bundler -- will not infer it.
import type {
  AccountCandidate,
  DiscoverOptions,
  DiscoveredPost,
  ProviderCapability,
  ProviderResult,
  PublicMetrics,
  PublicProvider,
} from "./types.ts";

const API = "https://www.googleapis.com/youtube/v3";

/**
 * Accepts what someone would realistically paste into the handle field: a
 * bare handle, an @handle, a UC… channel id, or a full URL of either shape.
 * Guessing wrong here is invisible until a sync silently returns nothing, so
 * the parse is explicit about which of the two lookup keys it produced.
 */
export function parseChannelRef(
  handle: string,
): { kind: "id"; value: string } | { kind: "handle"; value: string } | null {
  const raw = handle.trim();
  if (!raw) return null;

  // Full URL in any of YouTube's several shapes.
  const url = raw.match(/^https?:\/\/(?:www\.)?youtube\.com\/(.+)$/i);
  const path = url ? url[1] : raw;

  const byChannelId = path.match(/^channel\/(UC[\w-]{20,})/i);
  if (byChannelId) return { kind: "id", value: byChannelId[1] };

  const byAtHandle = path.match(/^@([\w.\-]+)/);
  if (byAtHandle) return { kind: "handle", value: byAtHandle[1] };

  // A bare UC… id, which is not a handle even though it has no prefix.
  if (/^UC[\w-]{20,}$/.test(path)) return { kind: "id", value: path };

  // /c/Name and /user/Name are legacy custom URLs. They are not resolvable
  // by any documented parameter, so they are rejected rather than guessed at.
  if (/^(c|user)\//i.test(path)) return null;

  const bare = path.replace(/^\/+/, "").split(/[/?#]/)[0];
  if (!bare) return null;
  return { kind: "handle", value: bare.replace(/^@/, "") };
}

/** "PT1M30S" -> 90. YouTube reports durations as ISO 8601 periods. */
export function parseIsoDuration(iso: string): number | null {
  const m = iso.match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!m) return null;
  const [, d, h, min, s] = m;
  const total =
    Number(d ?? 0) * 86400 +
    Number(h ?? 0) * 3600 +
    Number(min ?? 0) * 60 +
    Number(s ?? 0);
  return Math.round(total);
}

/**
 * Counts arrive as strings, and are absent entirely when a channel has hidden
 * them. Absent must stay null: a 0 would read as "nobody watched this" and
 * would drag every score computed from it downward (PRD 5).
 */
function count(v: string | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const capability: ProviderCapability = {
  canDiscover: true,
  canFetchMetrics: true,
  reason:
    "Public video statistics are served to any API key, so no client authorisation is needed.",
  remedy:
    "Connect the channel with OAuth to additionally unlock impressions, click-through rate and retention.",
};

async function call<T>(
  path: string,
  params: Record<string, string>,
): Promise<ProviderResult<T>> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return { ok: false, error: "YOUTUBE_API_KEY is not set." };

  const qs = new URLSearchParams({ ...params, key });
  let res: Response;
  try {
    res = await fetch(`${API}/${path}?${qs}`, {
      // These reads back a time series; a cached response would record a
      // snapshot that never happened.
      cache: "no-store",
    });
  } catch (e) {
    return { ok: false, error: `Network error reaching YouTube: ${(e as Error).message}` };
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: { message?: string; errors?: { reason?: string }[] } }
      | null;
    const reason = body?.error?.errors?.[0]?.reason;
    const message = body?.error?.message ?? `HTTP ${res.status}`;
    // Quota exhaustion is the one failure worth naming precisely: it is
    // temporary, it is not a misconfiguration, and it resolves at midnight
    // Pacific without anyone touching anything.
    if (reason === "quotaExceeded")
      return { ok: false, error: "YouTube API daily quota exhausted; it resets at midnight PT." };
    if (res.status === 403)
      return { ok: false, error: `YouTube rejected the API key: ${message}` };
    return { ok: false, error: `YouTube API error: ${message}` };
  }

  return { ok: true, data: (await res.json()) as T };
}

type ChannelsResponse = {
  items?: {
    id: string;
    contentDetails?: { relatedPlaylists?: { uploads?: string } };
    snippet?: {
      title?: string;
      description?: string;
      customUrl?: string;
      thumbnails?: { default?: { url?: string }; medium?: { url?: string } };
    };
    statistics?: { subscriberCount?: string; videoCount?: string; hiddenSubscriberCount?: boolean };
  }[];
};
type SearchResponse = {
  items?: { id?: { channelId?: string } }[];
};
type PlaylistItemsResponse = {
  items?: {
    contentDetails?: { videoId?: string; videoPublishedAt?: string };
    snippet?: { title?: string };
  }[];
};
type VideosResponse = {
  items?: {
    id: string;
    snippet?: { title?: string; publishedAt?: string };
    contentDetails?: { duration?: string };
    statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  }[];
};

/** Turns channels.list items into candidates the picker can render. */
function toCandidates(
  items: NonNullable<ChannelsResponse["items"]>,
  exact: boolean,
): AccountCandidate[] {
  return items.map((c) => ({
    externalId: c.id,
    title: c.snippet?.title ?? "Untitled channel",
    handle: c.snippet?.customUrl ? c.snippet.customUrl.replace(/^@/, "") : null,
    description: (c.snippet?.description ?? "").slice(0, 160),
    thumbnailUrl: c.snippet?.thumbnails?.medium?.url ?? c.snippet?.thumbnails?.default?.url ?? null,
    // A channel can hide its subscriber count; null says "hidden", which is
    // not the same as zero and must not be rendered as it.
    subscriberCount: c.statistics?.hiddenSubscriberCount
      ? null
      : count(c.statistics?.subscriberCount),
    videoCount: count(c.statistics?.videoCount),
    url: c.snippet?.customUrl
      ? `https://www.youtube.com/${c.snippet.customUrl}`
      : `https://www.youtube.com/channel/${c.id}`,
    exact,
  }));
}

/** Resolves a handle or channel id to that channel's uploads playlist. */
async function uploadsPlaylist(handle: string): Promise<ProviderResult<string>> {
  const ref = parseChannelRef(handle);
  if (!ref) {
    return {
      ok: false,
      error:
        "Could not read a channel from this handle. Use @handle or a UC… channel ID — legacy /c/ and /user/ URLs cannot be resolved.",
    };
  }

  const res = await call<ChannelsResponse>("channels", {
    part: "contentDetails",
    ...(ref.kind === "id" ? { id: ref.value } : { forHandle: `@${ref.value}` }),
  });
  if (!res.ok) return res;

  const uploads = res.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) {
    return {
      ok: false,
      error: `No public channel found for "${handle}".`,
    };
  }
  return { ok: true, data: uploads };
}

export const youtubeProvider: PublicProvider = {
  slug: "youtube",
  capability,

  isConfigured: () => Boolean(process.env.YOUTUBE_API_KEY),
  missingEnv: () => (process.env.YOUTUBE_API_KEY ? [] : ["YOUTUBE_API_KEY"]),

  /**
   * Two-stage on purpose, because the two lookups differ in cost by 100x.
   *
   * An exact reference (@handle, UC… id, or a channel URL) resolves through
   * channels.list for 1 quota unit. Only free text falls through to
   * search.list, which costs 100 units -- at 10,000 units/day that is 100
   * free-text searches, so spending one on input we could have resolved
   * exactly would be careless. Typing a handle stays effectively free.
   */
  async search(query) {
    const trimmed = query.trim();
    if (trimmed.length < 2) return { ok: true, data: [] };

    const ref = parseChannelRef(trimmed);
    if (ref) {
      const exactRes = await call<ChannelsResponse>("channels", {
        part: "snippet,statistics",
        ...(ref.kind === "id" ? { id: ref.value } : { forHandle: `@${ref.value}` }),
      });
      if (!exactRes.ok) return exactRes;
      const items = exactRes.data.items ?? [];
      if (items.length > 0) return { ok: true, data: toCandidates(items, true) };
      // An exact-looking reference that matched nothing still falls through:
      // people type a channel's display name that happens to look like a
      // handle, and a "not found" there would be unhelpfully literal.
    }

    const hits = await call<SearchResponse>("search", {
      part: "snippet",
      type: "channel",
      q: trimmed,
      maxResults: "5",
    });
    if (!hits.ok) return hits;

    const ids = (hits.data.items ?? [])
      .map((i) => i.id?.channelId)
      .filter((id): id is string => !!id);
    if (ids.length === 0) return { ok: true, data: [] };

    // search.list's own snippet omits statistics, so one more 1-unit call
    // fetches the subscriber and video counts that make the list decidable.
    const detail = await call<ChannelsResponse>("channels", {
      part: "snippet,statistics",
      id: ids.join(","),
    });
    if (!detail.ok) return detail;

    return { ok: true, data: toCandidates(detail.data.items ?? [], false) };
  },

  async discover(handle, options: DiscoverOptions = {}) {
    const limit = options.limit ?? 50;
    const since = options.since ?? null;

    const playlist = await uploadsPlaylist(handle);
    if (!playlist.ok) return playlist;

    const found: DiscoveredPost[] = [];
    let pageToken: string | undefined;
    let reachedCutoff = false;

    // Paged, but bounded twice over: by count, and by publish date. The
    // uploads playlist comes back newest-first, so once a video predates the
    // window every later one does too and paging can stop -- which is the
    // difference between one API call and walking a decade of back catalogue.
    while (found.length < limit && !reachedCutoff) {
      const page: ProviderResult<PlaylistItemsResponse> = await call<PlaylistItemsResponse>(
        "playlistItems",
        {
          part: "snippet,contentDetails",
          playlistId: playlist.data,
          maxResults: String(Math.min(50, limit - found.length)),
          ...(pageToken ? { pageToken } : {}),
        },
      );
      if (!page.ok) return page;

      for (const item of page.data.items ?? []) {
        const id = item.contentDetails?.videoId;
        if (!id) continue;
        const postedAt = item.contentDetails?.videoPublishedAt?.slice(0, 10) ?? null;

        if (since && postedAt && postedAt < since) {
          reachedCutoff = true;
          break;
        }

        found.push({
          externalId: id,
          title: item.snippet?.title ?? "Untitled",
          url: `https://www.youtube.com/watch?v=${id}`,
          postedAt,
          lengthSeconds: null, // playlistItems does not carry duration
        });
      }

      pageToken = (page.data as { nextPageToken?: string }).nextPageToken;
      if (!pageToken) break;
    }

    return { ok: true, data: found };
  },

  async fetchMetrics(externalIds) {
    if (externalIds.length === 0) return { ok: true, data: [] };

    const out: PublicMetrics[] = [];
    // videos.list accepts 50 ids per call and costs the same 1 unit whether
    // asked for one or fifty, so batching is the difference between 1 unit
    // and 50 for the same data.
    for (let i = 0; i < externalIds.length; i += 50) {
      const batch = externalIds.slice(i, i + 50);
      const res = await call<VideosResponse>("videos", {
        part: "statistics",
        id: batch.join(","),
      });
      if (!res.ok) return res;

      for (const v of res.data.items ?? []) {
        out.push({
          externalId: v.id,
          views: count(v.statistics?.viewCount),
          likes: count(v.statistics?.likeCount),
          comments: count(v.statistics?.commentCount),
        });
      }
      // Ids that came back with no item are deleted or went private. They are
      // simply absent from the result; the caller must not read that as zero.
    }

    return { ok: true, data: out };
  },
};

/** Titles and durations for specific videos, used when adopting a post. */
export async function fetchVideoDetails(
  externalIds: string[],
): Promise<ProviderResult<DiscoveredPost[]>> {
  if (externalIds.length === 0) return { ok: true, data: [] };
  const out: DiscoveredPost[] = [];

  for (let i = 0; i < externalIds.length; i += 50) {
    const batch = externalIds.slice(i, i + 50);
    const res = await call<VideosResponse>("videos", {
      part: "snippet,contentDetails",
      id: batch.join(","),
    });
    if (!res.ok) return res;

    for (const v of res.data.items ?? []) {
      out.push({
        externalId: v.id,
        title: v.snippet?.title ?? "Untitled",
        url: `https://www.youtube.com/watch?v=${v.id}`,
        postedAt: v.snippet?.publishedAt?.slice(0, 10) ?? null,
        lengthSeconds: v.contentDetails?.duration
          ? parseIsoDuration(v.contentDetails.duration)
          : null,
      });
    }
  }
  return { ok: true, data: out };
}
