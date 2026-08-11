/**
 * "Paste a link" -> which platform, which post.
 *
 * Kept dependency- and JSX-free so it can be tested directly under Node's
 * native loader, same reasoning as videoEmbed.ts.
 *
 * This is the ONLY place that decides what a pasted link means, because the
 * cost of deciding wrong is not a failed parse -- it is a SECOND content item
 * for a video the sync already tracks, splitting one video's metrics across
 * two rows that each look complete. Nothing downstream would flag that; the
 * numbers would simply be quietly wrong in every report forever.
 *
 * So the rule throughout: recognise a shape exactly, or refuse it and say
 * why. Never guess an id out of an unfamiliar URL.
 */

export type ContentPlatform = "youtube" | "tiktok" | "instagram";

export type ParsedContentUrl = {
  platform: ContentPlatform;
  /** The id as the sync stores it in platform_posts.external_id. */
  externalId: string;
  /**
   * The creator, when the URL carries it. TikTok puts it in the path;
   * YouTube and Instagram do not, so this is null for them and the account
   * has to be resolved some other way.
   */
  handle: string | null;
  /** Normalised, tracking parameters stripped. */
  canonicalUrl: string;
};

export type ParseResult =
  | { ok: true; data: ParsedContentUrl }
  | { ok: false; error: string };

/**
 * Publish instant from a TikTok id: the upper 32 bits are Unix seconds.
 *
 * Duplicated from providers/tiktok.ts rather than imported, because that
 * module pulls in the whole provider (fetch, env, throttling) and this file
 * must stay loadable by a bare Node test. The shift is four lines and has
 * been stable since 2016; the coupling would cost more than the repetition.
 *
 * BigInt() not a 32n literal -- the compile target predates BigInt literals
 * and `32n` fails the production build while typechecking clean locally.
 */
export function tiktokPostedAtTs(externalId: string): string | null {
  if (!/^\d{15,25}$/.test(externalId)) return null;
  const secs = Number(BigInt(externalId) >> BigInt(32));
  if (!Number.isFinite(secs) || secs < 1400000000 || secs > 4000000000) return null;
  return new Date(secs * 1000).toISOString();
}

export function parseContentUrl(input: string): ParseResult {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Paste a link to the video." };

  // A bare id is ambiguous -- 11 word characters could be a YouTube id or the
  // tail of something else entirely -- so only full URLs are accepted here.
  // The manual form below is the escape hatch for anything unparseable.
  if (!/^https?:\/\//i.test(raw) && !/^(www\.)?(youtube|youtu|tiktok|instagram)\./i.test(raw)) {
    return {
      ok: false,
      error: "That is not a link. Paste the full URL to the video.",
    };
  }

  const url = raw.replace(/^(?!https?:\/\/)/i, "https://");

  const yt = parseYouTube(url);
  if (yt) return yt;

  const tt = parseTikTok(url);
  if (tt) return tt;

  const ig = parseInstagram(url);
  if (ig) return ig;

  return {
    ok: false,
    error:
      "Only YouTube, TikTok and Instagram links can be read. Add this one by hand instead.",
  };
}

function parseYouTube(url: string): ParseResult | null {
  // `//` in the alternation matters: youtu.be is the whole host, so it is
  // preceded by the scheme's slashes and not by a dot. Requiring a dot let
  // every youtu.be link fall through to "unsupported platform".
  if (!/(?:^|\/\/|\.)(?:youtube\.com|youtu\.be)\//i.test(url)) return null;

  // A channel link is a valid YouTube URL and NOT a video. Saying so beats
  // "could not read", which reads as though the link were broken.
  if (/youtube\.com\/(?:@|channel\/|c\/|user\/)/i.test(url)) {
    return {
      ok: false,
      error: "That is a channel, not a video. Open the video and copy its link.",
    };
  }

  const m = url.match(
    /(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/,
  );
  if (!m) {
    return { ok: false, error: "No video id in that YouTube link." };
  }

  return {
    ok: true,
    data: {
      platform: "youtube",
      externalId: m[1],
      handle: null,
      canonicalUrl: `https://www.youtube.com/watch?v=${m[1]}`,
    },
  };
}

function parseTikTok(url: string): ParseResult | null {
  if (!/tiktok\.com/i.test(url)) return null;

  // Short links are redirects. Following one is a network call the caller did
  // not ask for, so it is refused with the fix rather than silently resolved.
  if (/(?:vm|vt)\.tiktok\.com\//i.test(url)) {
    return {
      ok: false,
      error:
        "Short vm./vt. links cannot be read directly. Open it and copy the full tiktok.com/@user/video/… link.",
    };
  }

  const full = url.match(/tiktok\.com\/@([\w.\-]+)\/(?:video|photo)\/(\d{15,25})/i);
  if (full) {
    return {
      ok: true,
      data: {
        platform: "tiktok",
        externalId: full[2],
        handle: full[1],
        canonicalUrl: `https://www.tiktok.com/@${full[1]}/video/${full[2]}`,
      },
    };
  }

  const bare = url.match(/tiktok\.com\/(?:embed\/v2\/|video\/)(\d{15,25})/i);
  if (bare) {
    return {
      ok: true,
      data: {
        platform: "tiktok",
        externalId: bare[1],
        handle: null,
        canonicalUrl: `https://www.tiktok.com/video/${bare[1]}`,
      },
    };
  }

  return { ok: false, error: "No video id in that TikTok link." };
}

function parseInstagram(url: string): ParseResult | null {
  if (!/instagram\.com/i.test(url)) return null;

  const m = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  if (!m) {
    return {
      ok: false,
      error: "That is a profile, not a post. Open the reel and copy its link.",
    };
  }

  return {
    ok: true,
    data: {
      platform: "instagram",
      externalId: m[1],
      handle: null,
      canonicalUrl: `https://www.instagram.com/reel/${m[1]}/`,
    },
  };
}
