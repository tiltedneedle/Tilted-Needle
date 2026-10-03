// Each role held to its own pages, in a real browser, against a running app.
//   npm run build && npx next start -p 3210      (in another terminal)
//   npm run test:client-nav -- http://localhost:3210
//
// WHAT THIS REPRODUCES
//
// A client user typed /content and was sent to /portal: the (app) layout saw
// to it, and every check anyone ran was that one. But a layout is rendered
// once and kept. From /portal, one line in the browser's console,
//
//     next.router.push("/content")
//
// asks the server for the page alone, the layout's check never runs, and the
// page was served. /content, /home and /reports read the whole workspace
// through the service role, so ANOTHER CLIENT'S name and video arrived in the
// response and were on the client's screen. A plain member reached
// management's pages the same way. (2026-10-03, production build, before any
// client account existed.)
//
// So this does what that person would do: signs in as a client user of one
// client in a workspace that also holds another, and tries every staff page
// both ways, a plain visit and a navigation from inside. Nothing of the
// other client may arrive in ANY response, shown or not. Then the same for a
// plain member and management's pages, that a member's own pages still open,
// that staff still see everything, and that the two team actions which work
// through the service role refuse a caller who does not manage the team.
//
// It needs a server because the fault lived between the browser's router and
// the server's renderer; no test of the database could have seen it, and
// rls-test and client-scope-test both passed throughout.
//
// Makes its own workspace and users with the service key, and removes them.
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

function env(name) {
  if (process.env[name]) return process.env[name];
  try {
    return readFileSync(new URL("../.env.local", import.meta.url), "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${name}=`))
      ?.slice(name.length + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
}

const BASE = (process.argv[2] || process.env.BASE || "http://localhost:3000").replace(/\/$/, "");
const SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL");
const PUBLISHABLE = env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const SECRET = env("SUPABASE_SECRET_KEY");

if (!SUPABASE_URL || !PUBLISHABLE || !SECRET) {
  console.error("Missing Supabase env. Need URL, publishable key and secret key.");
  process.exit(1);
}
// Throwaway accounts are signed in to whatever BASE is. That is for a server
// on this machine, never the real site.
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error(`This signs test accounts in to the app at ${BASE}. Run it against a local server only.`);
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SECRET, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

const stamp = Date.now();
const password = randomBytes(18).toString("base64url") + "!a1";
const OWN = `Nav Own Client ${stamp}`;
const OTHER = `Nav Other Client ${stamp}`;
const VIDEO = `Nav other client video ${stamp}`;

/** Every page a client user has no business on. */
const STAFF_PAGES = [
  "/content", "/home", "/reports", "/reports/client", "/team-admin", "/clients", "/todos",
  "/data", "/rates", "/invoices", "/expenses", "/guidelines", "/timesheet", "/training",
  "/audit-log", "/developers",
];
/** Management's pages, closed to a plain member. */
const MANAGEMENT_PAGES = ["/content", "/reports", "/team-admin", "/clients", "/rates", "/invoices"];
/** A member's own. */
const MEMBER_PAGES = ["/todos", "/timesheet", "/track", "/training", "/guidelines", "/time-off", "/dashboard"];

const userIds = [];
async function makeUser(label) {
  const email = `nav-${label}-${stamp}@tiltedneedle.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: `Nav ${label}` },
  });
  if (error) throw new Error(`createUser ${label}: ${error.message}`);
  userIds.push(data.user.id);
  return { id: data.user.id, email };
}

/** Signed in exactly as the app signs people in, and the cookies it set. */
async function sessionFor(email) {
  const jar = new Map();
  const client = createServerClient(SUPABASE_URL, PUBLISHABLE, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
  return { client, jar, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") };
}

let wsId = null;
let browser = null;

try {
  const reachable = await fetch(`${BASE}/login`).then((r) => r.status === 200, () => false);
  if (!reachable) throw new Error(`no app answering at ${BASE} (start one: npx next start -p 3210)`);

  const owner = await makeUser("owner");
  const member = await makeUser("member");
  const clientUser = await makeUser("client");

  const asOwner = await sessionFor(owner.email);
  const { data: ws, error: wsErr } = await asOwner.client.rpc("create_workspace", {
    ws_name: `Nav test ${stamp}`, ws_slug: `nav-test-${stamp}`,
  });
  if (wsErr) throw new Error(`create_workspace: ${wsErr.message}`);
  wsId = ws.id ?? ws;

  const mkClient = async (name) => {
    const { data, error } = await asOwner.client.from("clients").insert({ workspace_id: wsId, name }).select("id").single();
    if (error) throw new Error(`create client ${name}: ${error.message}`);
    return data.id;
  };
  const own = await mkClient(OWN);
  const other = await mkClient(OTHER);
  const { error: itemErr } = await asOwner.client.from("content_items").insert({
    workspace_id: wsId, title: VIDEO, client_id: other, produced_at: new Date().toISOString(),
  });
  if (itemErr) throw new Error(`create content item: ${itemErr.message}`);
  const { error: bindErr } = await asOwner.client.rpc("set_client_membership", {
    ws: wsId, target_user: clientUser.id, target_client: own,
  });
  if (bindErr) throw new Error(`set_client_membership: ${bindErr.message}`);
  const { error: memErr } = await asOwner.client.from("memberships").insert({
    workspace_id: wsId, user_id: member.id, role: "member", seat: "full",
  });
  if (memErr) throw new Error(`add member: ${memErr.message}`);

  browser = await chromium.launch();
  const SECRETS = [OTHER, VIDEO];

  /** A browser signed in as one person, and everything the app sends it. */
  async function browserFor(email) {
    const { jar, cookie } = await sessionFor(email);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies([...jar].map(([name, value]) => ({ name, value, url: BASE, sameSite: "Lax" })));
    const page = await context.newPage();
    const got = [];
    page.on("response", async (res) => {
      if (!res.url().startsWith(BASE)) return;
      const text = await res.text().catch(() => "");
      got.push({ url: res.url().replace(BASE, ""), text });
    });
    // Settled: no request has begun or ended for a moment. Watched here
    // because Playwright's "networkidle" is a state the DOCUMENT reaches
    // once; on a navigation inside the app it is already true, and waiting
    // for it returns at once, mid-flight. Not a count of requests in flight:
    // one cut off by the next document never reports its end, the count
    // never returns to zero, and every step waits out its whole limit.
    let lastMoved = Date.now();
    const moved = () => {
      lastMoved = Date.now();
    };
    page.on("request", moved);
    page.on("requestfinished", moved);
    page.on("requestfailed", moved);
    const settle = async (calm = 900, limit = 12000) => {
      const began = Date.now();
      while (Date.now() - began < limit && Date.now() - lastMoved < calm) {
        await new Promise((r) => setTimeout(r, 100));
      }
    };
    return {
      page, got, cookie,
      /** The whole document, layout and all. */
      async visit(path) {
        got.length = 0;
        await page.goto(BASE + path, { waitUntil: "domcontentloaded" }).catch(() => {});
        await settle();
        return new URL(page.url()).pathname;
      },
      /**
       * What a link, or one line in the console, does: the page alone.
       * `toward` is where it should end up. A redirect from inside a page
       * takes two round trips (the page asked for, then the page sent to),
       * and for a moment the address is the one asked for, over a loading
       * skeleton; so the address is given time to become `toward`, and
       * where it actually rests is what is returned.
       */
      async push(path, toward = path) {
        got.length = 0;
        const asked = page
          .waitForResponse((r) => {
            const u = new URL(r.url());
            return u.pathname === path && u.searchParams.has("_rsc");
          }, { timeout: 20000 })
          .catch(() => null);
        const sent = await page.evaluate((to) => {
          const router = window.next?.router;
          if (!router) return false;
          router.push(to);
          return true;
        }, path);
        if (!sent) throw new Error("the app's router is not reachable from the page");
        // The server's whole answer for the page asked for (it streams),
        // then the address, then quiet.
        const answer = await asked;
        if (answer) await Promise.race([answer.finished().catch(() => {}), new Promise((r) => setTimeout(r, 20000))]);
        await page.waitForURL((u) => u.pathname === toward, { timeout: 20000 }).catch(() => {});
        await settle();
        return new URL(page.url()).pathname;
      },
      carried: () => got.filter((r) => SECRETS.some((s) => r.text.includes(s))).map((r) => r.url.slice(0, 50)),
      shows: (what) => page.evaluate((w) => w.some((s) => document.body.innerText.includes(s)), what).catch(() => false),
      close: () => context.close(),
    };
  }

  /* ---- A client user -------------------------------------------------- */
  {
    const b = await browserFor(clientUser.email);
    const home = await b.visit("/portal");
    check("a client user opens their own page", home === "/portal", home);
    check("and nothing of another client comes with it", b.carried().length === 0, b.carried().join(", "));

    for (const path of STAFF_PAGES) {
      const landed = await b.visit(path);
      const leaked = b.carried();
      check(`client, a plain visit to ${path}: sent to /portal, nothing of the other client`,
        landed === "/portal" && leaked.length === 0,
        (landed !== "/portal" ? `landed on ${landed} ` : "") + (leaked.length ? `LEAK in ${leaked.join(", ")}` : ""));

      if (new URL(b.page.url()).pathname !== "/portal") await b.visit("/portal");
      const after = await b.push(path, "/portal");
      const leaks = b.carried();
      const onScreen = await b.shows(SECRETS);
      check(`client, a navigation from inside to ${path}: sent to /portal, nothing of the other client`,
        after === "/portal" && leaks.length === 0 && !onScreen,
        (after !== "/portal" ? `stayed on ${after} ` : "") + (leaks.length ? `LEAK in ${leaks.join(", ")}` : "") + (onScreen ? " ON SCREEN" : ""));
    }
    await b.close();
  }

  /* ---- A plain member ------------------------------------------------- */
  let memberCookie = "";
  {
    const b = await browserFor(member.email);
    memberCookie = b.cookie;
    const home = await b.visit("/home");
    check("a member opens Home", home === "/home", home);
    for (const path of MANAGEMENT_PAGES) {
      const landed = await b.visit(path);
      check(`member, a plain visit to ${path}: sent to /home`, landed === "/home", landed);
      if (new URL(b.page.url()).pathname !== "/home") await b.visit("/home");
      const after = await b.push(path, "/home");
      check(`member, a navigation from inside to ${path}: sent to /home`, after === "/home", after);
    }
    // The rule must not cost a member their own pages.
    await b.visit("/home");
    for (const path of MEMBER_PAGES) {
      const after = await b.push(path);
      const broken = await b.shows(["Application error", "Something went wrong"]);
      check(`member, their own page ${path} still opens from inside`, after === path && !broken,
        after !== path ? `landed on ${after}` : broken ? "the page shows an error" : "");
    }
    await b.close();
  }

  /* ---- Staff still see everything -------------------------------------- */
  {
    const b = await browserFor(owner.email);
    await b.visit("/home");
    const broken = await b.shows(["Application error", "Something went wrong"]);
    check("the owner's Home renders (the caches accept staff)", !broken);
    const after = await b.push("/content");
    const sees = await b.shows(SECRETS);
    check("the owner reaches Content from inside, and sees every client's work",
      after === "/content" && sees, after !== "/content" ? `landed on ${after}` : sees ? "" : "the other client's work is missing");
    const direct = await b.visit("/reports");
    const reportsBroken = await b.shows(["Application error", "Something went wrong"]);
    check("the owner's Reports renders", direct === "/reports" && !reportsBroken, direct);
    await b.close();
  }

  /* ---- Team actions that work through the service role ------------------ */
  //
  // sendPasswordReset and resendInvite look a member up with the service
  // role and have Supabase email them. Anyone who could READ the membership
  // row could call them, which every member of staff can, and was handed the
  // person's email address in the reply. Called here the way the button
  // calls them, by a member who manages nothing.
  {
    const manifest = ".next/server/server-reference-manifest.json";
    if (!existsSync(manifest)) {
      console.log("SKIP  team actions: no production build here to read the action ids from");
    } else {
      const node = JSON.parse(readFileSync(manifest, "utf8")).node ?? {};
      const idOf = (name) => Object.keys(node).find((id) => node[id].exportedName === name && String(node[id].filename).endsWith("actions.ts"));
      const { data: target } = await admin.from("memberships").select("id")
        .eq("workspace_id", wsId).eq("user_id", clientUser.id).single();
      for (const name of ["sendPasswordReset", "resendInvite"]) {
        const id = idOf(name);
        if (!id) {
          check(`${name} is in the build`, false, "not found in the action manifest");
          continue;
        }
        const res = await fetch(`${BASE}/home`, {
          method: "POST",
          headers: {
            "next-action": id,
            "content-type": "text/plain;charset=UTF-8",
            accept: "text/x-component",
            origin: BASE,
            cookie: memberCookie,
          },
          body: JSON.stringify([target.id]),
        });
        const text = await res.text();
        check(`a member cannot ${name === "sendPasswordReset" ? "send a colleague a password reset" : "re-send someone's invitation"}`,
          res.status === 200 && text.includes("Only owners, admins and managers can manage the team."),
          `${res.status} ${text.includes("sentTo") ? "the action went through" : ""}`);
        check("and is not told the person's email address", !text.includes(clientUser.email));
      }

      // And the same guard lets a manager through: the owner switches the
      // member off, the way Team admin's button does. Read back from the
      // database, since an action's reply is a stream of pointers.
      const off = idOf("setMemberActive");
      const { data: memberRow } = await admin.from("memberships").select("id")
        .eq("workspace_id", wsId).eq("user_id", member.id).single();
      if (!off) {
        check("setMemberActive is in the build", false, "not found in the action manifest");
      } else {
        const res = await fetch(`${BASE}/team-admin`, {
          method: "POST",
          headers: {
            "next-action": off,
            "content-type": "text/plain;charset=UTF-8",
            accept: "text/x-component",
            origin: BASE,
            cookie: asOwner.cookie,
          },
          body: JSON.stringify([memberRow.id, false]),
        });
        await res.text();
        const { data: after } = await admin.from("memberships").select("is_active").eq("id", memberRow.id).single();
        check("the owner can still switch a member off from Team admin",
          res.status === 200 && after?.is_active === false, `${res.status}, is_active ${after?.is_active}`);
      }
    }
  }
} catch (e) {
  check("test harness ran", false, String(e?.message ?? e));
} finally {
  if (browser) await browser.close();
  if (wsId) await admin.from("workspaces").delete().eq("id", wsId);
  for (const id of userIds) await admin.auth.admin.deleteUser(id).catch(() => {});
  console.log("\ncleaned up test workspace and users");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
