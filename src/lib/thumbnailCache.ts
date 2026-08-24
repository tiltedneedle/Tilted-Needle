/**
 * Keep a copy of the poster frame, because two platforms lend theirs.
 *
 * MEASURED, not assumed. Fetching every stored thumbnail_url in the corpus:
 *
 *   i.ytimg.com                       200   permanent -- the path is derived
 *                                           from the video id and carries no
 *                                           signature at all
 *   p16-common-SIGN.tiktokcdn-us.com  403   signed, expires
 *   scontent-*.cdninstagram.com       403   signed, expires
 *
 * 158 of 570 stored URLs were already dead. The symptom reached a client: the
 * monthly PDF rendered rows of broken-image glyphs, because a report emailed
 * in August is opened in September and the signature had lapsed in between.
 * Storing someone else's signed URL is storing a reference to something they
 * have promised to take away.
 *
 * So the bytes are copied into our own bucket once, and the column then holds
 * a URL nobody else can expire.
 *
 * YOUTUBE IS DELIBERATELY NOT CACHED. Its URL is stable, free, and served
 * from a CDN closer to the reader than ours; copying it would spend storage
 * and a request to make something strictly worse. `needsCaching` is the whole
 * policy and it is expressed as "is this host known to sign", not "is this
 * host in a list of ones we like".
 */

/** Where a cached copy lives. Public-read: these are already-public posters. */
export const THUMBNAIL_BUCKET = "post-thumbnails";

/** Hosts that hand out signed URLs which stop working. */
const SIGNED_HOSTS = [/tiktokcdn/i, /cdninstagram/i, /fbcdn\.net/i];

/** Our own storage, which never needs re-caching. */
const OURS = /\/storage\/v1\/object\/public\//i;

export function needsCaching(url: string | null | undefined): boolean {
  if (!url) return false;
  if (OURS.test(url)) return false;
  return SIGNED_HOSTS.some((re) => re.test(url));
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Copy one poster frame into our bucket and return the durable URL.
 *
 * Returns null on any failure, and the caller must treat that as "keep what
 * you had". A thumbnail is decoration: it is never worth failing a sync over,
 * and an exception here would take down the metrics write that shares the
 * transaction.
 *
 * `postId` is the object name, so re-running overwrites rather than
 * accumulating. A post has exactly one current poster, and versioning them
 * would grow the bucket without anything ever reading the old ones.
 */
export async function cacheThumbnail(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  postId: string,
  sourceUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const res = await fetchImpl(sourceUrl, {
      // Some CDNs 403 a request that names a referring origin.
      referrerPolicy: "no-referrer",
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return null;

    const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    const ext = EXT[mime];
    // Only real images. A signed URL that has lapsed answers 403 with an HTML
    // body, and storing that as a .jpg would turn a broken image into a
    // broken image we are also paying to host.
    if (!ext) return null;

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > 2_000_000) return null;

    const path = `${postId}.${ext}`;
    const { error } = await db.storage.from(THUMBNAIL_BUCKET).upload(path, bytes, {
      contentType: mime,
      upsert: true,
      cacheControl: "31536000",
    });
    if (error) return null;

    const { data } = db.storage.from(THUMBNAIL_BUCKET).getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * Cache if the host is known to expire, otherwise keep the original.
 *
 * The one call sites should use: it makes "leave YouTube alone" the default
 * rather than something each caller has to remember.
 */
export async function durableThumbnailUrl(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  postId: string,
  sourceUrl: string | null | undefined,
): Promise<string | null> {
  if (!sourceUrl) return null;
  if (!needsCaching(sourceUrl)) return sourceUrl;
  return (await cacheThumbnail(db, postId, sourceUrl)) ?? sourceUrl;
}
