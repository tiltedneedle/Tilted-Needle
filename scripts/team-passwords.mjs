/**
 * Set a fresh temporary password for each teammate and write them all down
 * once, privately.
 *
 *   node scripts/team-passwords.mjs --dry        # who would be changed
 *   node scripts/team-passwords.mjs              # everyone who never signed in
 *   node scripts/team-passwords.mjs --all
 *   node scripts/team-passwords.mjs --who usama,yusuf
 *
 * WHY THIS EXISTS ALONGSIDE team-links.mjs
 *
 * Links are the better instrument: single-use, expiring, and no plaintext
 * credential ever exists. Use team-links.mjs when it works.
 *
 * It does not work here yet. A recovery link is only as good as its
 * redirect, and Supabase silently rewrites any redirect that is not in the
 * project's allow-list to the Site URL -- which on this project is still
 * http://localhost:3000. Asked for https://tilted-needle0.vercel.app/auth/reset,
 * it returned localhost. So every link generated today points at one
 * machine's loopback and is worthless to anybody else, and no amount of code
 * fixes it: it is a dashboard setting under Authentication -> URL
 * Configuration.
 *
 * A password has no redirect. It works from any browser, anywhere, today.
 * That is the entire reason to prefer the weaker instrument.
 *
 * WHAT THIS COSTS, STATED PLAINLY
 *
 * A plaintext password now exists for each of these accounts, in a file. It
 * is written to .env.team-credentials, which .gitignore already covers via
 * `.env*`, and it is never printed. Every password is unique and random --
 * there is no shared or guessable pattern -- but the file is a master key to
 * the workspace until each person changes their own. Send each line
 * privately, tell people to change it, and delete the file.
 *
 * Existing passwords are NOT readable. Supabase stores a one-way hash, so
 * this REPLACES whatever was there; anyone already signed in with an old
 * password is locked out until they use the new one. That is why the default
 * touches only accounts that have never signed in.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync("./.env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);

const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};
const ALL = process.argv.includes("--all");
const DRY = process.argv.includes("--dry");
const WHO = (arg("--who") || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const OUT = ".env.team-credentials";

/**
 * Readable, but not guessable.
 *
 * Two words and a number would be typo-proof and weak. Random base64url is
 * strong and miserable to read aloud. This splits the difference: 18 random
 * characters from an alphabet with no 0/O/1/l/I, grouped in threes, so it
 * survives being read off a screen without collapsing the search space --
 * about 96 bits, and every one different.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
function makePassword() {
  const bytes = randomBytes(18);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]);
  return chars.join("").replace(/(.{6})(?=.)/g, "$1-") + "!7";
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

const { data: listed, error } = await db.auth.admin.listUsers({ perPage: 200 });
if (error) {
  console.error("could not list users:", error.message);
  process.exit(1);
}
const { data: memberships } = await db
  .from("memberships")
  .select("user_id, role, is_active, profile:profiles(full_name)");
const byId = new Map((memberships ?? []).map((m) => [m.user_id, m]));
const one = (v) => (Array.isArray(v) ? v[0] : v);

const targets = listed.users.filter((u) => {
  const m = byId.get(u.id);
  if (!m || !m.is_active) return false;
  const name = (one(m.profile)?.full_name ?? "").toLowerCase();
  const email = (u.email ?? "").toLowerCase();
  if (WHO.length) return WHO.some((w) => email.startsWith(w) || name.includes(w));
  if (ALL) return true;
  return !u.last_sign_in_at;
});

if (targets.length === 0) {
  console.log("Nobody matched. Try --all, or --who <name-or-email-prefix>.");
  process.exit(0);
}

if (DRY) {
  console.log(`would set a new password for ${targets.length} account(s):`);
  for (const u of targets) {
    const m = byId.get(u.id);
    console.log(`  ${(one(m.profile)?.full_name ?? u.email).padEnd(24)} ${m.role.padEnd(8)} ${u.email}`);
  }
  console.log("\nnothing changed (--dry)");
  process.exit(0);
}

const lines = [
  "# Temporary passwords. THIS FILE IS A MASTER KEY TO THE WORKSPACE.",
  "# Every password here is unique and random. Send each person only their",
  "# own line, over something private, tell them to change it in the app,",
  "# and delete this file afterwards.",
  "#",
  "# Gitignored via `.env*`. Never commit it, never paste it into chat.",
  `# generated ${new Date().toISOString()}`,
  "",
];

let ok = 0;
for (const u of targets) {
  const m = byId.get(u.id);
  const name = one(m.profile)?.full_name ?? u.email;
  const password = makePassword();
  const { error: setErr } = await db.auth.admin.updateUserById(u.id, { password });
  if (setErr) {
    console.log(`  FAILED  ${name} — ${setErr.message}`);
    continue;
  }
  lines.push(`# ${name} (${m.role})`, `${u.email}`, `${password}`, "");
  ok++;
  console.log(`  set     ${name.padEnd(24)} ${u.email}`);
}

writeFileSync(OUT, lines.join("\n"), "utf8");
console.log(`\n${ok} password(s) written to ${OUT} — gitignored, not printed here.`);
console.log("Send each person their own line privately; ask them to change it; then delete the file.");
