// TEMP audit script - read only. Delete when done.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
const db = createClient(url, key, { auth: { persistSession: false } });

async function all(build) {
  const out = [];
  for (let page = 0; ; page++) {
    const { data, error } = await build().range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const { data: wss } = await db.from("workspaces").select("id, name");
console.log("WORKSPACES:", wss.map((w) => `${w.id.slice(0, 8)} ${w.name}`).join(" | "));

for (const w of wss) {
  const items = await all(() =>
    db.from("content_items").select("id, title, client_id, produced_at, review_state").eq("workspace_id", w.id),
  );
  const posts = await all(() =>
    db.from("platform_posts").select("id, content_item_id, account_id").eq("workspace_id", w.id),
  );
  const { data: clients } = await db
    .from("clients")
    .select("id, name, is_archived, deleted_at")
    .eq("workspace_id", w.id);
  const { count: te } = await db
    .from("time_entries")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", w.id);

  const postCount = new Map();
  const acctByItem = new Map();
  for (const p of posts) {
    postCount.set(p.content_item_id, (postCount.get(p.content_item_id) ?? 0) + 1);
    const l = acctByItem.get(p.content_item_id) ?? [];
    l.push(p.account_id);
    acctByItem.set(p.content_item_id, l);
  }
  const unlinked = items.filter((i) => !postCount.has(i.id));
  const liveClients = clients.filter((c) => !c.deleted_at && !c.is_archived);
  const clientsWithUnlinked = new Set(unlinked.map((i) => i.client_id).filter(Boolean));

  console.log(
    `\nWS ${w.id.slice(0, 8)} "${w.name}": items=${items.length} posts=${posts.length} clients(live,unarchived)=${liveClients.length} clientsTotal=${clients.length} unlinkedItems=${unlinked.length} clientsHoldingUnlinked=${clientsWithUnlinked.size} timeEntries=${te}`,
  );

  // merge candidate simulation (approved, non-archived-client only, like the page)
  const archived = new Set(clients.filter((c) => c.is_archived).map((c) => c.id));
  const live = items.filter(
    (i) => (i.review_state ?? "approved") === "approved" && !(i.client_id && archived.has(i.client_id)),
  );
  const GENERIC = new Set(["untitled", "reel", "video", "post", "shorts", "short", "clip"]);
  const norm = (t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const groups = new Map();
  for (const v of live) {
    const k = norm(v.title);
    if (k.length < 12 || GENERIC.has(k)) continue;
    groups.set(k, [...(groups.get(k) ?? []), v]);
  }
  let cands = 0;
  const detail = [];
  for (const [k, list] of groups) {
    if (list.length < 2) continue;
    if (new Set(list.map((v) => v.client_id)).size > 1) continue;
    if (list.some((v) => (postCount.get(v.id) ?? 0) > 1)) continue;
    const accts = list.flatMap((v) => acctByItem.get(v.id) ?? []);
    if (new Set(accts).size !== accts.length) continue;
    // platform check skipped (needs accounts join) - report as upper bound
    cands++;
    detail.push(`${k} x${list.length}`);
  }
  console.log(`  merge candidate groups (upper bound, no platform check): ${cands}`, detail.slice(0, 5));
}

// guideline sections
const secs = await all(() => db.from("client_guideline_sections").select("id, title, body"));
const withBody = secs.filter((s) => s.body && s.body.trim());
const total = withBody.reduce((s, r) => s + r.body.length, 0);
const biggest = withBody.sort((a, b) => b.body.length - a.body.length)[0];
console.log(
  `\nGUIDELINE SECTIONS: ${secs.length} rows, ${withBody.length} with body, ${total} chars total, largest "${biggest?.title}" ${biggest?.body.length}`,
);

// content_merges
const { data: merges } = await db.from("content_merges").select("id, merged_at, undone_at");
console.log("CONTENT_MERGES rows:", merges?.length ?? 0, merges ?? []);
