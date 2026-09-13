// A host only claims transcript work it can actually fetch.
//   node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/host-platforms-test.mjs
//
// The bug this pins: a datacenter worker handed a YouTube transcript job gets
// "Sign in to confirm you're not a bot", which cools the whole kind for two
// hours and stalls every TikTok and Instagram job behind it. The worker must
// hand such a job back UNTOUCHED -- no attempt, no verdict, no cooldown.
import { hostPlatforms } from "../worker/platforms.mjs";
import { transcript } from "../worker/jobs/transcript.mjs";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

/* ---- Parsing --------------------------------------------------------------- */
check("unset means any platform", hostPlatforms({}) === null);
check("empty means any platform (an unset CI secret interpolates to \"\")", hostPlatforms({ TRANSCRIPT_PLATFORMS: "  " }) === null);
{
  const s = hostPlatforms({ TRANSCRIPT_PLATFORMS: " tiktok, instagram ,, " });
  check("a list parses with whitespace and empties dropped",
    s instanceof Set && s.size === 2 && s.has("tiktok") && s.has("instagram"));
}

/* ---- The gate, against a fake database ------------------------------------ */
// Minimal chainable stub: platform_posts answers with `rows`; any other table
// throws a sentinel, which is how we know the handler got PAST the gate.
const PAST_GATE = new Error("PAST_GATE");
function fakeDb(rows, { transcribed = false } = {}) {
  const chain = (table) => {
    const q = {
      select: () => q, eq: () => q, not: () => q, is: () => q, order: () => q, limit: () => q,
      // video_transcripts lookup: the "already done by another lane" guard.
      maybeSingle: () => Promise.resolve({
        data: table === "video_transcripts" && transcribed ? { content_item_id: "item1" } : null, error: null,
      }),
      then: (res, rej) => table === "platform_posts"
        ? Promise.resolve({ data: rows, error: null }).then(res, rej)
        : Promise.reject(PAST_GATE).then(res, rej),
    };
    return q;
  };
  return { from: chain, rpc: () => Promise.reject(PAST_GATE) };
}
const post = (slug, id) => ({ id, external_id: "x" + id, url: "https://example/" + id, account: { platform_slug: slug } });
const job = { id: "job1", subject_id: "item1", kind: "transcript", attempts: 0 };
const log = () => {};

async function run(rows, env, opts) {
  const saved = process.env.TRANSCRIPT_PLATFORMS;
  if (env === undefined) delete process.env.TRANSCRIPT_PLATFORMS; else process.env.TRANSCRIPT_PLATFORMS = env;
  try { return { result: await transcript({ db: fakeDb(rows, opts), job, log }) }; }
  catch (e) { return { error: e }; }
  finally { if (saved === undefined) delete process.env.TRANSCRIPT_PLATFORMS; else process.env.TRANSCRIPT_PLATFORMS = saved; }
}

{
  const r = await run([post("youtube", 1)], "tiktok,instagram");
  check("a YouTube-only item is SKIPPED by a tiktok/instagram host", r.result?.skip === true, JSON.stringify(r.result ?? String(r.error)));
  check("and the note names both what it is posted on and what the host serves",
    /youtube/.test(r.result?.note ?? "") && /tiktok/.test(r.result?.note ?? ""), r.result?.note);
}
{
  const r = await run([post("youtube_shorts", 2)], "tiktok,instagram");
  check("Shorts count as YouTube for this purpose", r.result?.skip === true);
}
{
  const r = await run([post("youtube", 1), post("tiktok", 3)], "tiktok,instagram");
  check("a cross-posted item is NOT skipped -- it proceeds on the copy this host can fetch",
    r.result?.skip !== true, r.error ? String(r.error.message) : JSON.stringify(r.result));
}
{
  const r = await run([post("youtube", 1)], undefined);
  check("with no allowlist nothing is skipped (the desktop can fetch anything)", r.result?.skip !== true);
}
{
  const r = await run([post("instagram", 4)], "tiktok,instagram");
  check("an Instagram-only item proceeds to the audio lane rather than being skipped", r.result?.skip !== true);
}

/* ---- A stale job settles anywhere, before the host gate ------------------- */
{
  // 40 of 58 pending TikTok jobs on the Phoenix box were for items Apify had
  // already transcribed. Each was fetched again and overwritten with the same
  // text. The guard runs FIRST so even a job this host could not fetch is
  // closed rather than skipped and handed on.
  const r = await run([post("youtube", 1)], "tiktok,instagram", { transcribed: true });
  check("an already-transcribed item is settled, not skipped, even on a host that cannot fetch it",
    r.result?.unavailable === true && /already/.test(r.result?.note ?? ""), JSON.stringify(r.result ?? String(r.error)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
