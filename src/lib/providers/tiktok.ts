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
 * Both of the above are free and need no setup -- this is why metrics-refresh
 * for a video whose URL is already known always works.
 *
 * DISCOVERY (listing a creator's uploads) is a separate story: creator
 * profile pages are blocked -- a request for one returns a ~1.4KB shell with
 * no video ids in it. There is no free, in-process way to list them. The
 * optional fix is deploy/tiktok-discover: a tiny standalone service (yt-dlp,
 * which TikTok does not block) that this provider calls over HTTPS when
 * TIKTOK_DISCOVER_URL and TIKTOK_DISCOVER_SECRET are set. Without them,
 * capability.canDiscover reports false -- honestly, not as an error -- and
 * videos are registered by URL once, same as always.
 *
 * A caveat worth keeping in view for both paths: neither the embed page nor
 * yt-dlp's extractor is a documented, contractual data API. TikTok can change
 * either surface without notice. Treated here as a convenience that saves
 * real work, never as infrastructure to depend on -- which is why failures
 * surface loudly on the Accounts page instead of quietly recording nothing,
 * and why manual entry stays available for every platform regardless.
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

/** Both must be set for the optional self-hosted discovery service. */
function discoveryConfigured(): boolean {
  return Boolean(process.env.TIKTOK_DISCOVER_URL && process.env.TIKTOK_DISCOVER_SECRET);
}

/** Its own token, falling back to the shared one if only that is set. */
function apifyToken(): string | undefined {
  return process.env.APIFY_TIKTOK_TOKEN || process.env.APIFY_TOKEN || undefined;
}

/** Overridable so a cheaper actor can be swapped in without a code change. */
function apifyActor(): string {
  return process.env.APIFY_TIKTOK_ACTOR ?? "clockworks~tiktok-scraper";
}

function apifyConfigured(): boolean {
  return Boolean(apifyToken());
}

function capabilityFor(): ProviderCapability {
  // The self-hosted service is free, so it wins when it is actually
  // configured. Apify is the route that works from a serverless deployment
  // with nothing else running -- which is the case in production.
  if (discoveryConfigured()) {
    return {
      canDiscover: true,
      canFetchMetrics: true,
      isMetered: false,
      reason: "Discovery runs through a separate self-hosted service (yt-dlp) — see deploy/tiktok-discover.",
      remedy: "",
    };
  }
  if (apifyConfigured()) {
    return {
      canDiscover: true,
      canFetchMetrics: true,
      // Refreshing a KNOWN TikTok post stays free forever -- that is the whole
      // shape of this integration. Only finding a new one costs.
      isMetered: false,
      discoveryMetered: true,
      // True only when the fallback in apifyToken() is what supplied the
      // token, i.e. TikTok is spending the shared account's credit.
      discoverySharedToken: !process.env.APIFY_TIKTOK_TOKEN,
      reason:
        "New videos are found through Apify, which bills per row returned — so discovery is deliberately infrequent and capped. Reading a known video's numbers afterwards is free and unlimited.",
      remedy: "",
    };
  }
  return {
    canDiscover: false,
    canFetchMetrics: true,
    isMetered: false,
    reason:
      "TikTok blocks creator profile pages, so a creator's videos cannot be listed automatically without a discovery route.",
    remedy:
      "Set APIFY_TIKTOK_TOKEN to find new videos automatically, or add each video's URL once — its metrics then refresh free with every sync.",
  };
}

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

/**
 * The exact publish instant, decoded from the video id.
 *
 * TikTok ids are snowflake-encoded: the upper 32 bits are the creation time in
 * Unix seconds. No network call, no extractor, no dependency -- the id we
 * already hold IS the timestamp.
 *
 * This lives in the provider rather than only in a backfill script because
 * TikTok is otherwise the one platform whose new posts arrive with a DATE and
 * nothing more. `posted_at` is a date column, so the hour is destroyed on
 * write and cannot be recovered afterwards: a post missed here is missed
 * permanently.
 *
 * Validated before being trusted -- across the whole live library all 78
 * decodes agreed with the date discovery had independently recorded, and none
 * disagreed. Returns null rather than a guess when the id is not a plausible
 * snowflake or the result is not a believable instant.
 */
export function postedAtTsFrom(externalId: string | null | undefined): string | null {
  if (!externalId || !/^\d{15,25}$/.test(externalId)) return null;
  // BigInt(32) rather than a 32n literal: the compile target predates
  // BigInt literals, and this has to build, not just run.
  const seconds = Number(BigInt(externalId) >> BigInt(32));
  // TikTok launched long after 2014, so an earlier result means the shift
  // produced garbage rather than a date. A future instant is equally impossible.
  if (seconds < 1_400_000_000 || seconds > Math.floor(Date.now() / 1000) + 86_400) {
    return null;
  }
  return new Date(seconds * 1000).toISOString();
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
  get capability() {
    return capabilityFor();
  },

  // Metrics and search need no configuration; only discovery is optional, so
  // isConfigured() stays true unconditionally -- gating it on the discovery
  // service would incorrectly disable the always-free metrics refresh too.
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

  /**
   * Lists a creator's recent uploads via the optional discovery service
   * (deploy/tiktok-discover), which does this through yt-dlp rather than
   * fetching the blocked profile page directly. Returns the same honest
   * "cannot discover" error as before when the service is not configured --
   * this is the same call whether or not it is set up, so nothing here
   * needs its own separate "not configured" branch.
   */
  async discover(handle: string, options: DiscoverOptions = {}) {
    // Free route first when it is configured; Apify is what works from a
    // serverless deployment with no self-hosted box behind it.
    if (!discoveryConfigured()) {
      if (apifyConfigured()) return discoverViaApify(handle, options);
      return { ok: false, error: capabilityFor().reason };
    }

    const base = process.env.TIKTOK_DISCOVER_URL!;
    const secret = process.env.TIKTOK_DISCOVER_SECRET!;
    const limit = Math.max(1, Math.min(options.limit ?? 12, 30));
    const url = `${base}?handle=${encodeURIComponent(handle.replace(/^@/, ""))}&limit=${limit}`;

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${secret}` },
        cache: "no-store",
        // The discovery box runs a real yt-dlp extraction per request, which
        // is slower than a plain API call -- generous but bounded, so one
        // slow account cannot hang the whole sync run.
        signal: AbortSignal.timeout(45_000),
      });
    } catch (e) {
      const err = e as Error;
      return {
        ok: false,
        error:
          err.name === "TimeoutError"
            ? "The TikTok discovery service timed out."
            : `Could not reach the TikTok discovery service: ${err.message}`,
      };
    }

    if (res.status === 401) return { ok: false, error: "TikTok discovery service rejected the secret." };
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `TikTok discovery service returned HTTP ${res.status}. ${body.slice(0, 160)}` };
    }

    type DiscoverResponse = {
      error?: string;
      videos?: {
        externalId: string | null;
        title: string;
        url: string;
        postedAt: string | null;
      }[];
    };
    let body: DiscoverResponse;
    try {
      body = await res.json();
    } catch {
      return { ok: false, error: "TikTok discovery service returned a response that could not be read." };
    }

    if (body.error && !body.videos?.length) {
      // A private/nonexistent account is a legitimate empty result, not a
      // hard failure -- the service itself distinguishes these with a 200.
      return { ok: true, data: [] };
    }

    const videos = (body.videos ?? [])
      .filter((v): v is typeof v & { externalId: string } => !!v.externalId)
      .map(
        (v): DiscoveredPost => ({
          externalId: v.externalId,
          title: v.title || "Untitled",
          url: v.url,
          postedAt: v.postedAt,
          lengthSeconds: null,
          // The sync reads the instant from `enrichment`, not the top level --
          // putting it anywhere else is silently ignored, which would have
          // made this whole fix a no-op.
          enrichment: { postedAtTs: postedAtTsFrom(v.externalId) },
        }),
      );

    const since = options.since;
    const filtered = since ? videos.filter((v) => v.postedAt != null && v.postedAt >= since) : videos;

    return { ok: true, data: filtered };
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

/** One post as the TikTok actor reports it. Read defensively throughout. */
type ApifyTikTokPost = {
  id?: string;
  text?: string;
  createTimeISO?: string;
  createTime?: number;
  webVideoUrl?: string;
  playCount?: number;
  diggCount?: number;
  commentCount?: number;
  videoMeta?: { duration?: number; coverUrl?: string; originCover?: string };
  authorMeta?: { name?: string };
};

/**
 * Find a creator's recent videos through Apify.
 *
 * THE ENTIRE POINT of this route is that it is used ONCE per video. Apify
 * bills per row returned, so a run that lists the same thirty videos every
 * night pays thirty times a night for nothing. Once a video is in the system,
 * its metrics refresh through TikTok's own free embed endpoint forever, and
 * this is never asked about it again.
 *
 * That is why the limit is small and why the caller throttles how often this
 * is allowed to run: discovery only has to catch what is NEW, and the cost of
 * being a day late is nothing while the cost of asking constantly is the
 * client's money.
 */
async function discoverViaApify(
  handle: string,
  options: DiscoverOptions,
): Promise<ProviderResult<DiscoveredPost[]>> {
  const token = apifyToken();
  if (!token) return { ok: false, error: "APIFY_TIKTOK_TOKEN is not set." };

  const clean = handle.trim().replace(/^@/, "");
  // Hard ceiling regardless of what the caller asks for. A bug upstream that
  // requested 500 would be a bill, not an error.
  const want = Math.max(1, Math.min(options.limit ?? 10, 30));

  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${apifyActor()}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profiles: [clean],
          resultsPerPage: want,
          // Nothing is downloaded: we want metadata, and asking for media
          // would multiply both the runtime and the bill for files we throw
          // away.
          shouldDownloadVideos: false,
          shouldDownloadCovers: false,
          shouldDownloadSubtitles: false,
          shouldDownloadSlideshowImages: false,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(120_000),
      },
    );

    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "Apify rejected the token. Check APIFY_TIKTOK_TOKEN." };
    }
    if (res.status === 402) {
      return {
        ok: false,
        error: "Apify credit exhausted — TikTok discovery pauses until the plan resets. Known videos keep refreshing free.",
      };
    }
    if (!res.ok) {
      return { ok: false, error: `Apify returned ${res.status} for @${clean}.` };
    }

    const rows = (await res.json()) as ApifyTikTokPost[];
    if (!Array.isArray(rows)) return { ok: false, error: "Apify returned an unexpected shape." };

    const since = options.since ?? null;
    const out: DiscoveredPost[] = [];
    for (const p of rows) {
      // Prefer the actor's own id; fall back to parsing the URL. Both are
      // checked against the real id shape, because a row we cannot identify
      // is a row that would create a duplicate video on the next run.
      let id: string | null = null;
      if (p.id && /^\d{15,25}$/.test(p.id)) {
        id = p.id;
      } else if (p.webVideoUrl) {
        const parsed = parseVideoId(p.webVideoUrl);
        if (parsed.ok) id = parsed.id;
      }
      if (!id) continue;

      // The id IS the timestamp, so the publish instant costs no request at
      // all -- and it is exact, where createTimeISO is whatever the actor
      // happened to serialise.
      const ts = postedAtTsFrom(id) ?? p.createTimeISO ?? null;
      const postedAt = ts ? ts.slice(0, 10) : null;
      if (since && postedAt && postedAt < since) continue;

      out.push({
        externalId: id,
        title: (p.text ?? "").trim().split("\n")[0].slice(0, 120) || "Untitled",
        url: p.webVideoUrl ?? `https://www.tiktok.com/@${clean}/video/${id}`,
        postedAt,
        lengthSeconds:
          typeof p.videoMeta?.duration === "number" ? Math.round(p.videoMeta.duration) : null,
        // Already inside the response we paid for.
        thumbnailUrl: p.videoMeta?.coverUrl ?? p.videoMeta?.originCover ?? null,
        metrics: {
          views: typeof p.playCount === "number" ? p.playCount : null,
          likes: typeof p.diggCount === "number" ? p.diggCount : null,
          comments: typeof p.commentCount === "number" ? p.commentCount : null,
        },
        enrichment: { postedAtTs: ts, description: p.text ?? null },
      });
    }

    // Bill is per ROW RETURNED, not per row we chose to keep -- so the caller
    // is told what it actually cost, not what it got.
    return { ok: true, data: out, billedCount: rows.length };
  } catch (e) {
    const err = e as Error;
    return {
      ok: false,
      error:
        err.name === "TimeoutError"
          ? "Apify timed out finding TikTok videos."
          : `Could not reach Apify: ${err.message}`,
    };
  }
}

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
