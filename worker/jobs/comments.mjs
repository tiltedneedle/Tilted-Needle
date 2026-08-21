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
import { isYouTubeLike } from "../platforms.mjs";

/** Enough for any realistic video; the cap stops a runaway thread eating quota. */
const MAX_PAGES = 10;

export async function comments({ db, job, log }) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("YOUTUBE_API_KEY is not set");

  const { data: posts, error } = await db
    .from("platform_posts")
    .select("id, external_id, url, account:accounts(platform_slug)")
    .eq("content_item_id", job.subject_id)
    .not("external_id", "is", null);
  if (error) throw new Error(`lookup failed: ${error.message}`);

  const withPlatform = (posts ?? []).map((p) => ({
    ...p,
    platform: (Array.isArray(p.account) ? p.account[0] : p.account)?.platform_slug,
  }));

  // Shorts included: the Data API's commentThreads endpoint takes a video id
  // and neither knows nor cares that the video is vertical.
  const youtube = withPlatform.filter((p) => isYouTubeLike(p.platform));
  // Instagram has no free comment API, but yt-dlp reads them -- verified on a
  // real post. TikTok is deliberately absent: its extractor returns zero
  // comments even on a post with 169 of them, so queueing it would spend
  // requests to learn nothing. Enrichment for TikTok still runs below.
  const viaBox = withPlatform.filter((p) => p.platform === "instagram" && p.url);

  let boxStats = null;
  if (viaBox.length > 0) {
    boxStats = await fetchViaBox({ db, job, log, posts: viaBox });
  }

  // Nothing to fetch is a terminal, normal outcome -- not a failure to retry.
  if (youtube.length === 0) {
    return boxStats
      ? { stats: boxStats }
      : await (async () => {
          await recordCommentVerdict(db, job, {
            state: "platform_unsupported",
            method: "scope",
            note: "no post on this item is on a platform that exposes comments",
            recheckDays: 90,
          });
          return { unavailable: true, note: "no post on this item exposes comments" };
        })();
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

  /* ZERO COMMENTS IS AN ANSWER, and until it was recorded it was the most
   * expensive silence in the queue.
   *
   * The planner decides freshness from the newest post_comments row for an
   * item. A post with no comments leaves no row, so it looks NEVER FETCHED on
   * every subsequent run and is queued again, forever. Measured: 1,196
   * comments jobs across only 196 distinct subjects, one of them queued 49
   * times -- while 263 of 437 in-scope items had never been queued once,
   * because the per-run cap of 25 was spent re-asking about posts already
   * known to have nothing.
   *
   * Recorded with a recheck date rather than permanently: a video CAN gain
   * its first comment later, so this is "none as of now", not "none ever". */
  const totalFetched = fetched + (boxStats?.fetched ?? 0);
  if (totalFetched === 0) {
    await recordCommentVerdict(db, job, {
      state: "none_exist",
      method: "api",
      note: `no comments on any of this item's ${youtube.length + (boxStats?.posts ?? 0)} post(s) at fetch time`,
      recheckDays: 30,
    });
  }

  return {
    stats: {
      posts: youtube.length, fetched, stored, units,
      ...(boxStats ? { boxFetched: boxStats.fetched, boxStored: boxStats.stored } : {}),
    },
  };
}

/**
 * Record a comments verdict. Same single rule as the transcript recorder:
 * only a path that REACHED the platform and got an answer may write here, so
 * the absence of a row always means "not asked", never "none".
 *
 * Best-effort -- a verdict failing to store must not fail a job whose own
 * answer was correct.
 */
async function recordCommentVerdict(db, job, { state, method, note, recheckDays }) {
  await db.from("enrichment_state").upsert({
    subject_type: "content_item",
    subject_id: job.subject_id,
    kind: "comments",
    workspace_id: job.workspace_id,
    state,
    method: method ?? null,
    note: note ?? null,
    decided_at: new Date().toISOString(),
    recheck_after: recheckDays
      ? new Date(Date.now() + recheckDays * 86_400_000).toISOString()
      : null,
  }, { onConflict: "subject_type,subject_id,kind" });
}

/**
 * Comments and enrichment for platforms with no official API, through the
 * yt-dlp service.
 *
 * Fills two gaps measured on the live library: TikTok had publish timestamps
 * on 0 of 78 posts, and only 10 of 229 content items carried any caption text
 * at all. Both are free here -- the same extraction that reads comments
 * already returns them, so not storing them was pure waste.
 *
 * A box that is unreachable returns null rather than throwing: comments are
 * an enrichment, and the whole job must not fail because one optional source
 * is down.
 */
async function fetchViaBox({ db, job, log, posts }) {
  const base = process.env.TIKTOK_DISCOVER_URL;
  const secret = process.env.TIKTOK_DISCOVER_SECRET;
  if (!base || !secret) return null;

  let fetched = 0;
  let stored = 0;

  for (const post of posts) {
    const url =
      base.replace(/\/discover\/?$/, "") +
      `/meta?url=${encodeURIComponent(post.url)}&limit=200`;

    let body;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(300_000),
      });
      if (res.status === 401) throw new Error("discover box rejected the shared secret");
      if (!res.ok) {
        log("warn", "box_meta_error", { post: post.id, status: res.status });
        continue;
      }
      body = await res.json();
    } catch (err) {
      // Both platforms throttle an IP that asks too fast, and the symptom is a
      // read timeout rather than a 429. One post failing must not abandon the
      // rest, so it is logged and skipped.
      log("warn", "box_meta_failed", { post: post.id, error: String(err?.message ?? err).slice(0, 120) });
      continue;
    }

    if (body?.error || body?.available === false) {
      log("warn", "box_meta_unavailable", { post: post.id, reason: body?.reason ?? body?.error });
      continue;
    }

    // --- Enrichment, free with the same call ---------------------------
    if (body.timestamp) {
      await db.from("platform_posts").update({ posted_at_ts: body.timestamp }).eq("id", post.id);
    }
    if (body.description) {
      // Only fill an empty description: a human may have written a better one
      // than the platform caption, and overwriting that would be rude.
      const { data: item } = await db
        .from("content_items")
        .select("description")
        .eq("id", job.subject_id)
        .maybeSingle();
      if (item && !item.description) {
        await db
          .from("content_items")
          .update({ description: body.description })
          .eq("id", job.subject_id);
      }
    }

    // --- Comments -------------------------------------------------------
    const rows = (body.comments ?? [])
      .filter((c) => c.id && c.text)
      .map((c) => ({
        workspace_id: job.workspace_id,
        platform_post_id: post.id,
        external_id: String(c.id),
        author: c.author ?? null,
        text: c.text,
        like_count: typeof c.likeCount === "number" ? c.likeCount : null,
        published_at: c.publishedAt ?? null,
      }));
    fetched += rows.length;

    if (rows.length > 0) {
      const { error } = await db
        .from("post_comments")
        .upsert(rows, { onConflict: "platform_post_id,external_id" });
      if (error) {
        log("warn", "box_comments_upsert_failed", { post: post.id, error: error.message });
        continue;
      }
      stored += rows.length;
    }
  }

  return { fetched, stored };
}
