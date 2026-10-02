// The sync's time budget: a slow platform must cost extra requests, never a
// dead one.
//   npm run test:syncbudget
//
// WHY THIS EXISTS
//
// From 24 September the scheduled sync began failing about one run in three.
// Nothing had been deployed. TikTok's embed endpoint had started shedding load
// -- "503 overload-protect triggered" on half the requests, seconds rather
// than milliseconds on the rest -- and the sync read every tracked video one
// request at a time, with no timeout on any of them and no idea how long it
// had been going. Four accounts that used to take under a minute took four or
// five, the request after them was killed at the 300-second limit, and the
// job went red for a run that had, in fact, synced most of what it was sent
// for.
//
// The fix is a clock: past a deadline nothing new starts, what was read is
// kept, and the caller is told what is left. That only works if four things
// hold, and none of them fails loudly when broken -- the sync would simply go
// back to timing out on TikTok's next bad day, or quietly stop reading the
// tail of a large account:
//
//   1. a read stops AT the deadline and says how much it did not reach
//   2. an account cut short is not marked synced, and the next request
//      carries on from where it stopped instead of starting again
//   3. posts that went unread are the first ones read next time
//   4. the caller is told how many accounts are left, correctly
//
// Offline. fetch is mocked, the database is a stand-in, and the clock is
// advanced by hand, so nothing here waits and nothing is spent.
import { readFileSync } from "node:fs";
import { readOrder, accountsRemaining, SYNC_BUDGET_MS } from "../src/lib/syncBudget.ts";
import { readEmbedMetrics } from "../src/lib/providers/tiktok.ts";
import { PROVIDERS } from "../src/lib/providers/index.ts";
import { runSync } from "../src/lib/syncRunner.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  if (ok) pass++;
  else fail++;
};

/* A clock the tests move by hand. Only Date.now() is steered -- which is what
   every deadline check reads -- so stamps written with `new Date()` stay on
   the real clock and remain comparable with a real staleBefore. */
const realNow = Date.now;
let skew = 0;
const spend = (ms) => { skew += ms; };
Date.now = () => realNow() + skew;

/* ---- Which posts are read, and in what order ----------------------------- */
{
  const posts = [
    { externalId: "read-yesterday", lastScrapedAt: "2026-10-01T09:00:00+00:00" },
    { externalId: "never-a", lastScrapedAt: null },
    { externalId: "read-last-week", lastScrapedAt: "2026-09-25T09:00:00+00:00" },
    { externalId: "never-b" },
  ];
  check("never-read posts come first, then the longest unread",
    readOrder(posts).join() === "never-a,never-b,read-last-week,read-yesterday",
    readOrder(posts).join());

  const untouched = [{ externalId: "x" }, { externalId: "y" }, { externalId: "z" }];
  check("with no stamps at all the order is the one it arrived in",
    readOrder(untouched).join() === "x,y,z");

  const pin = "2026-10-02T09:54:36Z";
  const midPass = [
    { externalId: "done-this-pass", lastScrapedAt: "2026-10-02T09:58:00.123456+00:00" },
    { externalId: "done-last-run", lastScrapedAt: "2026-10-02T00:55:00+00:00" },
    { externalId: "never" },
  ];
  check("a post already read this pass is not read again",
    readOrder(midPass, pin).join() === "never,done-last-run", readOrder(midPass, pin).join());
  check("a post read exactly at the pin counts as read this pass",
    readOrder([{ externalId: "p", lastScrapedAt: pin }], pin).length === 0);
  check("without a pin nothing is left out",
    readOrder(midPass).length === 3);

  // The failure worth guarding: a value that will not parse must read as
  // "not yet", never as "done" -- the second would hide a post for good.
  check("an unreadable pin hides nothing",
    readOrder(midPass, "not-a-date").length === 3);
  check("an unreadable stamp is treated as never read",
    readOrder([{ externalId: "a", lastScrapedAt: "2026-10-01T00:00:00Z" }, { externalId: "b", lastScrapedAt: "garbage" }], pin).join() === "b,a");
}

/* ---- How many accounts are left ------------------------------------------ */
{
  // Nine accounts, four per request -- the case the old arithmetic got wrong.
  // It divided `eligible` by the batch size on EVERY request and compared the
  // answer with the number of requests made so far; `eligible` shrinks as the
  // pass goes, so on the second request it read ceil(5/4) = 2 and stopped,
  // one account short, every run.
  const four = [{}, {}, {}, {}];
  check("nine accounts: five left after the first request", accountsRemaining(9, four) === 5);
  check("nine accounts: one left after the second -- not zero", accountsRemaining(5, four) === 1);
  check("nine accounts: none left after the third", accountsRemaining(1, [{}]) === 0);

  check("an account cut short is still left to do",
    accountsRemaining(9, [{}, {}, { partial: true }]) === 7);
  check("a request that started nothing leaves everything",
    accountsRemaining(9, []) === 9);
  check("never negative", accountsRemaining(0, [{}]) === 0);
}

/* ---- The budget fits inside the route's limit ---------------------------- */
{
  const route = readFileSync(new URL("../src/app/api/sync/route.ts", import.meta.url), "utf8");
  const maxDuration = Number(route.match(/export const maxDuration = (\d+)/)?.[1]);
  check("the route still declares a maxDuration", Number.isFinite(maxDuration) && maxDuration > 0, String(maxDuration));
  // Work already in flight when the budget runs out still has to finish. A
  // YouTube or Instagram account cannot be interrupted, and one has taken the
  // best part of a minute.
  check("at least 100 seconds are left for work in flight",
    maxDuration * 1000 - SYNC_BUDGET_MS >= 100_000,
    `${SYNC_BUDGET_MS / 1000}s of ${maxDuration}s`);
  check("the route hands the budget to the sync",
    /deadline:\s*started \+ SYNC_BUDGET_MS/.test(route));

  const workflow = readFileSync(new URL("../.github/workflows/sync.yml", import.meta.url), "utf8");
  const maxTime = Number(workflow.match(/--max-time (\d+)/)?.[1]);
  check("the workflow waits longer than the route can run",
    maxTime > maxDuration, `curl ${maxTime}s vs route ${maxDuration}s`);
}

/* ---- The TikTok read: bounded per request, paced, and stoppable ---------- */
const embedPage = (id, plays) =>
  `<html><script id="__FRONTITY_CONNECT_STATE__" type="application/json">${JSON.stringify({
    source: { data: { [`/embed/v2/${id}`]: { videoData: { itemInfos: { id, playCount: plays, diggCount: 3, commentCount: 1 } } } } },
  })}</script></html>`;
const idOf = (url) => String(url).split("/").pop();
const realFetch = globalThis.fetch;

{
  // Every request is followed by the gap -- including a refused one. The
  // pause used to sit below the `continue` that a refusal takes, so a run of
  // 503s went out back to back with no gap at all.
  const starts = [];
  const answers = { a: 503, b: 503, c: 200, d: 429, e: 200 };
  globalThis.fetch = async (url) => {
    starts.push(performance.now());
    const id = idOf(url);
    return answers[id] === 200
      ? new Response(embedPage(id, 100), { status: 200 })
      : new Response("overload-protect triggered", { status: answers[id] });
  };
  const res = await readEmbedMetrics(["a", "b", "c", "d", "e"], {}, 40);
  const gaps = starts.slice(1).map((t, i) => t - starts[i]);
  check("refused requests are paced like any other",
    gaps.length === 4 && Math.min(...gaps) >= 30,
    `gaps ${gaps.map((g) => Math.round(g)).join(", ")}ms`);
  check("what was served is returned", res.ok && res.data.map((m) => m.externalId).join() === "c,e");
  check("what was refused is counted, not zeroed", res.ok && res.failed === 3 && res.unattempted === 0,
    JSON.stringify({ failed: res.failed, unattempted: res.unattempted }));
  check("a served reading carries the page's numbers",
    res.ok && res.data[0].views === 100 && res.data[0].likes === 3 && res.data[0].comments === 1);
}
{
  // A request that never answers. With no timeout the only thing that could
  // end it was the function being killed around it.
  const hang = (signal) =>
    new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
  // AbortSignal.timeout's timer does not hold the process open by itself. A
  // real request has a socket doing that; this stand-in has nothing, so
  // without a timer of its own Node would exit mid-await.
  const holdOpen = setInterval(() => {}, 1000);
  globalThis.fetch = async (url, opts) => {
    const id = idOf(url);
    if (id === "stuck") return hang(opts.signal);
    return new Response(embedPage(id, 7), { status: 200 });
  };
  const t0 = performance.now();
  const res = await readEmbedMetrics(["stuck", "fine"], {}, 0, 60);
  const took = performance.now() - t0;
  check("a request that never answers is abandoned", took < 2000, `${Math.round(took)}ms`);
  check("and the videos after it are still read",
    res.ok && res.data.length === 1 && res.data[0].externalId === "fine" && res.failed === 1);

  const dead = await readEmbedMetrics(["stuck"], {}, 0, 60);
  check("nothing readable at all is an error that says why",
    dead.ok === false && /No TikTok metrics could be read/.test(dead.error) && /no answer within/.test(dead.error),
    dead.ok ? "" : dead.error);
  clearInterval(holdOpen);
}
{
  // The deadline. Each request "takes" ten seconds of the hand-moved clock.
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    spend(10_000);
    return new Response(embedPage(idOf(url), calls), { status: 200 });
  };
  const ids = ["v1", "v2", "v3", "v4", "v5"];
  const res = await readEmbedMetrics(ids, { deadline: Date.now() + 25_000 }, 0);
  check("the read stops at the deadline", calls === 3, `${calls} requests`);
  check("and reports what it did not reach",
    res.ok && res.data.length === 3 && res.unattempted === 2 && res.failed === 0,
    JSON.stringify({ read: res.ok && res.data.length, unattempted: res.unattempted }));

  calls = 0;
  const late = await readEmbedMetrics(ids, { deadline: Date.now() - 1 }, 0);
  check("already out of time: nothing is asked", calls === 0);
  check("and that is not an error -- there was no time, not no answer",
    late.ok === true && late.data.length === 0 && late.unattempted === 5);

  calls = 0;
  const open = await readEmbedMetrics(ids, {}, 0);
  check("with no deadline every video is read, as before",
    calls === 5 && open.ok && open.data.length === 5 && open.unattempted === 0);

  // Cut short AND nothing served: still an error. A platform that is turning
  // everything away must fail the account loudly, not hide behind "ran out
  // of time" and be retried politely forever.
  globalThis.fetch = async () => {
    spend(10_000);
    return new Response("overload-protect triggered", { status: 503 });
  };
  const refused = await readEmbedMetrics(ids, { deadline: Date.now() + 15_000 }, 0);
  check("cut short with nothing served is still an error", refused.ok === false);
}
{
  // Gone is gone: a deleted video is absent from the result, never a zero.
  globalThis.fetch = async (url) => {
    const id = idOf(url);
    return id === "deleted"
      ? new Response("", { status: 404 })
      : new Response(embedPage(id, 55), { status: 200 });
  };
  const res = await readEmbedMetrics(["deleted", "alive"], {}, 0);
  check("a deleted video is left out rather than recorded as zero",
    res.ok && res.data.length === 1 && res.data[0].externalId === "alive" && res.failed === 1);
}
globalThis.fetch = realFetch;

/* ---- The runner: cut short, resumed, and finished ------------------------ */

/** Just enough of the Supabase query builder for the free sync path. */
function fakeDb(tables) {
  let seq = 0;
  class Query {
    constructor(table) {
      this.table = table;
      this.op = "select";
      this.filters = [];
    }
    select() { return this; }
    insert(rows) { this.op = "insert"; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
    update(patch) { this.op = "update"; this.payload = patch; return this; }
    eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
    is(c, v) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
    not(c, _op, v) { this.filters.push((r) => (r[c] ?? null) !== v); return this; }
    in(c, vs) { this.filters.push((r) => vs.includes(r[c])); return this; }
    lt(c, v) { this.filters.push((r) => r[c] != null && r[c] < v); return this; }
    or(expr) {
      const m = expr.match(/^(\w+)\.is\.null,\1\.lt\.(.+)$/);
      if (!m) throw new Error(`fake db: unsupported or(): ${expr}`);
      this.filters.push((r) => r[m[1]] == null || Date.parse(r[m[1]]) < Date.parse(m[2]));
      return this;
    }
    order(c, o = {}) { this.sort = { c, asc: o.ascending !== false }; return this; }
    limit(n) { this.max = n; return this; }
    single() { this.one = true; return this; }
    then(resolve, reject) {
      return Promise.resolve().then(() => this.run()).then(resolve, reject);
    }
    run() {
      const rows = (tables[this.table] ??= []);
      if (this.op === "insert") {
        const made = this.payload.map((p) => ({
          id: `${this.table}-${++seq}`,
          // Strictly increasing, so "latest snapshot" is well defined.
          captured_at: new Date(realNow() + seq).toISOString(),
          ...p,
        }));
        rows.push(...made);
        return { data: this.one ? made[0] : made, error: null };
      }
      let hit = rows.filter((r) => this.filters.every((f) => f(r)));
      if (this.op === "update") {
        for (const r of hit) Object.assign(r, this.payload);
        return { data: null, error: null };
      }
      if (this.sort) {
        const { c, asc } = this.sort;
        // Nulls first when ascending -- the only way the runner orders.
        hit = [...hit].sort((a, b) => {
          const x = a[c] ?? "", y = b[c] ?? "";
          return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
        });
      }
      if (this.max != null) hit = hit.slice(0, this.max);
      return { data: this.one ? (hit[0] ?? null) : hit.map((r) => ({ ...r })), error: null };
    }
  }
  return { from: (t) => new Query(t), rpc: async () => ({ data: [], error: null }) };
}

/** A stand-in platform: one "request" per post, each costing ten seconds. */
const asked = [];
const refuse = new Set();
PROVIDERS.testplatform = {
  slug: "testplatform",
  capability: { canDiscover: false, canFetchMetrics: true, isMetered: false, reason: "test" },
  isConfigured: () => true,
  missingEnv: () => [],
  search: async () => ({ ok: true, data: [] }),
  discover: async () => ({ ok: true, data: [] }),
  async fetchMetrics(ids, options = {}) {
    const out = [];
    let n = 0;
    for (const id of ids) {
      if (options.deadline != null && Date.now() >= options.deadline) break;
      n++;
      asked.push(id);
      spend(10_000);
      if (!refuse.has(id)) out.push({ externalId: id, views: 1000 + asked.length, likes: 1, comments: 0 });
    }
    const failed = n - out.length;
    if (out.length === 0 && failed > 0) return { ok: false, error: "Nothing could be read." };
    return { ok: true, data: out, failed, unattempted: ids.length - n };
  },
};

const account = (id) => ({
  id, workspace_id: "ws", client_id: null, platform_slug: "testplatform", handle: id,
  external_id: null, sync_window_days: null, last_discovered_at: null,
  sync_enabled: true, is_archived: false, last_synced_at: null, last_sync_error: null,
});
const post = (accountId, externalId) => ({
  id: `post-${externalId}`, workspace_id: "ws", account_id: accountId, external_id: externalId,
  content_item_id: `item-${externalId}`, thumbnail_url: "https://example.test/poster.jpg",
  last_scraped_at: null,
});

{
  // Three accounts: five posts, three posts, two posts. Ten seconds a post,
  // 35 seconds a request -- so no request can finish the first account, let
  // alone the batch.
  const tables = {
    accounts: [account("A"), account("B"), account("C")],
    platform_posts: [
      ...["a1", "a2", "a3", "a4", "a5"].map((p) => post("A", p)),
      ...["b1", "b2", "b3"].map((p) => post("B", p)),
      ...["c1", "c2"].map((p) => post("C", p)),
    ],
    post_snapshots: [],
    sync_runs: [],
    clients: [],
  };
  const db = fakeDb(tables);
  const acct = (id) => tables.accounts.find((a) => a.id === id);
  const stamped = (id) => tables.platform_posts.find((p) => p.external_id === id).last_scraped_at != null;

  // When the caller's pass began. Real time, like the workflow's `date -u`.
  const pin = new Date(realNow() - 1000).toISOString();
  const request = async () => {
    let eligible = 0;
    asked.length = 0;
    const results = await runSync(db, {
      platformSlug: "testplatform",
      maxAccounts: 4,
      staleBefore: pin,
      deadline: Date.now() + 35_000,
      onMeta: (m) => { eligible = m.eligible; },
    });
    return { results, eligible, remaining: accountsRemaining(eligible, results) };
  };

  // -- request one: runs out of time inside account A
  const one = await request();
  check("request 1: only the account it had time for is in the results",
    one.results.length === 1 && one.results[0].accountId === "A",
    one.results.map((r) => r.accountId).join());
  check("request 1: that account is reported cut short, and not as a failure",
    one.results[0].partial === true && one.results[0].status === "ok");
  check("request 1: what it read is recorded",
    one.results[0].snapshotsWritten === 4 && tables.post_snapshots.length === 4,
    `${tables.post_snapshots.length} snapshots`);
  check("request 1: the posts it read are stamped, the one it missed is not",
    ["a1", "a2", "a3", "a4"].every(stamped) && !stamped("a5"));
  check("request 1: the account is NOT marked synced", acct("A").last_synced_at === null);
  check("request 1: accounts it never started are untouched, with no run row",
    acct("B").last_synced_at === null && tables.sync_runs.length === 1 && asked.every((id) => id.startsWith("a")));
  check("request 1: its run row is closed, with a note saying it was cut short",
    tables.sync_runs[0].status === "ok" && /Out of time with 1 of 5 posts/.test(tables.sync_runs[0].error ?? ""),
    tables.sync_runs[0].error ?? "");
  check("request 1: all three accounts are still left", one.eligible === 3 && one.remaining === 3,
    `eligible ${one.eligible}, remaining ${one.remaining}`);
  check("each result says how long the account took",
    typeof one.results[0].ms === "number" && one.results[0].ms >= 40_000, `${one.results[0].ms}ms`);

  // -- request two: carries on with A's last post, then B
  const two = await request();
  check("request 2: resumes the cut account with only the post it missed",
    asked[0] === "a5" && !asked.some((id) => ["a1", "a2", "a3", "a4"].includes(id)),
    asked.join());
  check("request 2: that account is now finished and marked synced",
    two.results[0].accountId === "A" && !two.results[0].partial && acct("A").last_synced_at !== null);
  check("request 2: the next account is read in full",
    two.results[1]?.accountId === "B" && !two.results[1].partial && acct("B").last_synced_at !== null);
  check("request 2: the third account is not started, and one is left",
    two.results.length === 2 && acct("C").last_synced_at === null && two.remaining === 1,
    `remaining ${two.remaining}`);

  // -- request three: finishes the pass
  const three = await request();
  check("request 3: finishes the last account, nothing left",
    three.results.length === 1 && three.results[0].accountId === "C" && three.remaining === 0);
  check("the pass read every post exactly once",
    tables.post_snapshots.length === 10 &&
      new Set(tables.post_snapshots.map((s) => s.platform_post_id)).size === 10,
    `${tables.post_snapshots.length} snapshots`);

  // -- a request after the pass is complete has nothing to do
  const four = await request();
  check("a request after the pass is done finds no accounts", four.results.length === 0 && four.eligible === 0);
}

{
  // Refused reads. The account finishes -- every post was asked about -- but
  // the two that got no answer must be the first two asked about next time.
  const tables = {
    accounts: [account("D")],
    platform_posts: ["d1", "d2", "d3", "d4"].map((p) => post("D", p)),
    post_snapshots: [], sync_runs: [], clients: [],
  };
  const db = fakeDb(tables);
  refuse.add("d2").add("d4");
  asked.length = 0;
  const [first] = await runSync(db, { platformSlug: "testplatform" });
  check("refused posts: the account still finishes",
    first.status === "ok" && !first.partial && tables.accounts[0].last_synced_at !== null);
  check("refused posts: they are counted", first.unread === 2 && first.snapshotsWritten === 2,
    JSON.stringify({ unread: first.unread, snapshots: first.snapshotsWritten }));

  refuse.clear();
  asked.length = 0;
  const [second] = await runSync(db, { platformSlug: "testplatform" });
  check("refused posts: they are read first the next time",
    asked.slice(0, 2).join() === "d2,d4", asked.join());
  check("a clean read reports nothing unread", second.unread === undefined);
}

{
  // Everything refused: an error, and the account is stamped so one dead
  // account cannot hold the front of the queue for the rest of the pass.
  const tables = {
    accounts: [account("E"), account("F")],
    platform_posts: [post("E", "e1"), post("E", "e2"), post("F", "f1")],
    post_snapshots: [], sync_runs: [], clients: [],
  };
  const db = fakeDb(tables);
  refuse.add("e1").add("e2");
  const results = await runSync(db, { platformSlug: "testplatform" });
  check("nothing readable: the account errors rather than passing as cut short",
    results[0].status === "error" && !results[0].partial);
  check("and the accounts after it still sync",
    results[1]?.accountId === "F" && results[1].status === "ok");
  refuse.clear();
}

{
  // No deadline is the behaviour a person pressing Sync now has always had.
  const tables = {
    accounts: [account("G"), account("H")],
    platform_posts: [...["g1", "g2", "g3", "g4", "g5", "g6"].map((p) => post("G", p)), post("H", "h1")],
    post_snapshots: [], sync_runs: [], clients: [],
  };
  const results = await runSync(fakeDb(tables), { platformSlug: "testplatform" });
  check("with no deadline every account is read to the end",
    results.length === 2 && results.every((r) => r.status === "ok" && !r.partial) &&
      tables.post_snapshots.length === 7);
}

{
  // The budget already spent before the first account -- slow housekeeping,
  // say. Nothing starts, and nothing is recorded as having been tried.
  const tables = {
    accounts: [account("I")],
    platform_posts: [post("I", "i1")],
    post_snapshots: [], sync_runs: [], clients: [],
  };
  let eligible = 0;
  const results = await runSync(fakeDb(tables), {
    platformSlug: "testplatform",
    deadline: Date.now() - 1,
    onMeta: (m) => { eligible = m.eligible; },
  });
  check("out of time before starting: nothing runs, everything is left",
    results.length === 0 && tables.sync_runs.length === 0 && accountsRemaining(eligible, results) === 1);
}

delete PROVIDERS.testplatform;
Date.now = realNow;

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
