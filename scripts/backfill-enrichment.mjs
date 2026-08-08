// Backfill the free enrichment onto posts that already existed
// (PRD-video-intelligence §3.2). Idempotent and re-runnable: it only asks
// about posts still missing the answer.
//
// Cost: videos.list is 1 quota unit per call of up to 50 ids, whatever parts
// it is asked for. 202 posts is ~5 units against a 10,000/day allowance.
//
//   node scripts/backfill-enrichment.mjs [--dry]
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const DRY = process.argv.includes("--dry");
const env = (n) =>
  (readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").find((l) => l.startsWith(n + "=")) || "")
    .slice(n.length + 1).trim().replace(/^["']|["']$/g, "");

const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), {
  auth: { persistSession: false },
});
const KEY = env("YOUTUBE_API_KEY");
if (!KEY) {
  console.error("YOUTUBE_API_KEY is not set.");
  process.exit(1);
}

/** Wikipedia URL -> bare label, matching lib/providers/youtube.ts. */
function topicNames(urls) {
  if (!urls?.length) return [];
  return [...new Set(urls
    .map((u) => u.split("/").pop() ?? "")
    .map((s) => decodeURIComponent(s).replace(/_\([^)]*\)$/, "").replace(/_/g, " ").trim())
    .filter(Boolean))].sort();
}

const { data: posts, error } = await db
  .from("platform_posts")
  .select("id, external_id, content_item_id, posted_at, posted_at_ts, has_captions, account:accounts(platform_slug)")
  .not("external_id", "is", null);
if (error) throw error;

const youtube = (posts ?? []).filter((p) => {
  const acct = Array.isArray(p.account) ? p.account[0] : p.account;
  return acct?.platform_slug === "youtube";
});
const todo = youtube.filter((p) => p.has_captions === null || p.posted_at_ts === null);

console.log(`YouTube posts: ${youtube.length}   needing enrichment: ${todo.length}`);
if (todo.length === 0) {
  console.log("Nothing to do.");
  process.exit(0);
}

let units = 0, postUpdates = 0, itemUpdates = 0, missing = 0;

for (let i = 0; i < todo.length; i += 50) {
  const batch = todo.slice(i, i + 50);
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "contentDetails,snippet,topicDetails");
  url.searchParams.set("id", batch.map((p) => p.external_id).join(","));
  url.searchParams.set("key", KEY);

  const res = await fetch(url);
  units++;
  if (!res.ok) {
    console.error(`  batch ${i / 50 + 1}: HTTP ${res.status} — ${(await res.text()).slice(0, 160)}`);
    continue;
  }
  const body = await res.json();
  const byId = new Map((body.items ?? []).map((v) => [v.id, v]));

  for (const p of batch) {
    const v = byId.get(p.external_id);
    if (!v) {
      // Deleted or gone private. Left untouched rather than marked false --
      // "we could not ask" is not "there are no captions".
      missing++;
      continue;
    }
    const hasCaptions =
      v.contentDetails?.caption === "true" ? true
      : v.contentDetails?.caption === "false" ? false
      : null;

    if (!DRY) {
      const { error: e1 } = await db.from("platform_posts").update({
        has_captions: hasCaptions,
        posted_at_ts: v.snippet?.publishedAt ?? null,
      }).eq("id", p.id);
      if (e1) { console.error(`  post ${p.id}: ${e1.message}`); continue; }

      const topics = topicNames(v.topicDetails?.topicCategories);
      const { error: e2 } = await db.from("content_items").update({
        description: v.snippet?.description ?? null,
        topic_labels: topics.length ? topics : null,
      }).eq("id", p.content_item_id);
      if (e2) { console.error(`  item ${p.content_item_id}: ${e2.message}`); continue; }
      itemUpdates++;
    }
    postUpdates++;
  }
  console.log(`  batch ${i / 50 + 1}: ${batch.length} ids, ${byId.size} returned`);
}

console.log(
  `\n${DRY ? "[dry run] " : ""}posts updated: ${postUpdates}   items updated: ${itemUpdates}` +
  `   unavailable: ${missing}   quota units used: ${units}`,
);

if (!DRY) {
  const { data: after } = await db
    .from("platform_posts")
    .select("id, has_captions, account:accounts(platform_slug)")
    .not("external_id", "is", null);
  const yt = (after ?? []).filter((p) => {
    const a = Array.isArray(p.account) ? p.account[0] : p.account;
    return a?.platform_slug === "youtube";
  });
  const stillNull = yt.filter((p) => p.has_captions === null).length;
  const withCaptions = yt.filter((p) => p.has_captions === true).length;
  console.log(
    `verification: ${yt.length} youtube posts, ${withCaptions} have captions, ` +
    `${stillNull} still unknown (expected: only deleted/private videos)`,
  );
}
