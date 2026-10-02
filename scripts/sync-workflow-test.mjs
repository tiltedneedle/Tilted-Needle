// The scheduled sync's shell loop, run for real against a stand-in route.
//   npm run test:syncworkflow
//
// WHY THIS IS WORTH RUNNING THE ACTUAL SCRIPT
//
// The loop in .github/workflows/sync.yml decides how many requests a pass
// makes and whether the run goes red, and it has been wrong in more than one
// way: first it never recognised the end of a pass and ran every request the
// safety cap allowed, then -- for seven weeks, unnoticed -- it stopped one
// request early and left one account of each nine-account platform out of
// every run. Neither failed anything. A workflow can only be exercised by
// pushing it, so each was found in production, by reading logs.
//
// So this lifts the `run:` block out of the workflow file, unmodified, and
// runs it under bash against a local server that plays the route. What is
// asserted is what the route was asked and what the job concluded.
//
// Needs bash and curl -- always present on the CI runner, and on Windows
// through Git for Windows. Skips, loudly, where there is no bash to run it.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  if (ok) pass++;
  else fail++;
};

/* ---- Find a bash that runs natively -------------------------------------- */
function findBash() {
  if (process.platform !== "win32") return "bash";
  // Not whatever `bash` is on PATH: on Windows that can be WSL's launcher,
  // which runs in another filesystem and cannot see this server on loopback.
  const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs")];
  for (const root of roots) {
    if (!root) continue;
    const candidate = join(root, "Git", "bin", "bash.exe");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
const BASH = findBash();
if (!BASH || spawnSync(BASH, ["-c", "command -v curl"], { encoding: "utf8" }).status !== 0) {
  console.log("SKIP  no native bash with curl on this machine -- the CI runner covers this suite");
  process.exit(0);
}

/* ---- Lift the step's script out of the workflow, untouched --------------- */
const workflow = readFileSync(new URL("../.github/workflows/sync.yml", import.meta.url), "utf8")
  .replace(/\r\n/g, "\n");
const lines = workflow.split("\n");
const runAt = lines.findIndex((l) => /^\s+run: \|\s*$/.test(l));
const indent = lines[runAt].match(/^\s*/)[0].length + 2;
const body = [];
for (const line of lines.slice(runAt + 1)) {
  if (line.trim() !== "" && line.match(/^\s*/)[0].length < indent) break;
  body.push(line.slice(indent));
}
const script = body.join("\n");
check("the workflow's script was found", /for platform in instagram tiktok youtube youtube_shorts/.test(script));

const MAX = Number(script.match(/^MAX=(\d+)$/m)?.[1]);
const BATCHES = Number(script.match(/^BATCHES=(\d+)$/m)?.[1]);
check("it declares a batch size and a request cap", MAX > 0 && BATCHES > 0, `MAX=${MAX} BATCHES=${BATCHES}`);

/* ---- A stand-in for the route -------------------------------------------- */

/**
 * A platform with `total` accounts, where each request can finish `perRequest`
 * of them. Mirrors what the real route reports: `eligible` is counted before
 * the request takes its batch, and so shrinks as the pass goes.
 */
function passOf(total, { perRequest = MAX, cutShort = 0, modern = true } = {}) {
  let left = total;
  return () => {
    const eligible = left;
    const finished = Math.min(perRequest, MAX, left);
    left -= finished;
    // An account the time budget interrupted: attempted, read in part, and
    // still on the list for the next request.
    const partial = left > 0 ? cutShort : 0;
    const accounts = finished + partial;
    const res = {
      ok: true, durationMs: 1234, accounts, eligible, synced: accounts, skipped: 0, failed: 0,
      snapshotsWritten: accounts * 3, postsCreated: 0, results: [],
    };
    // A deployment from before the route reported these has neither field.
    if (modern) Object.assign(res, { remaining: left, partial, unread: 0 });
    return { status: 200, json: res };
  };
}

const TIMEOUT_PAGE = { status: 504, text: "An error occurred with your deployment\n\nFUNCTION_INVOCATION_TIMEOUT\n" };

async function run(platforms, { secret = "test-secret" } = {}) {
  const seen = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://stub");
    const platform = url.searchParams.get("platform");
    seen.push({
      platform,
      max: url.searchParams.get("max"),
      staleBefore: url.searchParams.get("staleBefore"),
      auth: req.headers.authorization,
    });
    const answer = platforms[platform]?.() ?? { status: 200, json: { ok: true, accounts: 0, eligible: 0, synced: 0, failed: 0, remaining: 0 } };
    if (answer.drop) return void req.socket.destroy();
    res.writeHead(answer.status, { "content-type": answer.json ? "application/json" : "text/plain" });
    res.end(answer.json ? JSON.stringify(answer.json) : answer.text);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));

  const dir = mkdtempSync(join(tmpdir(), "sync-workflow-"));
  writeFileSync(join(dir, "step.sh"), script);
  const child = spawn(BASH, ["step.sh"], {
    cwd: dir,
    env: {
      ...process.env,
      CRON_SECRET: secret,
      SITE_URL: `http://127.0.0.1:${server.address().port}`,
      GITHUB_STEP_SUMMARY: join(dir, "summary.md"),
    },
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const code = await new Promise((r) => child.on("close", r));
  await new Promise((r) => server.close(r));
  const summary = existsSync(join(dir, "summary.md")) ? readFileSync(join(dir, "summary.md"), "utf8") : "";
  rmSync(dir, { recursive: true, force: true });

  const count = (p) => seen.filter((s) => s.platform === p).length;
  return { code, out, summary, seen, count, warnings: out.split("\n").filter((l) => l.startsWith("::warning::")), errors: out.split("\n").filter((l) => l.startsWith("::error::")) };
}

/* ---- A healthy pass, with the account counts production has -------------- */
{
  const r = await run({
    instagram: passOf(9), tiktok: passOf(9), youtube: passOf(4), youtube_shorts: passOf(7),
  });
  check("healthy: the job passes", r.code === 0, r.code === 0 ? "" : r.out.slice(-300));
  // The regression. Nine accounts at four a request is three requests; the
  // old loop made two and left the ninth account out of every run.
  check("healthy: nine accounts take three requests, not two",
    r.count("instagram") === 3 && r.count("tiktok") === 3,
    `instagram ${r.count("instagram")}, tiktok ${r.count("tiktok")}`);
  check("healthy: four accounts take one, seven take two",
    r.count("youtube") === 1 && r.count("youtube_shorts") === 2);
  check("healthy: nothing is warned about", r.warnings.length === 0 && r.errors.length === 0, r.warnings.join(" | "));
  check("every request carries the secret and the batch size",
    r.seen.every((s) => s.auth === "Bearer test-secret" && s.max === String(MAX)));
  check("every request of a run is pinned to the same instant",
    new Set(r.seen.map((s) => s.staleBefore)).size === 1 && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(r.seen[0].staleBefore),
    r.seen[0].staleBefore);
  check("the summary has a line per request", r.summary.trim().split("\n").length === r.seen.length);
}

/* ---- A slow platform: the time budget shortens every request ------------- */
{
  // Two accounts finished per request and a third cut off partway -- what
  // TikTok looks like on a bad day once the route stops at its budget.
  const r = await run({
    instagram: passOf(9), tiktok: passOf(9, { perRequest: 2, cutShort: 1 }),
    youtube: passOf(4), youtube_shorts: passOf(7),
  });
  check("slow platform: the job still passes", r.code === 0, r.code === 0 ? "" : r.out.slice(-300));
  check("slow platform: it keeps asking until the pass is finished",
    r.count("tiktok") === 5, `${r.count("tiktok")} requests`);
  check("slow platform: a short batch is not mistaken for the end",
    r.warnings.length === 0, r.warnings.join(" | "));
  check("slow platform: the summary says requests were cut short",
    /tiktok batch 1: .*1 cut short.*7 left/.test(r.summary), r.summary.split("\n").find((l) => l.startsWith("tiktok")) ?? "");
}

/* ---- Too slow to finish inside the cap ----------------------------------- */
{
  const r = await run({
    instagram: passOf(9), tiktok: passOf(9, { perRequest: 1 }),
    youtube: passOf(4), youtube_shorts: passOf(7),
  });
  check("unfinished pass: stops at the request cap", r.count("tiktok") === BATCHES, `${r.count("tiktok")} requests`);
  check("unfinished pass: says how many accounts are left, as a warning",
    r.warnings.some((w) => /tiktok: 3 account\(s\) not finished/.test(w)), r.warnings.join(" | "));
  check("unfinished pass: slow is not broken -- the job passes", r.code === 0 && r.errors.length === 0);
  check("unfinished pass: the platforms after it still run",
    r.count("youtube") === 1 && r.count("youtube_shorts") === 2);
}

/* ---- The function is killed mid-request (HTTP 504) ----------------------- */
{
  // What happened in production: the request times out, having already
  // finished three of its four accounts. Asked again, the route carries on.
  let n = 0;
  let left = 9;
  const tiktok = () => {
    n++;
    if (n === 2) { left -= 3; return TIMEOUT_PAGE; }
    const eligible = left;
    const done = Math.min(MAX, left);
    left -= done;
    return { status: 200, json: { ok: true, durationMs: 1, accounts: done, eligible, synced: done, failed: 0, snapshotsWritten: 0, postsCreated: 0, remaining: left, partial: 0, unread: 0 } };
  };
  const r = await run({ instagram: passOf(9), tiktok, youtube: passOf(4), youtube_shorts: passOf(7) });
  check("504 once: it asks again instead of giving up", r.count("tiktok") === 3 && left === 0, `${r.count("tiktok")} requests, ${left} left`);
  check("504 once: the job passes, with the timeout on record as a warning",
    r.code === 0 && r.warnings.some((w) => /tiktok: batch 2 timed out \(HTTP 504\)/.test(w)), r.warnings.join(" | "));
}
{
  const r = await run({ instagram: passOf(9), tiktok: () => TIMEOUT_PAGE, youtube: passOf(4), youtube_shorts: passOf(7) });
  check("504 twice: asked again once, then it is a failure",
    r.count("tiktok") === 2 && r.errors.some((e) => /tiktok sync failed \(HTTP 504\)/.test(e)), `${r.count("tiktok")} requests`);
  check("504 twice: the job fails", r.code === 1);
  check("504 twice: the platforms after it still run", r.count("youtube") === 1 && r.count("youtube_shorts") === 2);
}
{
  // Instagram's reads are paid for. The account in flight when the function
  // died would be billed again, so its timeout is never retried.
  const r = await run({ instagram: () => TIMEOUT_PAGE, tiktok: passOf(9), youtube: passOf(4), youtube_shorts: passOf(7) });
  check("504 on the paid platform: not asked again", r.count("instagram") === 1, `${r.count("instagram")} requests`);
  check("504 on the paid platform: the job fails, the rest still run",
    r.code === 1 && r.count("tiktok") === 3 && r.count("youtube") === 1);
}

/* ---- Other ways a request goes wrong ------------------------------------- */
{
  const r = await run({ instagram: passOf(9), tiktok: () => ({ status: 401, json: { error: "Unauthorised." } }), youtube: passOf(4), youtube_shorts: passOf(7) });
  check("a 401 fails the job on the first request, with the body printed",
    r.code === 1 && r.count("tiktok") === 1 && /Unauthorised/.test(r.out));
}
{
  // The connection drops with no response at all. curl exits non-zero, and
  // under `set -e` that used to end the script there and then.
  const r = await run({ instagram: () => ({ drop: true }), tiktok: passOf(9), youtube: passOf(4), youtube_shorts: passOf(7) });
  check("a dropped connection fails that platform only",
    r.errors.some((e) => /instagram sync failed \(HTTP 000\)/.test(e)) && r.count("tiktok") === 3 && r.count("youtube_shorts") === 2,
    r.errors.join(" | "));
  check("a dropped connection fails the job", r.code === 1);
}
{
  const allFailed = () => ({ status: 200, json: { ok: false, durationMs: 1, accounts: 4, eligible: 9, synced: 0, failed: 4, snapshotsWritten: 0, postsCreated: 0, remaining: 5, partial: 0, unread: 0 } });
  const r = await run({ instagram: passOf(9), tiktok: allFailed, youtube: passOf(4), youtube_shorts: passOf(7) });
  check("every account failing is an outage: one request, job fails",
    r.code === 1 && r.count("tiktok") === 1 && r.errors.some((e) => /tiktok: every account in this batch failed/.test(e)));
}
{
  let n = 0;
  const someFailed = () => (++n === 1
    ? { status: 200, json: { ok: false, durationMs: 1, accounts: 4, eligible: 5, synced: 3, failed: 1, snapshotsWritten: 0, postsCreated: 0, remaining: 1, partial: 0, unread: 0 } }
    : { status: 200, json: { ok: true, durationMs: 1, accounts: 1, eligible: 1, synced: 1, failed: 0, snapshotsWritten: 0, postsCreated: 0, remaining: 0, partial: 0, unread: 0 } });
  const r = await run({ instagram: passOf(9), tiktok: someFailed, youtube: passOf(4), youtube_shorts: passOf(7) });
  check("one account failing is a warning, and the pass carries on",
    r.code === 0 && r.count("tiktok") === 2 && r.warnings.some((w) => /tiktok: 1 of 4 accounts failed/.test(w)));
}
{
  // Skipped accounts are never stamped, so they stay on the list for good. A
  // request that finished nothing must not be sent again and again.
  const nothing = () => ({ status: 200, json: { ok: true, durationMs: 1, accounts: 4, eligible: 6, synced: 0, skipped: 4, failed: 0, snapshotsWritten: 0, postsCreated: 0, remaining: 2, partial: 0, unread: 0 } });
  const r = await run({ instagram: passOf(9), tiktok: nothing, youtube: passOf(4), youtube_shorts: passOf(7) });
  check("a request that finished nothing is not repeated", r.count("tiktok") === 1 && r.code === 0);
}

/* ---- Between the workflow landing and the route deploying ---------------- */
{
  // The workflow file takes effect on push; the route a few minutes later. A
  // run in that window talks to a route that reports no `remaining`.
  const old = { modern: false };
  const r = await run({
    instagram: passOf(9, old), tiktok: passOf(9, old), youtube: passOf(4, old), youtube_shorts: passOf(7, old),
  });
  check("older route: the pass still completes, ninth account included",
    r.code === 0 && r.count("instagram") === 3 && r.count("tiktok") === 3 && r.count("youtube") === 1 && r.count("youtube_shorts") === 2,
    `${r.count("instagram")}/${r.count("tiktok")}/${r.count("youtube")}/${r.count("youtube_shorts")}`);
}

/* ---- Not configured ------------------------------------------------------ */
{
  const r = await run({ instagram: passOf(9) }, { secret: "" });
  check("no secret: exits green without calling anything", r.code === 0 && r.seen.length === 0 && /CRON_SECRET is not set/.test(r.out));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
