/**
 * Sample one competitor's recent posts.
 *
 * Subject is a COMPETITOR row. The whole sample for that rival is rewritten
 * in one pass, and every rel_index recomputed with it -- the baseline is the
 * median of the sample, so adding posts moves it for all of them. Updating
 * one post's index without the rest would leave a table of ratios against
 * different denominators.
 *
 * WHERE THE FIGURES COME FROM, AND WHAT IS ACTUALLY REACHABLE.
 * Measured 2026-08-25 against yt-dlp's profile listing:
 *
 *   youtube     WORKS -- view counts, titles, durations.
 *   instagram   BROKEN upstream ("Unable to extract data" on the user page).
 *   tiktok      BROKEN upstream ("Unable to extract secondary user ID").
 *
 * Instagram's SINGLE-post extractor still works, so a paste-a-URL route
 * remains possible for it; profile discovery is what is gone. TikTok is the
 * same wall that leaves 74 client videos unreachable.
 *
 * An unreachable extractor is recorded as an ERROR on the competitor row, not
 * as an empty sample. "This rival posted nothing" and "we cannot see this
 * rival" are different facts, and only the first is about the competitor --
 * writing the second as the first would quietly retire a rival from the idea
 * generator for a reason that has nothing to do with them.
 */
import { relativeIndex } from "../../src/lib/analysis/competitors.ts";

/** Profile URL for a platform. Null when we have no shape for it. */
function profileUrl(platform, handle) {
  switch (platform) {
    case "youtube":
    case "youtube_shorts":
      return `https://www.youtube.com/@${handle}/videos`;
    case "tiktok":
      return `https://www.tiktok.com/@${handle}`;
    case "instagram":
      return `https://www.instagram.com/${handle}/`;
    default:
      return null;
  }
}

export async function competitorScan({ db, job, log }) {
  const { data: comp, error: compErr } = await db
    .from("competitors")
    .select("id, workspace_id, client_id, platform_slug, handle, is_archived")
    .eq("id", job.subject_id)
    .maybeSingle();
  if (compErr) throw new Error(`competitors: ${compErr.message}`);
  if (!comp) return { unavailable: true, note: "competitor row is gone" };
  if (comp.is_archived) return { unavailable: true, note: "competitor is archived" };

  const url = profileUrl(comp.platform_slug, comp.handle);
  if (!url) {
    return { unavailable: true, note: `no profile shape for ${comp.platform_slug}` };
  }

  const base = process.env.TIKTOK_DISCOVER_URL;
  if (!base) throw new Error("TIKTOK_DISCOVER_URL is not set");
  const endpoint = base.replace(/\/discover\/?$/, "")
    + `/profile?url=${encodeURIComponent(url)}&limit=${process.env.COMPETITOR_LIMIT ?? 25}`;

  // TIKTOK_DISCOVER_SECRET, the same name transcript.mjs uses. The service
  // reads it as DISCOVER_SECRET on its own side; inventing a third name here
  // would have failed as a 401 that looks like a broken extractor.
  const secret = process.env.TIKTOK_DISCOVER_SECRET;
  if (!secret) throw new Error("TIKTOK_DISCOVER_SECRET is not set");

  const res = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    const note = body?.error ?? `profile fetch returned ${res.status}`;
    // Recorded on the competitor so the UI can say "scan failed" instead of
    // showing an honest-looking zero.
    await db.from("competitors").update({
      last_scanned_at: new Date().toISOString(),
      last_scan_error: String(note).slice(0, 300),
    }).eq("id", comp.id);

    if (body?.extractorBroken) {
      // Terminal for now, not a retry: the extractor is broken upstream and
      // four attempts against it just burn the queue. It comes back when
      // yt-dlp ships a fix, and requeue.mjs will pick it up then.
      return { unavailable: true, note: String(note) };
    }
    throw new Error(String(note));
  }

  if (body.available === false) {
    await db.from("competitors").update({
      last_scanned_at: new Date().toISOString(),
      last_scan_error: body.reason ?? "profile unavailable",
    }).eq("id", comp.id);
    return { unavailable: true, note: body.reason ?? "profile unavailable" };
  }

  const posts = (body.posts ?? []).filter((p) => p.externalId);
  if (posts.length) {
    const rows = posts.map((p) => ({
      workspace_id: comp.workspace_id,
      competitor_id: comp.id,
      external_id: p.externalId,
      url: p.url ?? null,
      title: p.title ?? null,
      caption: p.description ?? null,
      thumbnail_url: p.thumbnail ?? null,
      posted_at: p.timestamp ? new Date(p.timestamp * 1000).toISOString() : null,
      duration_seconds: p.durationSeconds ?? null,
      views: p.views ?? null,
      likes: p.likes ?? null,
      comments: p.comments ?? null,
      fetched_at: new Date().toISOString(),
    }));
    const { error: upErr } = await db.from("competitor_posts")
      .upsert(rows, { onConflict: "competitor_id,external_id" });
    if (upErr) throw new Error(`storing competitor posts: ${upErr.message}`);
  }

  /* Recompute the WHOLE sample's indices, not just the rows just written.
     The baseline is this competitor's median, so new posts move it for every
     existing row too. Reading back rather than trusting `rows` also picks up
     anything an earlier scan stored. */
  const { data: all, error: allErr } = await db
    .from("competitor_posts").select("id, views")
    .eq("competitor_id", comp.id).order("id");
  if (allErr) throw new Error(`reading sample: ${allErr.message}`);

  const { baseline, scored } = relativeIndex(all ?? []);
  for (const p of scored) {
    await db.from("competitor_posts")
      .update({ rel_index: p.relIndex }).eq("id", p.id);
  }

  /* Store the baseline the scan just computed. It was discarded before, which
     left nothing to answer "is this account even in our league" -- so a
     channel with a 110,000,000 median sat in the list looking exactly like a
     peer. rel_index makes their numbers comparable; this is what makes their
     RELEVANCE checkable. */
  await db.from("competitors").update({
    last_scanned_at: new Date().toISOString(),
    last_scan_error: null,
    median_views: baseline,
    sample_size: (all ?? []).length,
  }).eq("id", comp.id);

  log("info", "competitor_sampled", {
    competitor: comp.id, handle: comp.handle, platform: comp.platform_slug,
    fetched: posts.length, sample: (all ?? []).length, baseline,
  });

  return {
    stats: {
      fetched: posts.length,
      sample: (all ?? []).length,
      baseline,
      indexed: scored.filter((p) => p.relIndex != null).length,
    },
  };
}
