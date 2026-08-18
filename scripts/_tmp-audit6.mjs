import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url),"utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {auth:{persistSession:false}});
async function selectAll(make, page=1000){const out=[];for(let f=0;;f+=page){const{data,error}=await make().range(f,f+page-1);if(error)throw new Error(JSON.stringify(error));out.push(...(data??[]));if((data??[]).length<page)break;}return out;}
const one = (x)=>Array.isArray(x)?x[0]??null:x;
const WS = "c53055f9-fa68-41a0-95ff-6a35a5bf503f";

const items = await selectAll(()=>db.from("content_items").select("id,title,client_id,review_state,length_seconds,produced_at").eq("workspace_id",WS).order("id"));
const posts = await selectAll(()=>db.from("platform_posts").select("id,content_item_id,account_id,posted_at,account:accounts(id,platform_slug)").eq("workspace_id",WS).order("id"));
const snaps = await selectAll(()=>db.from("post_snapshots").select("id,platform_post_id,captured_at,views").eq("workspace_id",WS).order("captured_at").order("id"));
const clients = (await db.from("clients").select("id,name,is_archived").eq("workspace_id",WS)).data;
const platforms = (await db.from("platforms").select("slug,maturity_window_days").eq("is_enabled",true)).data;
const winFor = new Map(platforms.map(p=>[p.slug,p.maturity_window_days]));
const clientById = new Map(clients.map(c=>[c.id,c]));
const archived = new Set(clients.filter(c=>c.is_archived).map(c=>c.id));
const liveIds = new Set(items.filter(i=>(i.review_state??"approved")==="approved"&&!(i.client_id&&archived.has(i.client_id))).map(i=>i.id));

// --- reimplement scoring.ts (pure) ---
const median=(v)=>{if(!v.length)return null;const s=[...v].sort((a,b)=>a-b);const m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;};
function valueAtMaturity(sn, postedAt, windowDays, now){
  if(!sn.length) return null;
  const sorted=[...sn].sort((a,b)=>a.capturedAt-b.capturedAt);
  const cutoff=postedAt+windowDays*86400000;
  const at=sorted.find(s=>s.capturedAt>=cutoff);
  if(at) return {value:at.value,isMature:true};
  const latest=sorted[sorted.length-1];
  if(now>=cutoff) return {value:latest.value,isMature:true};
  return {value:latest.value,isMature:false};
}
const snapsByPost=new Map();
for(const s of snaps){if(s.views==null)continue;if(!snapsByPost.has(s.platform_post_id))snapsByPost.set(s.platform_post_id,[]);snapsByPost.get(s.platform_post_id).push({capturedAt:Date.parse(s.captured_at),value:s.views});}

const rawPosts = posts.filter(p=>liveIds.has(p.content_item_id));
const byAccount=new Map(); const postMeta=new Map();
for(const p of rawPosts){
  const a=one(p.account); if(!a||!p.posted_at)continue;
  const input={postId:p.id,platform:a.platform_slug,postedAt:Date.parse(`${p.posted_at}T00:00:00Z`),snapshots:snapsByPost.get(p.id)??[]};
  if(!byAccount.has(a.id))byAccount.set(a.id,[]);
  byAccount.get(a.id).push(input);
  postMeta.set(p.id,{contentId:p.content_item_id,platform:a.platform_slug});
}
const now=Date.now();
const indexByPost=new Map();
for(const [,ps] of byAccount){
  const windowDays=winFor.get(ps[0].platform)??7;
  const ordered=[...ps].sort((a,b)=>a.postedAt-b.postedAt);
  const priorMature=[];
  for(const post of ordered){
    const mv=valueAtMaturity(post.snapshots,post.postedAt,windowDays,now);
    if(!mv)continue;
    const recent=priorMature.slice(-10).filter(v=>v>0);
    const baseline=recent.length?median(recent):null;
    if(mv.isMature)priorMature.push(mv.value);
    if(baseline==null)continue;
    if(baseline<=0||mv.value<=0)continue;
    indexByPost.set(post.postId, mv.value/baseline);
  }
}
console.log("scored posts:", indexByPost.size, "of", rawPosts.length);

// bestIndex per content item = MAX across its platforms (what dashboards.ts computes with no platform filter)
const bestByItem=new Map();
for(const [pid,idx] of indexByPost){
  const cid=postMeta.get(pid).contentId;
  if(idx>(bestByItem.get(cid)??0))bestByItem.set(cid,idx);
}
// platforms per item
const platsByItem=new Map();
for(const p of rawPosts){const a=one(p.account);if(!a)continue;if(!platsByItem.has(p.content_item_id))platsByItem.set(p.content_item_id,[]);platsByItem.get(p.content_item_id).push({platform:a.platform_slug,postId:p.id});}

const clientOf=new Map(items.map(i=>[i.id,i.client_id]));
console.log("\n=== Insights tab -> 'Platform fit' median boost per platform");
console.log("   SHIPPED = clientEvidence pushes v.bestIndex (max across ALL the video's platforms) once per platform");
console.log("   HONEST  = each post's own index on its own platform\n");
const byClient=new Map();
for(const [cid,best] of bestByItem){
  const c=clientOf.get(cid); if(!c)continue;
  if(!byClient.has(c))byClient.set(c,[]);
  byClient.get(c).push(cid);
}
for(const [c,ids] of byClient){
  const shipped=new Map(), honest=new Map();
  for(const id of ids){
    const best=bestByItem.get(id);
    for(const {platform,postId} of platsByItem.get(id)??[]){
      if(!shipped.has(platform))shipped.set(platform,[]);
      shipped.get(platform).push(best);
      const own=indexByPost.get(postId);
      if(own!=null){ if(!honest.has(platform))honest.set(platform,[]); honest.get(platform).push(own); }
    }
  }
  const rows=[...shipped.entries()].filter(([,xs])=>xs.length>=3);
  if(rows.length<2)continue;
  console.log(`  ${clientById.get(c)?.name}`);
  for(const [plat,xs] of rows.sort((a,b)=>median(b[1])-median(a[1]))){
    const h=honest.get(plat)??[];
    const hm=h.length>=3?median(h).toFixed(3):"n/a";
    console.log(`     ${plat.padEnd(15)} shipped median ${median(xs).toFixed(3)}x (n=${xs.length}, peak ${Math.max(...xs).toFixed(2)}x)   |  honest ${hm}x (n=${h.length}, peak ${h.length?Math.max(...h).toFixed(2):"-"}x)`);
  }
}

// how many scored videos are cross-posted (so bestIndex leaks between platforms)?
let cross=0,total=0;
for(const id of bestByItem.keys()){
  const ps=new Set((platsByItem.get(id)??[]).map(x=>x.platform));
  total++; if(ps.size>1)cross++;
}
console.log(`\n  scored videos posted on >1 platform: ${cross} / ${total}  (each contributes its single best index to every one of those platforms)`);
