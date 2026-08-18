import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url),"utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {auth:{persistSession:false}});
const { data: a } = await db.from("post_snapshots").select("id").limit(2500);
console.log("explicit .limit(2500) returned:", a?.length);
const { data: b } = await db.from("post_snapshots").select("id");
console.log("unbounded select returned:", b?.length);
