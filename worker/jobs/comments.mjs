/**
 * Fetch a video's comments through the OFFICIAL YouTube Data API.
 *
 * Deliberately the first handler built. It exercises every part of the
 * pipeline -- claim, fetch, upsert, terminal states, error paths -- while
 * touching nothing undocumented or blockable, so a failure here is a bug in
 * the worker rather than an ambiguous "maybe we got blocked".
 *
 * Quota: commentThreads.list is 1 unit per call of up to 100 comments. A
 * video with 400 comments costs 4 units against a 10,000/day allowance.
 *
 * The subject is a CONTENT ITEM. One edit can be posted to several platforms,
 * and only the YouTube posts have a comment API, so the handler resolves the
 * item's YouTube posts itself rather than making the enqueuer know that.
 */

const API = "https://www.googleapis.com/youtube/v3/commentThreads";
/** Enough for any realistic video; the cap stops a runaway thread eating quota. */
const MAX_PAGES = 10;

export async function comments({ db, job, log }) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("YOUTUBE_API_KEY is not set");

  const { data: posts, error } = await db
    .from("platform_posts")
    .select("id, external_id, account:accounts(platform_slug)")
    .eq("content_item_id", job.subject_id)
    .not("external_id", "is", null);
  if (error) throw new Error(`lookup failed: ${error.message}`);

  const youtube = (posts ?? []).filter((p) => {
    const a = Array.isArray(p.account) ? p.account[0] : p.account;
    return a?.platform_slug === "youtube";
  });

  // Nothing to fetch is a terminal, normal outcome -- not a failure to retry.
  if (youtube.length === 0) {
    return { unavailable: true, note: "no youtube post on this content item" };
  }

  let fetched = 0, stored = 0, units = 0;

  for (const post of youtube) {
    let pageToken;
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(API);
      url.searchParams.set("part", "snippet");
      url.searchParams.set("videoId", post.external_id);
      url.searchParams.set("maxResults", "100");
      url.searchParams.set("textFormat", "plainText");
      url.searchParams.set("key", key);
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const res = await fetch(url);
      units++;

      if (!res.ok) {
        const body = await res.text();
        const reason = body.match(/"reason":\s*"([^"]+)"/)?.[1] ?? "";

        // Comments switched off for this video, or the video is gone. Both
        // are terminal facts about the subject, not transient errors.
        if (res.status === 403 && /commentsDisabled/i.test(reason)) {
          return { unavailable: true, note: "comments are disabled on this video", stats: { units } };
        }
        if (res.status === 404) {
          return { unavailable: true, note: "video not found (deleted or private)", stats: { units } };
        }
        // Quota exhaustion is worth backing off from rather than hammering.
        if (res.status === 403 && /quota/i.test(reason)) {
          const e = new Error(`youtube quota exceeded (${reason})`);
          e.blocked = true;
          throw e;
        }
        throw new Error(`youtube ${res.status} ${reason}: ${body.slice(0, 180)}`);
      }

      const body = await res.json();
      const rows = [];
      for (const thread of body.items ?? []) {
        const top = thread.snippet?.topLevelComment;
        const s = top?.snippet;
        if (!top?.id || !s?.textDisplay) continue;
        rows.push({
          workspace_id: job.workspace_id,
          platform_post_id: post.id,
          external_id: top.id,
          author: s.authorDisplayName ?? null,
          text: s.textDisplay,
          like_count: typeof s.likeCount === "number" ? s.likeCount : null,
          published_at: s.publishedAt ?? null,
        });
      }
      fetched += rows.length;

      if (rows.length > 0) {
        // Upsert on (platform_post_id, external_id): re-running a job must
        // refresh like counts rather than duplicate every comment, and the
        // whole pipeline is built to be safely re-runnable.
        const { error: upErr } = await db
          .from("post_comments")
          .upsert(rows, { onConflict: "platform_post_id,external_id" });
        if (upErr) throw new Error(`upsert failed: ${upErr.message}`);
        stored += rows.length;
      }

      pageToken = body.nextPageToken;
      if (!pageToken) break;
      if (page === MAX_PAGES - 1) {
        log("warn", "comments_page_cap", { post: post.id, pages: MAX_PAGES });
      }
    }
  }

  return { stats: { posts: youtube.length, fetched, stored, units } };
}
