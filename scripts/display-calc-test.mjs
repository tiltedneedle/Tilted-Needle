// Display-calculation test: runs the REAL Content-page math (the exact
// loadContentOverview + computeRankings the page executes) against the live
// database, then independently recomputes every displayed figure from raw
// snapshot rows with separate, simpler code -- and diffs the two.
//
//   node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/display-calc-test.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { computeRankings } from "../src/lib/performanceData.ts";
import { loadContentOverview } from "../src/lib/dashboards.ts";

const env = (n) =>
  (readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").find((l) => l.startsWith(n + "=")) || "")
    .slice(n.length + 1).trim().replace(/^["']|["']$/g, "");
const admin = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), {
  auth: { persistSession: false },
});
const WS = "c53055f9-fa68-41a0-95ff-6a35a5bf503f";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

/* ---- The real page path -------------------------------------------------- */
const rankings = await computeRankings(admin, WS);
const overview = await loadContentOverview(admin, WS, rankings, {});
console.log(`Page path loaded: ${overview.videos.length} videos, ${overview.clients.length} clients\n`);

/* ---- Independent recomputation ------------------------------------------ */
const { data: postRows, error: pErr } = await admin
  .from("platform_posts")
  .select("id, content_item_id, account:accounts(platform_slug)")
  .eq("workspace_id", WS);
if (pErr) throw pErr;

// All snapshots, paged, ordered exactly like the lib (captured_at, id).
const snaps = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await admin
    .from("post_snapshots")
    .select("id, platform_post_id, captured_at, views, likes, comments")
    .eq("workspace_id", WS)
    .order("captured_at").order("id")
    .range(from, from + 999);
  if (error) throw error;
  snaps.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}

const byPost = new Map();
for (const s of snaps) {
  if (!byPost.has(s.platform_post_id)) byPost.set(s.platform_post_id, []);
  byPost.get(s.platform_post_id).push(s);
}

// Independent per-video figures.
const indep = new Map(); // itemId -> { platforms: Map<slug,{views,likes,comments}>, postCount, gainViews }
for (const p of postRows) {
  const slug = (Array.isArray(p.account) ? p.account[0] : p.account)?.platform_slug ?? "?";
  // Mirror post_current_metrics exactly: the latest snapshot row, nulls
  // included (a null view count coalesces to 0 downstream, but its likes/
  // comments still count). Gain, though, is computed over non-null views
  // only, matching the lib.
  const series = byPost.get(p.id) ?? [];
  const viewSeries = series.filter((s) => s.views != null);
  if (!indep.has(p.content_item_id)) {
    indep.set(p.content_item_id, { platforms: new Map(), postCount: 0, gainViews: 0 });
  }
  const v = indep.get(p.content_item_id);
  v.postCount++;
  const latest = series.at(-1);
  if (latest) {
    const cur = v.platforms.get(slug) ?? { views: 0, likes: 0, comments: 0 };
    cur.views += latest.views ?? 0;
    cur.likes += latest.likes ?? 0;
    cur.comments += latest.comments ?? 0;
    v.platforms.set(slug, cur);
  }
  if (viewSeries.length >= 2) {
    v.gainViews += (viewSeries.at(-1).views ?? 0) - (viewSeries.at(-2).views ?? 0);
  }
}

/* ---- Diff the two -------------------------------------------------------- */
let viewMismatch = 0, likeMismatch = 0, commentMismatch = 0, countMismatch = 0, gainMismatch = 0;
const examples = [];
for (const video of overview.videos) {
  const mine = indep.get(video.id);
  if (!mine) { countMismatch++; examples.push(`missing item ${video.title}`); continue; }
  if (video.postCount !== mine.postCount) {
    countMismatch++;
    examples.push(`${video.title}: postCount page=${video.postCount} indep=${mine.postCount}`);
  }
  for (const pl of video.platforms) {
    const m = mine.platforms.get(pl.platform) ?? { views: 0, likes: 0, comments: 0 };
    if (pl.views !== m.views) { viewMismatch++; examples.push(`${video.title} [${pl.platform}] views page=${pl.views} indep=${m.views}`); }
    if (pl.likes !== m.likes) { likeMismatch++; examples.push(`${video.title} [${pl.platform}] likes page=${pl.likes} indep=${m.likes}`); }
    if (pl.comments !== m.comments) commentMismatch++;
  }
  const pageGain = video.recentGain?.views ?? 0;
  if (pageGain !== mine.gainViews) {
    gainMismatch++;
    examples.push(`${video.title}: gain page=${pageGain} indep=${mine.gainViews}`);
  }
}

check("per-video per-platform VIEWS match an independent recomputation", viewMismatch === 0, `${overview.videos.length} videos`);
check("per-video per-platform LIKES match", likeMismatch === 0);
check("per-video per-platform COMMENTS match", commentMismatch === 0);
check("per-video post counts match", countMismatch === 0);
check("per-video recent-gain (+N since last snapshot) matches", gainMismatch === 0);

// Platform totals on the reach card = sum over videos.
for (const t of overview.platformTotals) {
  let views = 0;
  for (const v of indep.values()) views += v.platforms.get(t.platform)?.views ?? 0;
  check(`platform total for ${t.platform} equals the sum over videos`, t.views === views,
    `page=${t.views} indep=${views}`);
}

// Client-row totals = sum of their videos.
{
  const byClient = new Map();
  for (const video of overview.videos) {
    if (!video.clientId) continue;
    const cur = byClient.get(video.clientId) ?? 0;
    byClient.set(video.clientId, cur + (indep.get(video.id)?.platforms.get("youtube")?.views ?? 0));
  }
  let ok = true;
  for (const c of overview.clients) {
    const yt = c.totals.find((t) => t.platform === "youtube");
    if ((yt?.views ?? 0) !== (byClient.get(c.id) ?? 0)) { ok = false; examples.push(`client ${c.name} youtube views page=${yt?.views} indep=${byClient.get(c.id) ?? 0}`); }
  }
  check("client-row YouTube totals equal the sum of their videos", ok, `${overview.clients.length} clients`);
}

/* ---- PRD v0.5 P2: multi-client x multi-person x custom range ------------ */
// The same loader, now with a set-intersection filter state -- verified by
// recomputing the expected video set and its range-windowed gains from raw
// rows with none of the lib's code.
{
  const { data: allItems } = await admin
    .from("content_items")
    .select("id, client_id, produced_at")
    .eq("workspace_id", WS);
  const { data: assigns } = await admin
    .from("content_assignments")
    .select("content_item_id, user_id")
    .eq("workspace_id", WS);

  // Derive the combination FROM real credited items so the expected
  // intersection is provably non-empty -- an all-empty match would pass
  // trivially and prove nothing.
  const itemById = new Map(allItems.map((i) => [i.id, i]));
  const seedAssigns = assigns.filter((a) => {
    const item = itemById.get(a.content_item_id);
    return item?.client_id && item?.produced_at;
  });
  const clientIds = [...new Set(seedAssigns.map((a) => itemById.get(a.content_item_id).client_id))].slice(0, 2);
  const personIds = [...new Set(
    seedAssigns
      .filter((a) => clientIds.includes(itemById.get(a.content_item_id).client_id))
      .map((a) => a.user_id),
  )].slice(0, 2);
  const FROM = "2026-01-01";
  const TO = "2026-12-31";

  const filtered = await loadContentOverview(admin, WS, rankings, {
    clientIds, personIds, from: FROM, to: TO,
  });

  // Independent expectation: produced in range AND client in set AND any
  // selected person credited.
  const credited = new Set(
    assigns.filter((a) => personIds.includes(a.user_id)).map((a) => a.content_item_id),
  );
  const expected = new Set(
    allItems
      .filter((i) => i.client_id && clientIds.includes(i.client_id))
      .filter((i) => i.produced_at && i.produced_at >= FROM && i.produced_at <= TO)
      .filter((i) => credited.has(i.id))
      .map((i) => i.id),
  );
  const got = new Set(filtered.videos.map((v) => v.id));
  const setEqual = expected.size === got.size && [...expected].every((id) => got.has(id));
  check("multi-dimension intersection matches the independent set", setEqual,
    `clients=${clientIds.length} people=${personIds.length} expected=${expected.size} got=${got.size}`);
  check("the intersection scenario is non-trivial (found real overlap)", expected.size > 0,
    `${expected.size} videos in the expected set`);

  // Windowed gains: for every returned video, the gain must equal the sum
  // of positive deltas whose later reading landed inside [FROM, TO] Dubai.
  const rs = new Date(`${FROM}T00:00:00+04:00`).getTime();
  const re = new Date(`${TO}T00:00:00+04:00`).getTime() + 86400000;
  const postsByItem = new Map();
  for (const p of postRows) {
    if (!postsByItem.has(p.content_item_id)) postsByItem.set(p.content_item_id, []);
    postsByItem.get(p.content_item_id).push(p.id);
  }
  let gainOk = true;
  for (const v of filtered.videos) {
    let want = 0;
    let any = false;
    for (const pid of postsByItem.get(v.id) ?? []) {
      const series = (byPost.get(pid) ?? []).filter((s) => s.views != null);
      for (let i = 1; i < series.length; i++) {
        const at = new Date(series[i].captured_at).getTime();
        if (at < rs || at >= re) continue;
        want += Math.max(0, series[i].views - series[i - 1].views);
        any = true;
      }
    }
    const gotGain = v.recentGain?.views ?? null;
    if (any ? gotGain !== want : gotGain !== null) {
      gainOk = false;
      examples.push(`video ${v.title.slice(0, 30)} windowed gain page=${gotGain} indep=${any ? want : null}`);
    }
  }
  check("range-windowed gains match the independent recomputation", gainOk,
    `${filtered.videos.length} videos in view`);

  // Order-independence at the LOADER level: reversed id arrays, same result.
  const reversed = await loadContentOverview(admin, WS, rankings, {
    clientIds: [...clientIds].reverse(),
    personIds: [...personIds].reverse(),
    from: FROM,
    to: TO,
  });
  check("loader output is independent of id-array order",
    JSON.stringify(filtered.videos.map((v) => v.id).sort()) ===
      JSON.stringify(reversed.videos.map((v) => v.id).sort()));
}

if (examples.length) {
  console.log("\nMismatch examples:");
  for (const e of examples.slice(0, 10)) console.log("  -", e);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
