// Which account a link may be attached to.
//
// This is a billing guard wearing a UI's clothes. A platform post carries its
// video's reach, and the tracked hours that ride along with it, onto whichever
// client owns the account it hangs off -- so choosing the account is the step
// that moves money-shaped numbers between two sets of books.
//
// Until now both rules below lived only in the pickers that offered the
// choice, which is no enforcement at all: attachPostByUrl is a server action
// and its arguments arrive over the wire. Neither failure announces itself
// afterwards, which is why they are tested rather than watched for.
const G = await import("../src/lib/attachGuards.ts");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};
const allowed = (name, t) => check(name, G.attachRefusal(t) === null, G.attachRefusal(t) ?? "allowed");
const refused = (name, t, mustSay) => {
  const r = G.attachRefusal(t);
  check(name, r !== null && (!mustSay || r.includes(mustSay)), r ?? "ALLOWED (should have refused)");
};

const acct = (over = {}) => ({
  client_id: over.client_id === undefined ? "client-a" : over.client_id,
  platform_slug: over.platform_slug ?? "tiktok",
  handle: over.handle ?? "trilogyjewellers",
});
const item = (over = {}) => ({
  client_id: over.client_id === undefined ? "client-a" : over.client_id,
});

/* -- The ordinary case ----------------------------------------------------- */

allowed("the client's own account, on the link's own platform", {
  account: acct(), item: item(), urlPlatform: "tiktok",
});

/* -- Wrong client: the expensive, silent one -------------------------------- */

refused("another client's account is refused",
  { account: acct({ client_id: "client-b" }), item: item(), urlPlatform: "tiktok" },
  "different client");

refused("and the refusal names the handle, so the mistake is visible",
  { account: acct({ client_id: "client-b", handle: "entree_london" }), item: item(), urlPlatform: "tiktok" },
  "@entree_london");

refused("an account belonging to no client is still not this client's",
  { account: acct({ client_id: null }), item: item(), urlPlatform: "tiktok" },
  "different client");

// The exemption. These are the rows most in need of a link, and there is no
// client whose books a wrong choice could land on.
allowed("a video with no client may attach anywhere", {
  account: acct({ client_id: "client-b" }), item: item({ client_id: null }), urlPlatform: "tiktok",
});

allowed("a video with no client may attach to a clientless account too", {
  account: acct({ client_id: null }), item: item({ client_id: null }), urlPlatform: "tiktok",
});

/* -- Wrong platform: the incoherent one ------------------------------------ */

refused("a tiktok link on a youtube account is refused",
  { account: acct({ platform_slug: "youtube" }), item: item(), urlPlatform: "tiktok" },
  "youtube account");

refused("and youtube_shorts is not youtube",
  { account: acct({ platform_slug: "youtube" }), item: item(), urlPlatform: "youtube_shorts" },
  "Pick the youtube_shorts account");

refused("nor is youtube youtube_shorts",
  { account: acct({ platform_slug: "youtube_shorts" }), item: item(), urlPlatform: "youtube" },
  "Pick the youtube account");

allowed("instagram to instagram is fine", {
  account: acct({ platform_slug: "instagram", handle: "ameerhnaran" }),
  item: item(), urlPlatform: "instagram",
});

/* -- Order of refusals ----------------------------------------------------- */

{
  // Both wrong. Platform is reported first because it is the one the person
  // can fix by picking a different row in the same menu; being told about the
  // client instead would send them to Data sync for a problem they do not have.
  const r = G.attachRefusal({
    account: acct({ client_id: "client-b", platform_slug: "youtube" }),
    item: item(), urlPlatform: "tiktok",
  });
  check("when both are wrong, the platform is named first", r?.includes("youtube account"), r ?? "none");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
