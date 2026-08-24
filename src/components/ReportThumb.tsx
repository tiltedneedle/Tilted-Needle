"use client";

import { useState } from "react";

/**
 * A poster frame in the client report, which disappears rather than breaking.
 *
 * ReportDocument is a server component, so it cannot attach onError -- and
 * that is the whole reason this file exists. It rendered a bare <img>, and
 * when the URL was dead the client's own PDF showed the browser's
 * broken-image glyph. Seven rows of torn-paper icons in a document that goes
 * to a paying client is worse than no artwork at all.
 *
 * THE URLS DIE ON THEIR OWN, and that is not a bug to be fixed here.
 * Measured across the corpus: i.ytimg.com returns 200 indefinitely because
 * the path is derived from the video id, while TikTok
 * (p16-common-SIGN.tiktokcdn-us.com) and Instagram (scontent-*.cdninstagram)
 * hand out SIGNED urls and answer 403 once the signature lapses -- 158 of the
 * stored thumbnails were already dead when this was written. VideoTile has
 * always known this; its onError comment says Instagram's links "WILL
 * expire". The report simply never got the same treatment.
 *
 * The real repair is to cache the bytes at sync time, while the signature is
 * still valid, and serve them from our own storage. Until that lands this
 * keeps the failure invisible to the reader, which is the part that actually
 * reaches a client.
 */
export default function ReportThumb({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden="true"
      // Eager, not lazy: a print or PDF capture does not scroll, so a lazy
      // image below the fold is never requested and never drawn.
      loading="eager"
      // Some CDNs 403 a request that names a referring origin.
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
