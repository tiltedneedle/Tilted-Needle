// Reconstructs the VideoSummary[] that ContentOverview (a "use client"
// component) receives, to size the RSC payload crossing to the browser.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = (n) =>
  (readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .find((l) => l.startsWith(n + "=")) || "")
    .slice(n.length + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
const admin = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), {
  auth: { persistSession: false },
});
const WS = "c53055f9-fa68-41a0-95ff-6a35a5bf503f";

async function selectAll(make) {
  const out = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await make().range(f, f + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

const items = await selectAll(() =>
  admin.from("content_items")
    .select("id, title, produced_at, length_seconds, client_id, review_state, client:clients(id, name)")
    .eq("workspace_id", WS).order("id"));
const posts = await selectAll(() =>
  admin.from("platform_posts")
    .select("id, content_item_id, posted_at, thumbnail_url, external_id, account:accounts(platform_slug, last_synced_at), metrics:post_current_metrics(views, likes, comments)")
    .eq("workspace_id", WS).order("id"));
const assigns = await selectAll(() =>
  admin.from("content_assignments")
    .select("id, content_item_id, user_id, profile:profiles(full_name), role:roles(slug, name)")
    .eq("workspace_id", WS).order("id"));

const one = (x) => (Array.isArray(x) ? x[0] : x);

const byItem = new Map();
const postsByItem = new Map();
const thumbByItem = new Map();
const codeByItem = new Map();
const lifecycleByItem = new Map();
for (const p of posts) {
  const a = one(p.account); if (!a) continue;
  const m = one(p.metrics);
  if (!byItem.has(p.content_item_id)) byItem.set(p.content_item_id, []);
  byItem.get(p.content_item_id).push({ platform: a.platform_slug, views: m?.views ?? 0, likes: m?.likes ?? 0, comments: m?.comments ?? 0 });
  postsByItem.set(p.content_item_id, (postsByItem.get(p.content_item_id) ?? 0) + 1);
  if (p.thumbnail_url && !thumbByItem.has(p.content_item_id)) thumbByItem.set(p.content_item_id, p.thumbnail_url);
  if (p.external_id && !codeByItem.has(p.content_item_id)) codeByItem.set(p.content_item_id, p.external_id);
  if (!lifecycleByItem.has(p.content_item_id)) lifecycleByItem.set(p.content_item_id, []);
  // LifecycleReading shape, representative values
  lifecycleByItem.get(p.content_item_id).push({
    platform: a.platform_slug,
    reading: { shape: "tail", coverage: "from-birth", gainInWindow: 1234, windowDays: 12.34,
      dailyRate: 12.345678, ageDays: 123.45, recentShare: 0.1234, momentum: 1.2345, halfLifeDays: 3.21 },
  });
}
const creditsByItem = new Map();
for (const a of assigns) {
  if (!creditsByItem.has(a.content_item_id)) creditsByItem.set(a.content_item_id, []);
  creditsByItem.get(a.content_item_id).push({
    assignmentId: a.id, roleSlug: one(a.role)?.slug ?? "x",
    userId: a.user_id, userName: one(a.profile)?.full_name ?? "Unknown",
  });
}

const videos = items.map((i) => ({
  id: i.id, title: i.title, clientId: i.client_id, clientName: one(i.client)?.name ?? null,
  producedAt: i.produced_at, lengthSeconds: i.length_seconds,
  platforms: byItem.get(i.id) ?? [],
  thumbnailUrl: thumbByItem.get(i.id) ?? null,
  postCode: codeByItem.get(i.id) ?? null,
  trackedSeconds: 0, bestIndex: null, postCount: postsByItem.get(i.id) ?? 0,
  credits: creditsByItem.get(i.id) ?? [],
  recentGain: { views: 100, days: 1.05, staleDays: 0.9 },
  platformGains: (byItem.get(i.id) ?? []).map((p) => ({ platform: p.platform, views: 10 })),
  lifecycle: lifecycleByItem.get(i.id) ?? [],
  lifecycleShape: "tail",
}));

const j = JSON.stringify(videos);
console.log(`VideoSummary[] for ${videos.length} videos: ${j.length} bytes (${(j.length / 1024).toFixed(1)} KiB)`);

const fieldBytes = (pick) => JSON.stringify(videos.map(pick)).length;
console.log(`  lifecycle field alone:    ${fieldBytes((v) => v.lifecycle)} bytes`);
console.log(`  thumbnailUrl field alone: ${fieldBytes((v) => v.thumbnailUrl)} bytes`);
console.log(`  credits field alone:      ${fieldBytes((v) => v.credits)} bytes`);
console.log(`  platforms field alone:    ${fieldBytes((v) => v.platforms)} bytes`);

// How many of the 534 are actually rendered on first paint (LoadMoreList initialCount)
console.log(`\nLoadMoreList default initialCount = 10 -> ${videos.length} tiles' data shipped, 10 mounted.`);

// accounts payload
const { data: accounts } = await admin.from("accounts")
  .select("id, workspace_id, client_id, platform_slug, handle, connection_mode")
  .eq("workspace_id", WS).eq("is_archived", false);
console.log(`accounts prop: ${accounts.length} rows, ${JSON.stringify(accounts).length} bytes`);
console.log(`  per-render filter work in ContentOverview: ${videos.length} x ${accounts.length} = ${videos.length * accounts.length} comparisons`);
