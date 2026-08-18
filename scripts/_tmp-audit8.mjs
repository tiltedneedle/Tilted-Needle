import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url),"utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const db=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SECRET_KEY,{auth:{persistSession:false}});
async function selectAll(make,page=1000){const out=[];for(let f=0;;f+=page){const{data,error}=await make().range(f,f+page-1);if(error)throw new Error(JSON.stringify(error));out.push(...(data??[]));if((data??[]).length<page)break;}return out;}
const one=(x)=>Array.isArray(x)?x[0]??null:x;
const WS="c53055f9-fa68-41a0-95ff-6a35a5bf503f";
const items=await selectAll(()=>db.from("content_items").select("id,title,client_id,review_state").eq("workspace_id",WS).order("id"));
const posts=await selectAll(()=>db.from("platform_posts").select("id,content_item_id,account_id,posted_at,posted_at_ts,account:accounts(id,handle,platform_slug)").eq("workspace_id",WS).order("id"));
const snaps=await selectAll(()=>db.from("post_snapshots").select("platform_post_id,captured_at,views").eq("workspace_id",WS).order("captured_at"));
const clients=(await db.from("clients").select("id,name,is_archived").eq("workspace_id",WS)).data;
const platforms=(await db.from("platforms").select("slug,maturity_window_days").eq("is_enabled",true)).data;
const winFor=new Map(platforms.map(p=>[p.slug,p.maturity_window_days]));
const archived=new Set(clients.filter(c=>c.is_archived).map(c=>c.id));
const liveIds=new Set(items.filter(i=>(i.review_state??"approved")==="approved"&&!(i.client_id&&archived.has(i.client_id))).map(i=>i.id));
const titleOf=new Map(items.map(i=>[i.id,i.title]));
const median=(v)=>{if(!v.length)return null;const s=[...v].sort((a,b)=>a-b);const m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const snapsByPost=new Map();
for(const s of snaps){if(s.views==null)continue;if(!snapsByPost.has(s.platform_post_id))snapsByPost.set(s.platform_post_id,[]);snapsByPost.get(s.platform_post_id).push({at:Date.parse(s.captured_at),v:s.views});}
const now=Date.now();
function vam(sn,postedAt,w){if(!sn.length)return null;const s=[...sn].sort((a,b)=>a.at-b.at);const c=postedAt+w*86400000;const at=s.find(x=>x.at>=c);if(at)return{value:at.v,isMature:true};const l=s[s.length-1];if(now>=c)return{value:l.v,isMature:true};return{value:l.v,isMature:false};}

// ---- how ambiguous is the posting order? --------------------------------
const byAcct=new Map();
for(const p of posts){ if(!liveIds.has(p.content_item_id))continue; const a=one(p.account); if(!a||!p.posted_at)continue;
  if(!byAcct.has(a.id))byAcct.set(a.id,{handle:a.handle,platform:a.platform_slug,posts:[]});
  byAcct.get(a.id).posts.push({...p, plat:a.platform_slug});
}
let sharedDatePosts=0,totalP=0,accountsAffected=0;
for(const [,acc] of byAcct){
  const c=new Map(); for(const p of acc.posts)c.set(p.posted_at,(c.get(p.posted_at)??0)+1);
  let n=0; for(const [,k] of c) if(k>1) n+=k;
  totalP+=acc.posts.length; sharedDatePosts+=n; if(n>0)accountsAffected++;
}
console.log(`=== scoreAccountPosts orders by posted_at, which is a DATE (no time).`);
console.log(`    posts sharing a posted_at with another post on the SAME account: ${sharedDatePosts} / ${totalP}, across ${accountsAffected} / ${byAcct.size} accounts`);
console.log(`    posts that DO carry a posted_at_ts (an exact instant, unused by scoring): ${posts.filter(p=>p.posted_at_ts).length} / ${posts.length}`);

// ---- run the scorer twice, shuffling within-day order -------------------
function score(shuffle){
  const out=new Map(); const baselines=new Map();
  for(const [,acc] of byAcct){
    const w=winFor.get(acc.platform)??7;
    let list=[...acc.posts];
    if(shuffle) list.reverse();                       // any order is equally "correct"
    list.sort((a,b)=>Date.parse(a.posted_at)-Date.parse(b.posted_at)); // stable => within-day order preserved
    const prior=[];
    for(const p of list){
      const mv=vam(snapsByPost.get(p.id)??[],Date.parse(`${p.posted_at}T00:00:00Z`),w);
      if(!mv)continue;
      const recent=prior.slice(-10).filter(v=>v>0);
      const b=recent.length?median(recent):null;
      if(mv.isMature)prior.push(mv.value);
      if(b==null||b<=0||mv.value<=0)continue;
      out.set(p.id,mv.value/b); baselines.set(p.id,{b,n:recent.length,value:mv.value});
    }
  }
  return {out,baselines};
}
const A=score(false), B=score(true);
let changed=0,flipped=0; const worst=[];
for(const [pid,ia] of A.out){
  const ib=B.out.get(pid);
  if(ib==null){changed++;continue;}
  if(Math.abs(ia-ib)>1e-9){changed++; worst.push([pid,ia,ib]);}
  if((ia>=2)!==(ib>=2))flipped++;
}
worst.sort((a,b)=>Math.abs(b[1]-b[2])-Math.abs(a[1]-a[2]));
console.log(`\n    re-running the SAME scorer with the within-day order reversed changes ${changed} of ${A.out.size} indices;`);
console.log(`    ${flipped} posts cross the "boosting" threshold (index >= 2) purely from that reordering.`);
for(const [pid,ia,ib] of worst.slice(0,6)){
  const p=posts.find(x=>x.id===pid);
  console.log(`      "${(titleOf.get(p.content_item_id)??"").slice(0,40)}" (${p.posted_at})  ${ia.toFixed(2)}x  ->  ${ib.toFixed(2)}x`);
}

// ---- baselines resting on 1-2 posts --------------------------------------
const thin=[...A.baselines.entries()].filter(([,b])=>b.n<3);
console.log(`\n=== accountBaseline has no minimum sample: ${thin.length} / ${A.baselines.size} scored posts rest on fewer than 3 prior posts`);
console.log(`    of those, ${thin.filter(([pid])=>A.out.get(pid)>=2).length} are shown as "boosting" (index >= 2)`);
for(const [pid,b] of thin.sort((x,y)=>A.out.get(y[0])-A.out.get(x[0])).slice(0,6)){
  const p=posts.find(x=>x.id===pid);
  console.log(`      ${A.out.get(pid).toFixed(1)}x  "${(titleOf.get(p.content_item_id)??"").slice(0,38)}"  ${b.value.toLocaleString()} views / baseline ${b.b} from n=${b.n} prior post(s)`);
}
