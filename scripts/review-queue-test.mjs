// What the approval queue counts, and the one filter it follows.
//   node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/review-queue-test.mjs
import { inReviewScope, countNewSinceSync, SYNC_SLACK_MS } from "../src/lib/reviewQueue.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

const rows = [
  { id: "a", client_id: "c1", review_state: "pending" },
  { id: "b", client_id: "c1", review_state: "approved" },
  { id: "c", client_id: "c2", review_state: "pending" },
  { id: "d", client_id: "c2", review_state: "rejected" },
  { id: "e", client_id: null, review_state: "pending" },
  { id: "f", client_id: "gone", review_state: "pending" },
  { id: "g", client_id: "gone", review_state: "approved" },
];
const archived = new Set(["gone"]);
const ids = (rs) => rs.map((r) => r.id).join("");

/* ---- Archived clients, always ------------------------------------------- */
{
  const live = inReviewScope(rows, archived);
  check("an archived client's videos never reach the queue", !live.some((r) => r.client_id === "gone"), ids(live));
  check("unfiltered, everything else is in scope, including work with no client", ids(live) === "abcde", ids(live));
}

/* ---- The client filter, and nothing else -------------------------------- */
{
  const one = inReviewScope(rows, archived, ["c1"]);
  check("one client narrows the queue to that client", ids(one) === "ab", ids(one));
  check("work with NO client drops out under a client filter", !one.some((r) => r.client_id == null));
  const two = inReviewScope(rows, archived, ["c1", "c2"]);
  check("two clients: both, still no archived and no unassigned", ids(two) === "abcd", ids(two));
  check("an empty list is not a filter", ids(inReviewScope(rows, archived, [])) === "abcde");
  check("filtering to an archived client yields nothing, never its rows",
    inReviewScope(rows, archived, ["gone"]).length === 0);
  check("a client with no videos yields an empty queue, not the workspace's",
    inReviewScope(rows, archived, ["c9"]).length === 0);
}

/* ---- The counts beside the queue describe the same population ------------ */
{
  const live = inReviewScope(rows, archived, ["c1"]);
  const pending = live.filter((r) => r.review_state === "pending");
  const approved = live.filter((r) => r.review_state === "approved");
  check("approved is counted over the SAME scope as pending -- one sentence, one population",
    pending.length === 1 && approved.length === 1, `${pending.length}/${approved.length}`);
  const all = inReviewScope(rows, archived);
  check("and unfiltered it is the workspace's own tally, archived excluded",
    all.filter((r) => r.review_state === "approved").length === 1);
}

/* ---- New since the last sync -------------------------------------------- */
{
  const sync = "2026-09-20T10:00:00Z";
  const at = (ms) => ({ created_at: new Date(Date.parse(sync) + ms).toISOString() });
  const pending = [at(-SYNC_SLACK_MS - 1000), at(-SYNC_SLACK_MS + 1000), at(60_000), at(3 * 86_400_000)];
  check("counted from when the sync ran, with an hour of slack for rows landing late",
    countNewSinceSync(pending, sync) === 3, String(countNewSinceSync(pending, sync)));
  check("no sync ever recorded: nothing is 'new', rather than everything",
    countNewSinceSync(pending, null) === 0 && countNewSinceSync(pending, undefined) === 0);
  check("an unparseable stamp counts nothing rather than throwing", countNewSinceSync(pending, "not a date") === 0);
  check("a row with an unparseable stamp is skipped, not counted",
    countNewSinceSync([{ created_at: "nonsense" }], sync) === 0);
  check("an empty queue counts zero", countNewSinceSync([], sync) === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
