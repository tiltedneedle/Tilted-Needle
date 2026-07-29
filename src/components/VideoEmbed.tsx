import { embedFor } from "@/lib/videoEmbed";

/**
 * A playable embed for a platform post, using each platform's own free,
 * official embed surface -- the same iframe URL their own "Share > Embed"
 * button generates. No third-party player, no API key: we already store
 * the post's url and, for anything discovered automatically, its
 * external_id.
 *
 *   YouTube    youtube-nocookie.com/embed/{id} -- YouTube's documented
 *              privacy-enhanced embed domain.
 *   TikTok     tiktok.com/embed/v2/{id} -- the exact page this app already
 *              reads for free metrics (see providers/tiktok.ts); it happens
 *              to also be a complete, playable embed player.
 *   Instagram  {post-url}/embed/ -- Instagram's own embed convention for
 *              any public post or reel URL.
 */
export default function VideoEmbed({
  platformSlug,
  url,
  externalId,
}: {
  platformSlug: string;
  url: string | null;
  externalId: string | null;
}) {
  const embed = embedFor(platformSlug, url, externalId);

  if (!embed) return null;

  return (
    <div
      className="animate-rise mt-2 overflow-hidden rounded-md bg-[var(--bg-subtle)]"
      style={{ aspectRatio: embed.vertical ? "9 / 16" : "16 / 9", maxWidth: embed.vertical ? 360 : "100%" }}
    >
      <iframe
        src={embed.src}
        className="h-full w-full border-0"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}
