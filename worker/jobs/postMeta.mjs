/**
 * Fill a post's platform metadata from the yt-dlp box.
 *
 * WHAT WAS MISSING, measured 2026-09-14: TikTok posts without a duration
 * 159/171, without their sound 171/171, without shares 171/171; Instagram
 * posts without a caption 61/199. All of it comes back from the one
 * extract_info call the box already makes per video -- /meta returns it --
 * and nothing had ever asked. The video-length analysis was blind on TikTok
 * and the sound a post uses was recorded nowhere, though it is the field
 * that just separated a creator talking from a library song.
 *
 * FILLS, NEVER OVERWRITES. A human may have typed a better description than
 * the platform caption, or corrected a length; the platform's value goes in
 * only where the field is empty. Shares are appended as a snapshot row from
 * this source, so the metrics history says where each number came from.
 *
 * The subject is a CONTENT ITEM, like the transcript kinds; the handler
 * resolves its posts and takes whichever this host can reach (the same
 * TRANSCRIPT_PLATFORMS gate -- the box that can fetch a platform's audio can
 * fetch its metadata).
 */
import { hostPlatforms } from "../platforms.mjs";

export async function postMeta({ db, job, log }) {
  const base = process.env.TIKTOK_DISCOVER_URL;
  const secret = process.env.TIKTOK_DISCOVER_SECRET;
  if (!base || !secret) return { skip: true, note: "no yt-dlp box on this host" };

  const { data: allPosts, error } = await db
    .from("platform_posts")
    .select("id, url, account:accounts(platform_slug)")
    .eq("content_item_id", job.subject_id)
    .not("url", "is", null);
  if (error) throw new Error(`lookup failed: ${error.message}`);

  const allowed = hostPlatforms();
  const slugOf = (p) => (Array.isArray(p.account) ? p.account[0] : p.account)?.platform_slug;
  const posts = (allPosts ?? []).filter((p) => !allowed || allowed.has(slugOf(p)));
  if (posts.length === 0) {
    const seen = [...new Set((allPosts ?? []).map(slugOf).filter(Boolean))];
    if (!seen.length) return { unavailable: true, noRequest: true, note: "no platform posts with a url" };
    return { skip: true, note: `posted on ${seen.join(", ")}; this host serves ${[...(allowed ?? [])].join(", ")}` };
  }

  const { data: item } = await db
    .from("content_items")
    .select("length_seconds, music_used, description")
    .eq("id", job.subject_id)
    .maybeSingle();

  const filled = [];
  let reached = 0;
  for (const post of posts) {
    const url = base.replace(/\/discover\/?$/, "") + `/meta?url=${encodeURIComponent(post.url)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(120_000),
    });
    if (res.status === 401) throw new Error("discover box rejected the shared secret");
    if (res.status === 429) {
      const e = new Error("the platform is rate-limiting the box (429); the whole kind backs off");
      e.blocked = true;
      throw e;
    }
    if (!res.ok) {
      log("warn", "post_meta_box_error", { post: post.id, status: res.status });
      continue;
    }
    const body = await res.json();
    if (body?.error || body?.available === false) {
      log("warn", "post_meta_unavailable", { post: post.id, reason: body?.reason ?? body?.error });
      continue;
    }
    reached++;

    // ---- content item: fill the blanks ---------------------------------
    const patch = {};
    if (!item?.length_seconds && typeof body.durationSeconds === "number" && body.durationSeconds > 0) {
      patch.length_seconds = Math.round(body.durationSeconds);
    }
    if (!item?.music_used && body.track) {
      patch.music_used = body.artist && !/^original sound/i.test(body.track)
        ? `${body.track} — ${body.artist}`
        : body.track;
    }
    if (!item?.description && body.description) patch.description = body.description;
    if (Object.keys(patch).length) {
      const { error: upErr } = await db.from("content_items").update(patch).eq("id", job.subject_id);
      if (upErr) throw new Error(`content_items update failed: ${upErr.message}`);
      filled.push(...Object.keys(patch));
      Object.assign(item ?? (item = {}), patch);   // one post is enough per field
    }

    // ---- exact publish instant, which the sync only ever had as a date --
    if (typeof body.timestamp === "number") {
      await db.from("platform_posts").update({ posted_at_ts: body.timestamp }).eq("id", post.id);
    }

    // ---- shares: a snapshot from this source, never a silent zero ------
    if (typeof body.shareCount === "number") {
      const { error: snapErr } = await db.from("post_snapshots").insert({
        workspace_id: job.workspace_id,
        platform_post_id: post.id,
        captured_at: new Date().toISOString(),
        views: typeof body.viewCount === "number" ? body.viewCount : null,
        likes: typeof body.likeCount === "number" ? body.likeCount : null,
        comments: typeof body.commentCount === "number" ? body.commentCount : null,
        shares: body.shareCount,
        source: "box",
      });
      if (snapErr) log("warn", "post_meta_snapshot_failed", { post: post.id, error: snapErr.message });
      else filled.push("shares");
    }
  }

  if (reached === 0) throw new Error("the box reached none of this item's posts; retrying rather than settling");

  log("info", "post_meta_filled", { item: job.subject_id, fields: filled });
  return { stats: { fields: filled.length, filled: [...new Set(filled)].join(",") } };
}
