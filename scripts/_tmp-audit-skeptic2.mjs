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
const db = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL,
  env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
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

const WS = "c53055f9-1e4f-4e0a-9b1a-000000000000";
const { data: wss } = await db.from("workspaces").select("id, name");
const ws = wss.find((w) => w.name === "Tilted Needle").id;

const items = await all(() =>
  db.from("content_items").select("id, title, client_id, review_state").eq("workspace_id", ws),
);
const posts = await all(() =>
  db
    .from("platform_posts")
    .select("id, content_item_id, account_id, account:accounts(platform_slug)")
    .eq("workspace_id", ws),
);
const { data: clients } = await db
  .from("clients")
  .select("id, name, is_archived, deleted_at")
  .eq("workspace_id", ws);

const archived = new Set(clients.filter((c) => c.is_archived).map((c) => c.id));
const one = (x) => (Array.isArray(x) ? x[0] : x);

const postCount = new Map();
const acctByItem = new Map();
const platsByItem = new Map();
for (const p of posts) {
  postCount.set(p.content_item_id, (postCount.get(p.content_item_id) ?? 0) + 1);
  acctByItem.set(p.content_item_id, [...(acctByItem.get(p.content_item_id) ?? []), p.account_id]);
  const slug = one(p.account)?.platform_slug;
  if (slug) platsByItem.set(p.content_item_id, [...(platsByItem.get(p.content_item_id) ?? []), slug]);
}

const live = items.filter(
  (i) => (i.review_state ?? "approved") === "approved" && !(i.client_id && archived.has(i.client_id)),
);
console.log("items:", items.length, "approved+non-archived-client:", live.length);
console.log("review_state breakdown:", items.reduce((m, i) => ((m[i.review_state ?? "null"] = (m[i.review_state ?? "null"] ?? 0) + 1), m), {}));

const GENERIC = new Set(["untitled", "reel", "video", "post", "shorts", "short", "clip"]);
const norm = (t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const groups = new Map();
for (const v of live) {
  const k = norm(v.title);
  if (k.length < 12 || GENERIC.has(k)) continue;
  groups.set(k, [...(groups.get(k) ?? []), v]);
}
const out = [];
for (const [k, list] of groups) {
  if (list.length < 2) continue;
  if (new Set(list.map((v) => v.client_id)).size > 1) continue;
  const platforms = [...new Set(list.flatMap((v) => platsByItem.get(v.id) ?? []))].sort();
  if (platforms.length > 1) continue;
  if (list.some((v) => (postCount.get(v.id) ?? 0) > 1)) continue;
  const accts = list.flatMap((v) => acctByItem.get(v.id) ?? []);
  if (new Set(accts).size !== accts.length) continue;
  out.push({ k, n: list.length, platforms, posts: list.map((v) => postCount.get(v.id) ?? 0) });
}
console.log("\nREAL findMergeCandidates groups on live data:", out.length);
console.log(JSON.stringify(out.slice(0, 12), null, 1));
