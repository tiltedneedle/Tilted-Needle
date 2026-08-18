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
 * Those arrive by client-supplied Studio export instead -- there is no connect
 * flow to fall back on (PRD-video-intelligence §0, §2). Public metrics can
 * show *that* a video performed; they cannot explain why.
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
 * Is this video a Short? true / false / null, where null means "the probe
 * could not tell".
 *
 * Over 180s cannot be one (YouTube's own ceiling), which is a definite `false`
 * needing no network call. At or under, the /shorts/ URL is authoritative: it
 * serves a Short directly (200) and redirects a normal video to /watch (3xx).
 *
 * THE TRI-STATE IS THE POINT. This used to return a plain boolean and report
 * "not a Short" when the probe threw, which was exactly right while there was
 * only one consumer: long-form discovery skips Shorts, so an error meant
 * "keep it", and no long-form work could ever be silently dropped.
 *
 * Inverting that same boolean for Shorts mode would invert the failure with
 * it -- a network blip would mean "not a Short", and the video would be
 * dropped from the only feed it belongs to. Silently. So the uncertainty is
 * now explicit and each caller decides what to do with it: long-form keeps an
 * unknown (unchanged behaviour), Shorts skips it. An unknown video therefore
 * lands in long-form and never in both, and because it is never written to
 * platform_posts under the Shorts account it stays "unseen" and gets another
 * chance on the next discovery run. Nothing is lost permanently.
 */
export async function classifyShort(
  externalId: string,
  lengthSeconds: number | null,
): Promise<boolean | null> {
  if (lengthSeconds != null && lengthSeconds > 180) return false;

  const memo = shortProbeCache.get(externalId);
  if (memo && Date.now() - memo.at < PROBE_TTL_MS) return memo.value;

  let value: boolean | null;
  try {
    const res = await fetch(`https://www.youtube.com/shorts/${externalId}`, {
      method: "HEAD",
      redirect: "manual",
    });
    // A 200 is a Short and a 3xx is a normal video. Anything else (429, 5xx,
    // a captcha wall) is not evidence either way and must not be read as one.
    value = res.status === 200 ? true : res.status >= 300 && res.status < 400 ? false : null;
  } catch {
    value = null;
  }
  rememberProbe(externalId, value);
  return value;
}

/**
 * Classify a whole discovery batch, concurrently and under a deadline.
 *
 * The loop this replaced awaited one probe at a time. A channel with no
 * sync_window_days asks for 200 playlist items with no date cutoff, and any
 * video at or under 180 seconds -- or with no duration recorded -- needs a
 * network probe, so a run could sit through ~200 sequential HEAD requests at
 * 1.3-2.2s each. That is 260-440 SECONDS in one provider call, against a
 * Vercel Hobby ceiling of 300 for the entire cron: the run was killed
 * mid-flight, and whichever accounts came later in the list never synced at
 * all. It got worse with every video a channel published.
 *
 * Two bounds, and the tri-state is what makes both safe:
 *
 *   CONCURRENCY turns the same work into ~1/8th the wall clock. Modest on
 *   purpose -- these are unauthenticated requests to youtube.com, and a burst
 *   of 50 is how an IP earns a 429, which this code correctly reads as "no
 *   evidence" but which still buys nothing.
 *
 *   A DEADLINE stops the batch spending the whole function. Past it, the rest
 *   classify as null WITHOUT a network call, which is exactly the state the
 *   tri-state was designed to carry: long-form keeps an unknown, so no
 *   long-form work is dropped, and Shorts skips it -- leaving the video
 *   unwritten, still "unseen", and picked up on the next run. Slower to
 *   converge, never wrong, and it always leaves time for the accounts queued
 *   behind this one.
 */
const PROBE_CONCURRENCY = 8;
const PROBE_BUDGET_MS = 45_000;

export async function classifyShorts(
  posts: { externalId: string; lengthSeconds: number | null }[],
  budgetMs = PROBE_BUDGET_MS,
  concurrency = PROBE_CONCURRENCY,
): Promise<Map<string, boolean | null>> {
  const out = new Map<string, boolean | null>();
  const deadline = Date.now() + budgetMs;
  let next = 0;

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= posts.length) return;
      const p = posts[i];
      // Past the budget, answer without asking. classifyShort would still
      // return the free `false` for anything over 180s, but the point here is
      // to stop making requests, and an unknown is safe for both callers.
      if (Date.now() > deadline && !(p.lengthSeconds != null && p.lengthSeconds > 180)) {
        out.set(p.externalId, null);
        continue;
      }
      out.set(p.externalId, await classifyShort(p.externalId, p.lengthSeconds));
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, posts.length)) }, worker),
  );
  return out;
}

/**
 * Kept because a client with BOTH a youtube and a youtube_shorts account
 * discovers the same channel twice in one sync run, and would otherwise probe
 * every candidate video twice. Short TTL and a hard cap: this is a
 * within-a-run memo, not a cache anyone should depend on.
 */
const PROBE_TTL_MS = 10 * 60 * 1000;
const PROBE_CACHE_MAX = 2000;
const shortProbeCache = new Map<string, { value: boolean | null; at: number }>();

function rememberProbe(externalId: string, value: boolean | null) {
  // A null is "we could not tell", so it must NOT be remembered -- caching it
  // would turn one transient failure into ten minutes of the same wrong
  // answer for that video.
  if (value === null) return;
  if (shortProbeCache.size >= PROBE_CACHE_MAX) shortProbeCache.clear();
  shortProbeCache.set(externalId, { value, at: Date.now() });
}

/**
 * Back-compat for callers that only ask "should long-form skip this".
 * Unknown reads as "not a Short", which is the fail-open behaviour long-form
 * discovery has always had and still wants.
 */
export async function isYoutubeShort(
  externalId: string,
  lengthSeconds: number | null,
): Promise<boolean> {
  return (await classifyShort(externalId, lengthSeconds)) === true;
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
  isMetered: false,
  reason:
    "Public video statistics are served to any API key, so no client authorisation is needed.",
  remedy:
    "Impressions, click-through rate and retention are owner-only. Ask the client for a YouTube Studio export and import it under Data.",
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
    // The call already asks for part=snippet, so the thumbnails have been
    // arriving in this response all along and were simply not declared --
    // no extra request and no extra quota to start reading them.
    snippet?: {
      title?: string;
      thumbnails?: { default?: { url?: string }; medium?: { url?: string } };
    };
  }[];
};
type VideosResponse = {
  items?: {
    id: string;
    snippet?: { title?: string; publishedAt?: string; description?: string };
    /** `caption` is the string "true"/"false", not a boolean. */
    contentDetails?: { duration?: string; caption?: string };
    /** Wikipedia URLs, e.g. ".../wiki/Lifestyle_(sociology)". */
    topicDetails?: { topicCategories?: string[] };
    statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  }[];
};

/**
 * YouTube reports topics as Wikipedia URLs. The last path segment is the
 * usable label; underscores become spaces and any parenthetical disambiguator
 * is dropped, so ".../wiki/Lifestyle_(sociology)" reads as "Lifestyle".
 */
function topicNames(urls: string[] | undefined): string[] {
  if (!urls?.length) return [];
  const names = urls
    .map((u) => u.split("/").pop() ?? "")
    .map((s) => decodeURIComponent(s).replace(/_\([^)]*\)$/, "").replace(/_/g, " ").trim())
    .filter(Boolean);
  return [...new Set(names)].sort();
}

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

/**
 * Resolves a handle or channel id to that channel's uploads playlist.
 *
 * Memoised because a client with BOTH a youtube and a youtube_shorts account
 * syncs the same channel twice in one run, and this is a quota call. Only
 * successes are remembered: caching a failure would turn one bad minute into
 * ten minutes of a channel appearing not to exist.
 */
const PLAYLIST_TTL_MS = 10 * 60 * 1000;
const playlistCache = new Map<string, { id: string; at: number }>();

async function uploadsPlaylist(handle: string): Promise<ProviderResult<string>> {
  const key = handle.trim().toLowerCase();
  const memo = playlistCache.get(key);
  if (memo && Date.now() - memo.at < PLAYLIST_TTL_MS) {
    return { ok: true, data: memo.id };
  }
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
  if (playlistCache.size >= 500) playlistCache.clear();
  playlistCache.set(key, { id: uploads, at: Date.now() });
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

  /**
   * Long-form only, by policy: the agency tracks proper YouTube videos, and
   * a Short slipping in would be scored against long-form baselines it has
   * nothing in common with. Detection is two-step: anything over 180s cannot
   * be a Short (YouTube's own ceiling), and for the rest the /shorts/ URL is
   * authoritative -- it serves a Short directly (200) but redirects a normal
   * video to /watch. On a network error the video is KEPT: silently dropping
   * long-form work is the worse failure, and a stray Short can be deleted by
   * hand from its video page.
   */
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
          // Already in the snippet this call paid for. `medium` is 320x180,
          // which is the smallest size that still looks right on a retina
          // tile; `default` (120x90) is the fallback, not the choice.
          thumbnailUrl:
            item.snippet?.thumbnails?.medium?.url ??
            item.snippet?.thumbnails?.default?.url ??
            null,
        });
      }

      pageToken = (page.data as { nextPageToken?: string }).nextPageToken;
      if (!pageToken) break;
    }

    // Durations for everything found (1 quota unit per 50 videos): the
    // Shorts filter needs them, and discovered rows gain real lengths as a
    // side effect instead of the null playlistItems leaves behind.
    //
    // The same call carries snippet and topicDetails at NO extra quota --
    // videos.list costs one unit however many parts it is asked for -- so
    // everything in DiscoveredPost.enrichment rides along for free. The
    // caption flag matters most: it is what stops the transcript queue from
    // ever spending a blockable request on a video that has no captions.
    for (let i = 0; i < found.length; i += 50) {
      const batch = found.slice(i, i + 50);
      const det = await call<VideosResponse>("videos", {
        part: "contentDetails,snippet,topicDetails",
        id: batch.map((p) => p.externalId).join(","),
      });
      if (det.ok) {
        const byId = new Map((det.data.items ?? []).map((v) => [v.id, v]));
        for (const p of batch) {
          const v = byId.get(p.externalId);
          p.lengthSeconds = v?.contentDetails?.duration
            ? parseIsoDuration(v.contentDetails.duration)
            : null;
          p.enrichment = {
            // The API returns the string "true"/"false", not a boolean.
            // Anything else (absent field, unexpected value) stays undefined
            // so it reads as "unknown" rather than "definitely none".
            hasCaptions:
              v?.contentDetails?.caption === "true"
                ? true
                : v?.contentDetails?.caption === "false"
                  ? false
                  : undefined,
            postedAtTs: v?.snippet?.publishedAt ?? null,
            description: v?.snippet?.description ?? null,
            topicLabels: topicNames(v?.topicDetails?.topicCategories),
          };
        }
      }
    }

    /* The two modes are exact complements, and the UNKNOWN case is what keeps
       them from overlapping or leaking.

         definitely a Short   -> Shorts feed only
         definitely not       -> long-form only
         could not tell       -> long-form only

       Long-form therefore behaves exactly as it always has (an unknown is
       kept, so no long-form work is ever silently dropped), and a video can
       never land in both. An unknown that really was a Short is missed for
       this run only: it is never written under the Shorts account, so it is
       still "unseen" next time and gets another chance. */
    const wantShorts = options.shortsOnly === true;
    const verdicts = await classifyShorts(found);
    const out: DiscoveredPost[] = [];
    for (const p of found) {
      const isShort = verdicts.get(p.externalId) ?? null;
      if (wantShorts ? isShort === true : isShort !== true) out.push(p);
    }
    return { ok: true, data: out };
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
