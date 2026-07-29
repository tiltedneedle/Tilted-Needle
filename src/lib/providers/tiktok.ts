/**
 * TikTok public metrics, with no client authorisation and no API key.
 *
 * Two endpoints, both public and both verified working:
 *
 *   oEmbed   https://www.tiktok.com/oembed?url=...
 *            TikTok's documented embed endpoint. Works on a profile URL or a
 *            video URL and returns the author's name, so it can confirm an
 *            account exists before it is saved, and confirm which creator a
 *            given video actually belongs to.
 *
 *   Embed    https://www.tiktok.com/embed/v2/<videoId>
 *            The page TikTok serves for embedding a video. Its state blob
 *            carries playCount, diggCount, commentCount and shareCount.
 *
 * IMPORTANT LIMITATION: creator profile pages are blocked -- a request for
 * one returns a ~1.4KB shell with no video ids in it. So unlike YouTube,
 * this provider CANNOT list a creator's uploads. Videos have to be registered
 * by URL once; after that their metrics refresh automatically forever.
 * `capability.canDiscover` is false to say exactly that, rather than having
 * discovery fail mysteriously at run time.
 *
 * A caveat worth keeping in view: the embed page is a public surface but not
 * a documented *data* API. TikTok can change its markup without notice, and
 * automated fetching of it sits in a grey area of their terms. It is treated
 * here as a convenience that saves real work, never as infrastructure to
 * depend on -- which is why parse failures surface loudly on the Accounts
 * page instead of quietly recording nothing, and why manual entry stays
 * available for every platform.
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

/** A browser UA: the embed page serves a different shell to unknown clients. */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const capability: ProviderCapability = {
  canDiscover: false,
  canFetchMetrics: true,
  reason:
    "TikTok blocks creator profile pages, so a creator's videos cannot be listed automatically. Individual videos are read fine once their URL is registered.",
  remedy:
    "Add each video's URL once — its metrics then refresh automatically with every sync.",
};

/**
 * Pulls the numeric video id out of anything someone would paste: a full URL,
 * a short vm./vt. link, or the bare id.
 *
 * Short links are NOT resolved here -- they are redirects, and following them
 * is a network call the caller may not expect. They are rejected with a clear
 * message instead, because silently returning null would read as "invalid
 * video" for a link that is perfectly valid.
 */
export function parseVideoId(
  input: string,
): { ok: true; id: string } | { ok: false; error: string } {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Enter a TikTok video URL." };

  if (/^\d{15,25}$/.test(raw)) return { ok: true, id: raw };

  const full = raw.match(/tiktok\.com\/@[\w.\-]+\/(?:video|photo)\/(\d{15,25})/i);
  if (full) return { ok: true, id: full[1] };

  const embed = raw.match(/tiktok\.com\/embed\/v2\/(\d{15,25})/i);
  if (embed) return { ok: true, id: embed[1] };

  if (/(?:vm|vt)\.tiktok\.com\//i.test(raw)) {
    return {
      ok: false,
      error:
        "Short vm./vt. links cannot be read directly. Open the link and paste the full tiktok.com/@user/video/... URL.",
    };
  }

  return { ok: false, error: "That does not look like a TikTok video URL." };
}

/** Normalises a handle or profile URL to a bare handle. */
export function parseHandle(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const fromUrl = raw.match(/tiktok\.com\/@([\w.\-]+)/i);
  if (fromUrl) return fromUrl[1];
  const bare = raw.replace(/^@/, "").split(/[/?#]/)[0];
  return /^[\w.\-]{1,30}$/.test(bare) ? bare : null;
}

type OEmbed = {
  title?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
};

async function oembed(url: string): Promise<ProviderResult<OEmbed>> {
  let res: Response;
  try {
    res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, {
      headers: { "User-Agent": UA },
      cache: "no-store",
    });
  } catch (e) {
    return { ok: false, error: `Could not reach TikTok: ${(e as Error).message}` };
  }
  if (res.status === 404) return { ok: false, error: "TikTok has no such account or video." };
  if (!res.ok) return { ok: false, error: `TikTok returned HTTP ${res.status}.` };
  try {
    return { ok: true, data: (await res.json()) as OEmbed };
  } catch {
    return { ok: false, error: "TikTok returned a response that could not be read." };
  }
}

type ItemInfos = {
  id?: string;
  playCount?: number;
  diggCount?: number;
  commentCount?: number;
  shareCount?: number;
};

/**
 * Reads one video's stats out of the embed page.
 *
 * The state blob is keyed by the embed path, so the lookup is by exact video
 * id rather than by scanning for the first `playCount` in the document. That
 * matters: the page carries several stat blocks belonging to different videos,
 * and taking the first match would silently record another video's numbers.
 */
function extractStats(html: string, videoId: string): ItemInfos | null {
  const m = html.match(
    /<script id="__FRONTITY_CONNECT_STATE__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!m) return null;

  let state: unknown;
  try {
    state = JSON.parse(m[1]);
  } catch {
    return null;
  }

  const data = (state as { source?: { data?: Record<string, unknown> } })?.source?.data;
  const entry = data?.[`/embed/v2/${videoId}`] as
    | { videoData?: { itemInfos?: ItemInfos } }
    | undefined;
  const infos = entry?.videoData?.itemInfos;
  if (!infos) return null;

  // Guard against the shape shifting under us and handing back a neighbour's
  // numbers: the block must identify itself as the video we asked for.
  if (infos.id && infos.id !== videoId) return null;
  return infos;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export const tiktokProvider: PublicProvider = {
  slug: "tiktok",
  capability,

  // No key to configure: both endpoints are open.
  isConfigured: () => true,
  missingEnv: () => [],

  async search(query) {
    const handle = parseHandle(query);
    if (!handle) return { ok: true, data: [] };

    const res = await oembed(`https://www.tiktok.com/@${handle}`);
    if (!res.ok) {
      // "No such account" is a legitimate empty result while someone is still
      // typing, not an error worth interrupting them with.
      if (res.error.includes("no such account")) return { ok: true, data: [] };
      return res;
    }

    const candidate: AccountCandidate = {
      externalId: handle,
      title: res.data.author_name ?? handle,
      handle,
      description: "",
      thumbnailUrl: res.data.thumbnail_url ?? null,
      // TikTok's oEmbed exposes no follower or video counts. Null keeps that
      // honest rather than rendering a fabricated zero.
      subscriberCount: null,
      videoCount: null,
      url: res.data.author_url ?? `https://www.tiktok.com/@${handle}`,
      exact: true,
    };
    return { ok: true, data: [candidate] };
  },

  async discover(_handle: string, _options: DiscoverOptions = {}) {
    return { ok: false, error: capability.reason };
  },

  async fetchMetrics(externalIds) {
    if (externalIds.length === 0) return { ok: true, data: [] };

    const out: PublicMetrics[] = [];
    const failures: string[] = [];

    // Sequential with a small gap. There is no batch endpoint, and hammering
    // a public page in parallel is both rude and the fastest way to get
    // rate-limited off it.
    for (const id of externalIds) {
      try {
        const res = await fetch(`https://www.tiktok.com/embed/v2/${id}`, {
          headers: { "User-Agent": UA },
          cache: "no-store",
        });

        if (res.status === 400 || res.status === 404) {
          // The video is gone or private. Recording zeros here would read as
          // "nobody watched it" and drag every derived score down, so it is
          // simply omitted -- absent, not zero.
          failures.push(`${id}: no longer available`);
          continue;
        }
        if (!res.ok) {
          failures.push(`${id}: HTTP ${res.status}`);
          continue;
        }

        const stats = extractStats(await res.text(), id);
        if (!stats) {
          failures.push(`${id}: could not read stats from the embed page`);
          continue;
        }

        out.push({
          externalId: id,
          views: num(stats.playCount),
          likes: num(stats.diggCount),
          comments: num(stats.commentCount),
        });
      } catch (e) {
        failures.push(`${id}: ${(e as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 350));
    }

    // Every single video failing means the page shape changed or TikTok is
    // blocking us -- an error worth surfacing. A few failing among many is
    // just deleted videos, which is normal and must not fail the whole run.
    if (out.length === 0 && failures.length > 0) {
      return {
        ok: false,
        error: `No TikTok metrics could be read. ${failures.slice(0, 3).join("; ")}`,
      };
    }
    return { ok: true, data: out };
  },
};

/** Confirms a video exists and reports which creator it belongs to. */
export async function verifyVideo(
  url: string,
): Promise<ProviderResult<DiscoveredPost & { authorHandle: string | null }>> {
  const parsed = parseVideoId(url);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const canonical = `https://www.tiktok.com/@placeholder/video/${parsed.id}`;
  const res = await oembed(url.includes("tiktok.com/@") ? url : canonical);
  if (!res.ok) return res;

  return {
    ok: true,
    data: {
      externalId: parsed.id,
      title: res.data.title?.trim() || "Untitled",
      url: `https://www.tiktok.com/video/${parsed.id}`,
      postedAt: null, // oEmbed does not report a publish date
      lengthSeconds: null,
      authorHandle: res.data.author_url
        ? (parseHandle(res.data.author_url) ?? null)
        : null,
    },
  };
}
