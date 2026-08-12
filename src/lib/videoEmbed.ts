/**
 * Pure embed-URL logic for VideoEmbed.tsx, kept dependency- and JSX-free so
 * it can be tested directly under Node's native loader -- same reasoning as
 * discoveryThrottle.ts. A .tsx file's JSX cannot be parsed by Node's type
 * stripping, only its type annotations, so any logic worth pinning down with
 * a test has to live outside the component file entirely.
 */

export type Embed = { src: string; vertical: boolean };

/**
 * Builds a platform's own free, official embed URL -- the same one their
 * "Share > Embed" button generates. Returns null when there is nothing
 * usable to embed, rather than a link that would 404.
 */
export function embedFor(
  platformSlug: string,
  url: string | null,
  externalId: string | null,
): Embed | null {
  switch (platformSlug) {
    case "youtube": {
      const id = externalId || youtubeIdFrom(url);
      return id ? { src: `https://www.youtube-nocookie.com/embed/${id}`, vertical: false } : null;
    }
    // Same embed endpoint -- a Short is an ordinary video to the player -- but
    // vertical, so the frame matches the footage instead of pillarboxing it.
    // Without this case a Short would fall through to `default` and render no
    // player at all.
    case "youtube_shorts": {
      const id = externalId || youtubeIdFrom(url);
      return id ? { src: `https://www.youtube-nocookie.com/embed/${id}`, vertical: true } : null;
    }
    case "tiktok": {
      const id = externalId || tiktokIdFrom(url);
      return id ? { src: `https://www.tiktok.com/embed/v2/${id}`, vertical: true } : null;
    }
    case "instagram": {
      if (!url) return null;
      const clean = url.split("?")[0].replace(/\/+$/, "");
      return { src: `${clean}/embed/`, vertical: true };
    }
    default:
      return null;
  }
}

export function youtubeIdFrom(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/);
  return m ? m[1] : null;
}

export function tiktokIdFrom(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/video\/(\d{10,25})/);
  return m ? m[1] : null;
}
