/**
 * Hand each teammate a one-time link that signs them in and lets them set
 * their own password.
 *
 *   node scripts/team-links.mjs                    # everyone who has never signed in
 *   node scripts/team-links.mjs --all              # everyone
 *   node scripts/team-links.mjs --who usama,yusuf  # by email prefix or name
 *   node scripts/team-links.mjs --site https://tilted-needle0.vercel.app
 *
 * WHY LINKS AND NOT PASSWORDS
 *
 * There is no way to answer "what is that user's password". Supabase stores a
 * one-way hash; no view, export or admin call returns one, and anything that
 * claims to is quietly resetting it. sendPasswordReset() in app/actions.ts
 * says exactly this, and it is the app's stated position: hand the account
 * back to its owner, never handle the secret.
 *
 * A recovery link keeps that promise. It is single-use, it expires, the
 * person who clicks it chooses their own password, and at no point does a
 * plaintext credential exist for anyone -- including whoever runs this -- to
 * lose.
 *
 * WHY THE IN-APP "RESET LINK" BUTTON CANNOT DO THIS TODAY
 *
 * It calls resetPasswordForEmail, which EMAILS the link. Every seeded account
 * is on @tiltedneedle.test, and .test is reserved by RFC 2606 precisely so it
 * never resolves -- those mails are undeliverable by design, so the button
 * reports success and nothing ever arrives. 13 of 14 accounts have never
 * signed in, which is the visible consequence.
 *
 * This generates the same link through the admin API and writes it to disk
 * instead of posting it, so it works regardless of whether mail is set up.
 *
 * THE OUTPUT IS A CREDENTIAL. It goes to .env.team-links, which .gitignore
 * already covers via `.env*`, and is never printed. Anyone holding a line
 * from that file can become that user until it is used or expires. Send each
 * person only their own, over something private, and delete the file after.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync("./.env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);

const arg = (flag, fallback = null) => {
  const i = process.argv.indexOf(flag);
  // indexOf returns -1 when absent, and argv[0] is the node binary -- reading
  // argv[i + 1] off a miss hands you the interpreter path as a value.
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const SITE = arg("--site", env.NEXT_PUBLIC_SITE_URL || "https://tilted-needle0.vercel.app");
const ALL = process.argv.includes("--all");
const WHO = (arg("--who") || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const OUT = ".env.team-links";

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

const { data: listed, error: listErr } = await db.auth.admin.listUsers({ perPage: 200 });
if (listErr) {
  console.error("could not list users:", listErr.message);
  process.exit(1);
}

const { data: memberships } = await db
  .from("memberships")
  .select("user_id, role, is_active, profile:profiles(full_name)");
const byId = new Map((memberships ?? []).map((m) => [m.user_id, m]));

const one = (v) => (Array.isArray(v) ? v[0] : v);

const targets = listed.users.filter((u) => {
  const m = byId.get(u.id);
  if (!m || !m.is_active) return false;           // no link for a revoked seat
  const name = (one(m.profile)?.full_name ?? "").toLowerCase();
  const email = (u.email ?? "").toLowerCase();
  if (WHO.length) return WHO.some((w) => email.startsWith(w) || name.includes(w));
  if (ALL) return true;
  return !u.last_sign_in_at;                       // the default: never signed in
});

if (targets.length === 0) {
  console.log("Nobody matched. Use --all, or --who <name-or-email-prefix>.");
  process.exit(0);
}

const lines = [
  "# One-time sign-in links. EACH LINE IS A CREDENTIAL.",
  "# Single-use and expiring: clicking one signs that person in and prompts",
  "# them to set a password. Send each person only their own line, privately,",
  "# then delete this file. Gitignored via `.env*`; never commit it.",
  `# generated ${new Date().toISOString()} for ${SITE}`,
  "",
];

let ok = 0;
for (const u of targets) {
  const m = byId.get(u.id);
  const name = one(m.profile)?.full_name ?? u.email;
  const { data, error } = await db.auth.admin.generateLink({
    type: "recovery",
    email: u.email,
    options: { redirectTo: `${SITE}/auth/reset` },
  });
  if (error) {
    console.log(`  FAILED  ${name} <${u.email}> — ${error.message}`);
    continue;
  }
  lines.push(`# ${name} (${m.role})`, `${u.email}=${data.properties.action_link}`, "");
  ok++;
  console.log(`  ready   ${name} <${u.email}>`);
}

writeFileSync(OUT, lines.join("\n"), "utf8");
console.log(`\n${ok} link(s) written to ${OUT} (gitignored, not printed here).`);
console.log("Send each person only their own line, then delete the file.");
