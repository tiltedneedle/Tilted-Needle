/**
 * Queue depth and corpus coverage, as a markdown table.
 *
 * Written to the GitHub Actions step summary so a scheduled run is legible
 * without opening logs or the app: what is waiting, what is stuck, and
 * whether the corpus actually grew. A pipeline nobody can see the state of is
 * one nobody trusts, and an untrusted pipeline gets babysat -- which defeats
 * the point of scheduling it.
 *
 *     node worker/queue-status.mjs
 */
import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } },
);

const rows = async (t, sel) => (await db.from(t).select(sel)).data ?? [];

const jobs = await rows("ingest_jobs", "kind, status, last_error");
const byKind = new Map();
for (const j of jobs) {
  if (!byKind.has(j.kind)) byKind.set(j.kind, {});
  const b = byKind.get(j.kind);
  b[j.status] = (b[j.status] ?? 0) + 1;
}

console.log("## Pipeline\n");
if (byKind.size === 0) {
  console.log("_Queue is empty._\n");
} else {
  console.log("| Kind | Pending | Running | Done | Unavailable | Failed |");
  console.log("|---|---|---|---|---|---|");
  for (const [kind, b] of [...byKind].sort()) {
    console.log(
      `| ${kind} | ${b.pending ?? 0} | ${b.running ?? 0} | ${b.done ?? 0} `
        + `| ${b.unavailable ?? 0} | ${b.failed ?? 0} |`,
    );
  }
  console.log("");
}

/* ---- Coverage: the number that says whether any of this is working ------ */
const posts = await rows("platform_posts", "id, content_item_id, account:accounts(platform_slug)");
const slugOf = (p) => (Array.isArray(p.account) ? p.account[0] : p.account)?.platform_slug ?? "?";

const transcripts = await rows("video_transcripts", "content_item_id, full_text");
const stored = new Set(transcripts.map((t) => t.content_item_id));
const comments = await rows("post_comments", "platform_post_id");
const commented = new Set(comments.map((c) => c.platform_post_id));

const per = new Map();
for (const p of posts) {
  const s = slugOf(p);
  if (!per.has(s)) per.set(s, { posts: 0, withTranscript: 0, withComments: 0 });
  const e = per.get(s);
  e.posts++;
  if (stored.has(p.content_item_id)) e.withTranscript++;
  if (commented.has(p.id)) e.withComments++;
}

console.log("## Corpus\n");
console.log("| Platform | Posts | Transcript | Comments |");
console.log("|---|---|---|---|");
for (const [slug, e] of [...per].sort()) {
  console.log(`| ${slug} | ${e.posts} | ${e.withTranscript} | ${e.withComments} |`);
}
const chars = transcripts.reduce((s, t) => s + (t.full_text?.length ?? 0), 0);
console.log(
  `\n**${transcripts.length}** transcripts · **${chars.toLocaleString()}** characters `
    + `· **${comments.length.toLocaleString()}** comments\n`,
);

// Surface the actual error text, not just a count. "3 failed" tells whoever
// reads this nothing they can act on.
const failed = jobs.filter((j) => j.status === "failed" && j.last_error);
if (failed.length) {
  console.log("## Failures\n");
  const seen = new Set();
  for (const f of failed.slice(0, 5)) {
    const msg = String(f.last_error).slice(0, 160);
    if (seen.has(msg)) continue;
    seen.add(msg);
    console.log(`- \`${f.kind}\`: ${msg}`);
  }
  console.log("");
}
