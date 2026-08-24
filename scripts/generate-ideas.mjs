// Generate content ideas for a client, grounded in verified evidence.
//   node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/generate-ideas.mjs --client <id> [--count 10] [--pool 100] [--force]
//
// A thin wrapper. Everything that matters -- the evidence table, the citation
// validator, the budget ceiling, the input-digest cache, the unconditional
// ledger row -- lives in src/lib/analysis/ideas.ts, because the UI button
// queues a job that runs the same routine and two copies of a routine that
// spends money is two copies that will disagree.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { generateIdeasForClient } from "../src/lib/analysis/ideas.ts";
import { LlmError } from "../src/lib/llm.ts";

const env = Object.fromEntries(
  readFileSync("./.env.local", "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(),
                 l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
for (const [k, v] of Object.entries(env)) process.env[k] ??= v;
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

const flag = (name, fallback = null) => {
  // Guarded: indexOf returning -1 would make argv[0] -- the node binary's
  // path -- the value, and the failure would be mysterious.
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};

const clientArg = flag("client");
if (!clientArg) {
  // Deliberately required. The previous version defaulted to clients[0] with
  // no workspace filter on a service-role key, so a bare run generated and
  // stored ideas against an arbitrary client in an arbitrary workspace.
  const { data } = await db.from("clients").select("id, name, workspace_id")
    .is("deleted_at", null).eq("is_archived", false).order("name");
  console.error("--client <id> is required. Live clients:\n");
  for (const c of data ?? []) console.error(`  ${c.id}  ${c.name}`);
  process.exit(1);
}

let result;
try {
  result = await generateIdeasForClient(db, {
    clientId: clientArg,
    count: Number(flag("count", 10)),
    pool: Number(flag("pool", 100)),
    force: process.argv.includes("--force"),
  });
} catch (e) {
  if (e instanceof LlmError) console.error(`model call failed (${e.kind}): ${e.message}`);
  throw e;
}

console.log(`client          ${result.clientName}`);
if (result.candidates != null) {
  console.log(`candidates      ${result.candidates} rows, ${result.poolSize} videos in the pool`);
}
console.log(`status          ${result.status}${result.note ? ` -- ${result.note}` : ""}`);
if (result.status === "stored") {
  console.log(`proposed        ${result.proposed} (asked for ${result.requested})`);
  console.log(`stored          ${result.kept}  (dropped: ${JSON.stringify(result.dropped)})`);
}
process.exit(result.status === "budget_exhausted" ? 1 : 0);
