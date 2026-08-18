import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url),"utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {auth:{persistSession:false}});
async function selectAll(make,page=1000){const out=[];for(let f=0;;f+=page){const{data,error}=await make().range(f,f+page-1);if(error)throw new Error(JSON.stringify(error));out.push(...(data??[]));if((data??[]).length<page)break;}return out;}
const one=(x)=>Array.isArray(x)?x[0]??null:x;
const WS="c53055f9-fa68-41a0-95ff-6a35a5bf503f";
const items=await selectAll(()=>db.from("content_items").select("id,title,client_id,review_state").eq("workspace_id",WS).order("id"));
const posts=await selectAll(()=>db.from("platform_posts").select("id,content_item_id,account_id,posted_at,url,account:accounts(id,handle,platform_slug)").eq("workspace_id",WS).order("id"));
const snaps=await selectAll(()=>db.from("post_snapshots").select("id,platform_post_id,captured_at,views").eq("workspace_id",WS).order("captured_at").order("id"));
const clients=(await db.from("clients").select("id,name,is_archived").eq("workspace_id",WS)).data;
const platforms=(await db.from("platforms").select("slug,maturity_window_days").eq("is_enabled",true)).data;
const winFor=new Map(platforms.map(p=>[p.slug,p.maturity_window_days]));
const clientById=new Map(clients.map(c=>[c.id,c]));
const archived=new Set(clients.filter(c=>c.is_archived).map(c=>c.id));
const liveIds=new Set(items.filter(i=>(i.review_state??"approved")==="approved"&&!(i.client_id&&archived.has(i.client_id))).map(i=>i.id));
const titleOf=new Map(items.map(i=>[i.id,i.title]));
const clientOf=new Map(items.map(i=>[i.id,i.client_id]));
const median=(v)=>{if(!v.length)return null;const s=[...v].sort((a,b)=>a-b);const m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const snapsByPost=new Map();
for(const s of snaps){if(s.views==null)continue;if(!snapsByPost.has(s.platform_post_id))snapsByPost.set(s.platform_post_id,[]);snapsByPost.get(s.platform_post_id).push({at:Date.parse(s.captured_at),v:s.views});}
const now=Date.now();
function valueAtMaturity(sn,postedAt,windowDays){
  if(!sn.length)return null;
  const sorted=[...sn].sort((a,b)=>a.at-b.at);
  const cutoff=postedAt+windowDays*86400000;
  const at=sorted.find(s=>s.at>=cutoff);
  if(at)return{value:at.v,isMature:true,branch:"snapshot-inside-window"};
  const latest=sorted[sorted.length-1];
  if(now>=cutoff)return{value:latest.v,isMature:true,branch:"LIFETIME-fallback"};
  return{value:latest.v,isMature:false,branch:"immature"};
}
const byAccount=new Map();
for(const p of posts){ if(!liveIds.has(p.content_item_id))continue; const a=one(p.account); if(!a||!p.posted_at)continue;
  if(!byAccount.has(a.id))byAccount.set(a.id,{handle:a.handle,platform:a.platform_slug,posts:[]});
  byAccount.get(a.id).posts.push({postId:p.id,itemId:p.content_item_id,postedAt:Date.parse(`${p.posted_at}T00:00:00Z`),postedAtStr:p.posted_at,url:p.url,snaps:snapsByPost.get(p.id)??[]});
}
const branchCount={}; const scored=[];
for(const [aid,acc] of byAccount){
  const windowDays=winFor.get(acc.platform)??7;
  const ordered=[...acc.posts].sort((a,b)=>a.postedAt-b.postedAt);
  const prior=[];
  for(const post of ordered){
    const mv=valueAtMaturity(post.snaps,post.postedAt,windowDays);
    if(!mv)continue;
    branchCount[mv.branch]=(branchCount[mv.branch]??0)+1;
    const recent=prior.slice(-10).filter(v=>v>0);
    const baseline=recent.length?median(recent):null;
    if(mv.isMature)prior.push(mv.value);
    if(baseline==null||baseline<=0||mv.value<=0)continue;
    scored.push({postId:post.postId,itemId:post.itemId,handle:acc.handle,platform:acc.platform,postedAt:post.postedAtStr,value:mv.value,baseline,index:mv.value/baseline,priorWindow:[...recent],branch:mv.branch,url:post.url});
  }
}
console.log("valueAtMaturity branch taken, across every scored post:", branchCount);
console.log("  ('LIFETIME-fallback' = the maturity window closed with no snapshot inside it, so the CURRENT lifetime total is used instead of the value at 7/28 days of age)\n");
scored.sort((a,b)=>b.index-a.index);
console.log("=== Top boost indices actually on screen (/content 'Boost' sort, 'boosting' filter, /performance boosts list)");
for(const s of scored.slice(0,12)){
  console.log(`  ${s.index.toFixed(1)}x  "${(titleOf.get(s.itemId)??"").slice(0,38)}" @${s.handle} (${s.platform}) posted ${s.postedAt}`);
  console.log(`        value=${s.value.toLocaleString()} views / baseline=${s.baseline} (median of prior 10: [${s.priorWindow.join(", ")}])  branch=${s.branch}  client=${clientById.get(clientOf.get(s.itemId))?.name}`);
}
const tiny=scored.filter(s=>s.baseline<100);
console.log(`\n  scored posts whose baseline is under 100 views: ${tiny.length} / ${scored.length}`);
console.log(`  scored posts flagged 'boosting' (index >= 2): ${scored.filter(s=>s.index>=2).length}; of those, baseline<100: ${scored.filter(s=>s.index>=2&&s.baseline<100).length}`);
console.log(`  median baseline across all scored posts: ${median(scored.map(s=>s.baseline))}`);
