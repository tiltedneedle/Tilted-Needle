// Runs Supabase CLI commands against the remote database using SUPABASE_DB_URL
// from .env.local. This avoids `supabase link`, which needs a personal access
// token for the account that owns the project.
//
//   npm run db:list          -> migration list
//   npm run db:push          -> apply pending migrations
//   npm run db -- <args...>  -> any other supabase command
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

let dbUrl = process.env.SUPABASE_DB_URL;

if (!dbUrl) {
  try {
    const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    dbUrl = env
      .split("\n")
      .find((l) => l.startsWith("SUPABASE_DB_URL="))
      ?.slice("SUPABASE_DB_URL=".length)
      .trim()
      .replace(/^["']|["']$/g, "");
  } catch {
    // fall through to the error below
  }
}

if (!dbUrl) {
  console.error("SUPABASE_DB_URL is not set (checked env and .env.local).");
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: npm run db -- <supabase command>");
  process.exit(1);
}

const result = spawnSync("npx", ["supabase", ...args, "--db-url", dbUrl], {
  stdio: "inherit",
  shell: true,
});

process.exit(result.status ?? 1);
