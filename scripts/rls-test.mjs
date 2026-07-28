// Two-tenant isolation test. Creates two users in two workspaces and asserts
// neither can read or write the other's data through the publishable key.
//
// RLS is the only tenant boundary in this app -- the repo is public and the
// publishable key ships in the browser bundle. Run this after any policy or
// schema change:  npm run test:rls
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

function env(name) {
  if (process.env[name]) return process.env[name];
  try {
    const file = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    return file
      .split("\n")
      .find((l) => l.startsWith(`${name}=`))
      ?.slice(name.length + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
}

// Deliberately not named URL: a module-scope `const URL` shadows the global
// URL constructor that env() itself uses, and the TDZ makes that a runtime
// error during initialisation.
const SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL");
const PUBLISHABLE = env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const SECRET = env("SUPABASE_SECRET_KEY");

if (!SUPABASE_URL || !PUBLISHABLE || !SECRET) {
  console.error("Missing Supabase env vars (checked env and .env.local).");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SECRET, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  if (ok) pass++;
  else fail++;
};

async function mkUser(email) {
  await admin.auth.admin
    .listUsers()
    .then(({ data }) => {
      const found = data?.users?.find((u) => u.email === email);
      return found ? admin.auth.admin.deleteUser(found.id) : null;
    })
    .catch(() => {});
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: "TestPassword!234",
    email_confirm: true,
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  const client = createClient(SUPABASE_URL, PUBLISHABLE, { auth: { persistSession: false } });
  const { error: signInErr } = await client.auth.signInWithPassword({
    email,
    password: "TestPassword!234",
  });
  if (signInErr) throw new Error(`signIn ${email}: ${signInErr.message}`);
  return { id: data.user.id, client };
}

(async () => {
  const stamp = Date.now();
  const a = await mkUser(`rls-a-${stamp}@example.com`);
  const b = await mkUser(`rls-b-${stamp}@example.com`);

  // Each user creates their own workspace via the bootstrap RPC.
  const { data: wsA, error: eA } = await a.client.rpc("create_workspace", {
    ws_name: "Tenant A", ws_slug: `tenant-a-${stamp}`,
  });
  check("user A can create a workspace", !eA && !!wsA, eA?.message);

  const { data: wsB, error: eB } = await b.client.rpc("create_workspace", {
    ws_name: "Tenant B", ws_slug: `tenant-b-${stamp}`,
  });
  check("user B can create a workspace", !eB && !!wsB, eB?.message);

  // Owner membership must exist, or the workspace is unreachable.
  const { data: mA } = await a.client.from("memberships").select("role")
    .eq("workspace_id", wsA.id);
  check("owner membership created atomically", mA?.[0]?.role === "owner");

  // A creates a client + project + entry.
  const { data: clientA, error: ceA } = await a.client.from("clients")
    .insert({ workspace_id: wsA.id, name: "Client A" }).select().single();
  check("owner can create a client", !ceA && !!clientA, ceA?.message);

  const { data: projA, error: peA } = await a.client.from("projects")
    .insert({ workspace_id: wsA.id, client_id: clientA.id, name: "Project A" })
    .select().single();
  check("owner can create a project", !peA && !!projA, peA?.message);

  const { error: teA } = await a.client.from("time_entries").insert({
    workspace_id: wsA.id, user_id: a.id, project_id: projA.id,
    description: "Secret video title A",
    started_at: new Date(Date.now() - 3600e3).toISOString(),
    ended_at: new Date().toISOString(),
  });
  check("owner can create a time entry", !teA, teA?.message);

  // --- Isolation ---
  const { data: bSeesWs } = await b.client.from("workspaces").select("*").eq("id", wsA.id);
  check("B cannot read A's workspace", (bSeesWs?.length ?? 0) === 0);

  const { data: bSeesClients } = await b.client.from("clients").select("*");
  check("B cannot read A's clients", !bSeesClients?.some((c) => c.id === clientA.id));

  const { data: bSeesProjects } = await b.client.from("projects").select("*");
  check("B cannot read A's projects", !bSeesProjects?.some((p) => p.id === projA.id));

  const { data: bSeesEntries } = await b.client.from("time_entries").select("*");
  check("B cannot read A's time entries", (bSeesEntries?.length ?? 0) === 0);

  // Cross-tenant write attempts must be rejected.
  const { error: bWrite } = await b.client.from("projects")
    .insert({ workspace_id: wsA.id, name: "Injected by B" });
  check("B cannot insert into A's workspace", !!bWrite, bWrite ? "" : "INSERT SUCCEEDED");

  const { error: bSpoof } = await b.client.from("time_entries").insert({
    workspace_id: wsA.id, user_id: a.id, description: "spoofed",
    started_at: new Date().toISOString(), ended_at: new Date(Date.now() + 60e3).toISOString(),
  });
  check("B cannot forge an entry as A", !!bSpoof, bSpoof ? "" : "INSERT SUCCEEDED");

  const { data: bUpd } = await b.client.from("clients")
    .update({ name: "hacked" }).eq("id", clientA.id).select();
  check("B cannot update A's client", (bUpd?.length ?? 0) === 0);

  const { data: bDel } = await b.client.from("time_entries")
    .delete().eq("workspace_id", wsA.id).select();
  check("B cannot delete A's entries", (bDel?.length ?? 0) === 0);

  // --- Phase 2 content layer ---
  const { data: acct, error: acctErr } = await a.client
    .from("accounts")
    .insert({
      workspace_id: wsA.id,
      client_id: clientA.id,
      platform_slug: "instagram",
      handle: "@tenant_a",
    })
    .select()
    .single();
  check("owner can create an account", !acctErr && !!acct, acctErr?.message);

  const { data: item, error: itemErr } = await a.client
    .from("content_items")
    .insert({ workspace_id: wsA.id, client_id: clientA.id, title: "Secret content A" })
    .select()
    .single();
  check("owner can create content", !itemErr && !!item, itemErr?.message);

  const { data: post, error: postErr } = await a.client
    .from("platform_posts")
    .insert({
      workspace_id: wsA.id,
      content_item_id: item.id,
      account_id: acct.id,
      source: "manual",
    })
    .select()
    .single();
  check("owner can create a post", !postErr && !!post, postErr?.message);

  const { error: snapErr } = await a.client.from("post_snapshots").insert({
    workspace_id: wsA.id,
    platform_post_id: post.id,
    views: 12345,
    likes: 678,
  });
  check("owner can record a snapshot", !snapErr, snapErr?.message);

  // The platform registry is shared reference data, readable by everyone.
  const { data: plats } = await b.client.from("platforms").select("slug");
  check("registry readable by any member", (plats?.length ?? 0) >= 4);
  const { error: platWrite } = await b.client
    .from("platforms")
    .insert({ slug: "rogue", display_name: "Rogue" });
  check("registry not writable by members", !!platWrite, platWrite ? "" : "INSERT SUCCEEDED");

  // Isolation across the new tables.
  const { data: bAcc } = await b.client.from("accounts").select("*");
  check("B cannot read A's accounts", (bAcc?.length ?? 0) === 0);
  const { data: bItems } = await b.client.from("content_items").select("*");
  check("B cannot read A's content", (bItems?.length ?? 0) === 0);
  const { data: bPosts } = await b.client.from("platform_posts").select("*");
  check("B cannot read A's posts", (bPosts?.length ?? 0) === 0);
  const { data: bSnaps } = await b.client.from("post_snapshots").select("*");
  check("B cannot read A's snapshots", (bSnaps?.length ?? 0) === 0);

  // The metrics view must be filtered by the caller's RLS, not the view
  // owner's -- this is what security_invoker buys.
  const { data: bMetrics } = await b.client.from("post_current_metrics").select("*");
  check("metrics view does not leak across tenants", (bMetrics?.length ?? 0) === 0);
  const { data: aMetrics } = await a.client.from("post_current_metrics").select("*");
  check("metrics view returns own rows", (aMetrics?.length ?? 0) === 1);

  const { error: bInject } = await b.client.from("content_items").insert({
    workspace_id: wsA.id,
    title: "Injected by B",
  });
  check("B cannot inject content into A", !!bInject, bInject ? "" : "INSERT SUCCEEDED");

  /* -- Phase 5: client portal isolation --------------------------------- */
  //
  // A client user is an external party with a login. They must see their own
  // content and nothing else -- not other clients, not time, not money, not
  // the staff roster. This is the highest-stakes boundary in the app.

  // Second client in tenant A, with its own content.
  const { data: otherClient } = await a.client.from("clients")
    .insert({ workspace_id: wsA.id, name: "Other Client A" }).select().single();
  const { data: otherItem } = await a.client.from("content_items")
    .insert({
      workspace_id: wsA.id, client_id: otherClient.id,
      title: "Other client secret content",
    }).select().single();

  const clientUser = await mkUser(`rls-c-${stamp}@example.com`);
  const { error: linkErr } = await admin.rpc("set_client_membership", {
    ws: wsA.id, target_user: clientUser.id, target_client: clientA.id,
  });
  // The RPC runs as the caller; use a direct insert with the service role.
  if (linkErr) {
    const { error: insErr } = await admin.from("memberships").insert({
      workspace_id: wsA.id, user_id: clientUser.id,
      role: "client", seat: "limited", client_id: clientA.id,
    });
    check("client membership can be created", !insErr, insErr?.message);
  } else {
    check("client membership can be created", true);
  }

  const cc = clientUser.client;

  // Sees its own.
  const { data: ownClients } = await cc.from("clients").select("*");
  check("client sees only its own client row",
    ownClients?.length === 1 && ownClients[0].id === clientA.id,
    `saw ${ownClients?.length}`);

  const { data: ownContent } = await cc.from("content_items").select("*");
  check("client sees its own content",
    ownContent?.some((c) => c.id === item.id) === true);
  check("client cannot see another client's content",
    !ownContent?.some((c) => c.id === otherItem.id),
    `saw ${ownContent?.length} items`);

  const { data: ownPosts } = await cc.from("platform_posts").select("*");
  check("client sees its own posts", (ownPosts?.length ?? 0) === 1);

  const { data: ownSnaps } = await cc.from("post_snapshots").select("*");
  check("client sees its own snapshots", (ownSnaps?.length ?? 0) >= 1);

  const { data: ownAcc } = await cc.from("accounts").select("*");
  check("client sees its own accounts", (ownAcc?.length ?? 0) === 1);

  // Must not see internal data.
  const { data: cTime } = await cc.from("time_entries").select("*");
  check("client sees no time entries at all", (cTime?.length ?? 0) === 0,
    `saw ${cTime?.length}`);

  const { data: cAssign } = await cc.from("content_assignments").select("*");
  check("client cannot see staffing assignments", (cAssign?.length ?? 0) === 0);

  const { data: cInv } = await cc.from("invoices").select("*");
  check("client cannot see invoices", (cInv?.length ?? 0) === 0);

  const { data: cExp } = await cc.from("expenses").select("*");
  check("client cannot see expenses", (cExp?.length ?? 0) === 0);

  const { data: cRates } = await cc.from("time_entry_billing").select("*");
  check("client cannot see resolved rates", (cRates?.length ?? 0) === 0);

  const { data: cProfiles } = await cc.from("profiles").select("*");
  check("client cannot enumerate the team",
    (cProfiles?.length ?? 0) <= 1, `saw ${cProfiles?.length} profiles`);

  const { data: cMembers } = await cc.from("memberships").select("*");
  check("client sees only its own membership",
    (cMembers?.length ?? 0) === 1, `saw ${cMembers?.length}`);

  const { data: cTasks } = await cc.from("tasks").select("*");
  check("client cannot see internal tasks", (cTasks?.length ?? 0) === 0);

  // Read-only: every write path must be refused.
  const { error: cWrite } = await cc.from("content_items")
    .insert({ workspace_id: wsA.id, client_id: clientA.id, title: "By client" });
  check("client cannot create content", !!cWrite, cWrite ? "" : "INSERT SUCCEEDED");

  const { data: cUpd } = await cc.from("content_items")
    .update({ title: "renamed by client" }).eq("id", item.id).select();
  check("client cannot edit content", (cUpd?.length ?? 0) === 0);

  const { error: cSnap } = await cc.from("post_snapshots").insert({
    workspace_id: wsA.id, platform_post_id: post.id, views: 999999,
  });
  check("client cannot record metrics", !!cSnap, cSnap ? "" : "INSERT SUCCEEDED");

  const { error: cTimeIns } = await cc.from("time_entries").insert({
    workspace_id: wsA.id, user_id: clientUser.id, description: "by client",
    started_at: new Date().toISOString(),
  });
  check("client cannot track time", !!cTimeIns, cTimeIns ? "" : "INSERT SUCCEEDED");

  // And still nothing from the other tenant.
  const { data: cCross } = await cc.from("content_items").select("*")
    .eq("workspace_id", wsB.id);
  check("client cannot reach another workspace", (cCross?.length ?? 0) === 0);

  // --- Phase 6: OAuth connections and owner-only analytics -------------
  const { data: analyticsRow, error: analyticsErr } = await a.client
    .from("post_analytics")
    .insert({
      workspace_id: wsA.id, platform_post_id: post.id,
      impressions: 10000, ctr: 0.048, avg_watch_seconds: 22,
      retention_30s: 0.45, source: "manual",
    })
    .select()
    .single();
  check("owner can record manual analytics", !analyticsErr && !!analyticsRow, analyticsErr?.message);

  const { data: cAnalytics } = await cc.from("post_analytics").select("*");
  check("client with a matching account sees its own analytics",
    cAnalytics?.some((r) => r.id === analyticsRow.id) === true);

  const { data: bAnalytics } = await b.client.from("post_analytics").select("*");
  check("tenant B cannot see tenant A's analytics", (bAnalytics?.length ?? 0) === 0);

  const { data: cOauth } = await cc.from("oauth_connections").select("*");
  check("client cannot see OAuth connection rows", (cOauth?.length ?? 0) === 0);

  const { error: cAnalyticsWrite } = await cc.from("post_analytics").insert({
    workspace_id: wsA.id, platform_post_id: post.id, ctr: 0.99, source: "manual",
  });
  check("client cannot write analytics", !!cAnalyticsWrite, cAnalyticsWrite ? "" : "INSERT SUCCEEDED");

  const { error: cVaultRpc } = await cc.rpc("vault_store_refresh_token", {
    p_secret: "stolen", p_name: "x",
  });
  check("client cannot call the vault wrapper", !!cVaultRpc, cVaultRpc ? "" : "RPC SUCCEEDED");

  const { error: aVaultRpc } = await a.client.rpc("vault_store_refresh_token", {
    p_secret: "stolen", p_name: "x",
  });
  check("no authenticated user can call the vault wrapper directly",
    !!aVaultRpc, aVaultRpc ? "" : "RPC SUCCEEDED");

  // --- Phase 7: approvals, time off, groups ------------------------------
  const { data: group, error: groupErr } = await a.client
    .from("user_groups")
    .insert({ workspace_id: wsA.id, name: "Editors" })
    .select()
    .single();
  check("manager can create a group", !groupErr && !!group, groupErr?.message);

  const { error: bGroupWrite } = await b.client
    .from("user_groups")
    .insert({ workspace_id: wsA.id, name: "Injected" });
  check("B cannot create a group in A's workspace", !!bGroupWrite, bGroupWrite ? "" : "INSERT SUCCEEDED");

  const { data: cGroupData } = await cc.from("user_groups").select("*");
  check("client cannot see internal groups", (cGroupData?.length ?? 0) === 0);

  // Timesheet submission + approval locking. A is the workspace owner and
  // therefore always passes can_manage_workspace, which would make a lock
  // check against A meaningless -- the manager-override clause would let it
  // through either way. A genuine plain member is required to prove the
  // lock actually stops someone who is not a manager.
  const plainMember = await mkUser(`rls-m-${stamp}@example.com`);
  const { error: addMemberErr } = await admin.from("memberships").insert({
    workspace_id: wsA.id, user_id: plainMember.id, role: "member", seat: "full",
  });
  check("plain member can be added to the workspace", !addMemberErr, addMemberErr?.message);

  const { data: sub, error: subErr } = await plainMember.client
    .from("timesheet_submissions")
    .insert({
      workspace_id: wsA.id, user_id: plainMember.id,
      period_start: "2026-01-05", period_end: "2026-01-11", status: "submitted",
    })
    .select()
    .single();
  check("member can submit a timesheet", !subErr && !!sub, subErr?.message);

  const { data: entryInPeriod } = await plainMember.client
    .from("time_entries")
    .insert({
      workspace_id: wsA.id, user_id: plainMember.id, description: "week to lock",
      started_at: "2026-01-06T10:00:00Z", ended_at: "2026-01-06T11:00:00Z",
    })
    .select()
    .single();

  // Approval is a manager action -- done as A (the owner), not the member.
  await a.client.from("timesheet_submissions").update({ status: "approved" }).eq("id", sub.id);

  const { data: editAfterLock } = await plainMember.client
    .from("time_entries")
    .update({ description: "edited after approval" })
    .eq("id", entryInPeriod.id)
    .select();
  check("a plain member cannot edit their own entry once the week is approved",
    (editAfterLock?.length ?? 0) === 0);

  const { data: stillThere } = await plainMember.client
    .from("time_entries")
    .select("id")
    .eq("id", entryInPeriod.id);
  await plainMember.client.from("time_entries").delete().eq("id", entryInPeriod.id);
  const { data: afterDeleteAttempt } = await plainMember.client
    .from("time_entries")
    .select("id")
    .eq("id", entryInPeriod.id);
  check("a plain member cannot delete their own entry once the week is approved",
    (stillThere?.length ?? 0) === 1 && (afterDeleteAttempt?.length ?? 0) === 1);

  // Managers can still correct a locked entry -- the lock protects members
  // from themselves, not managers from doing their job.
  const { data: managerEdit } = await a.client
    .from("time_entries")
    .update({ description: "manager correction" })
    .eq("id", entryInPeriod.id)
    .select();
  check("a manager can still edit an approved week's entries",
    (managerEdit?.length ?? 0) === 1);

  await admin.from("memberships").delete().eq("workspace_id", wsA.id).eq("user_id", plainMember.id);
  await admin.auth.admin.deleteUser(plainMember.id);

  // Time off.
  const { data: policy, error: policyErr } = await a.client
    .from("time_off_policies")
    .insert({ workspace_id: wsA.id, name: "PTO", days_per_year: 20 })
    .select()
    .single();
  check("manager can create a time-off policy", !policyErr && !!policy, policyErr?.message);

  const { data: pto } = await a.client
    .from("time_off_requests")
    .insert({
      workspace_id: wsA.id, user_id: a.id, policy_id: policy.id,
      start_date: "2026-03-01", end_date: "2026-03-01", hours: 8,
    })
    .select()
    .single();
  check("member can request time off", !!pto);

  const { data: cPto } = await cc.from("time_off_requests").select("*");
  check("client cannot see time-off requests", (cPto?.length ?? 0) === 0);

  const { data: bPtoData } = await b.client
    .from("time_off_requests")
    .select("*")
    .eq("id", pto.id);
  check("tenant B cannot see tenant A's time-off request", (bPtoData?.length ?? 0) === 0);

  // Cleanup this block's rows so they don't linger in the seeded workspace.
  await admin.from("time_off_requests").delete().eq("id", pto.id);
  await admin.from("time_off_policies").delete().eq("id", policy.id);
  await admin.from("time_entries").delete().eq("id", entryInPeriod.id);
  await admin.from("timesheet_submissions").delete().eq("id", sub.id);
  await admin.from("user_groups").delete().eq("id", group.id);

  // --- Phase 8: audit log, API keys, webhooks, kiosks --------------------
  const { data: auditRow, error: auditErr } = await a.client
    .from("audit_log")
    .insert({
      workspace_id: wsA.id, actor_id: a.id, action: "test.probe",
      entity_type: "test", detail: { note: "rls probe" },
    })
    .select()
    .single();
  check("a member can write an audit entry", !auditErr && !!auditRow, auditErr?.message);

  const { data: auditUpdateAttempt } = await a.client
    .from("audit_log")
    .update({ action: "tampered" })
    .eq("id", auditRow.id)
    .select();
  check("nobody can update an audit log entry, not even its own author",
    (auditUpdateAttempt?.length ?? 0) === 0);

  const { data: auditDeleteAttempt } = await a.client
    .from("audit_log")
    .delete()
    .eq("id", auditRow.id)
    .select();
  check("nobody can delete an audit log entry, not even a manager",
    (auditDeleteAttempt?.length ?? 0) === 0);

  const { data: bAudit } = await b.client.from("audit_log").select("*").eq("id", auditRow.id);
  check("tenant B cannot read tenant A's audit log", (bAudit?.length ?? 0) === 0);

  const { data: cAudit } = await cc.from("audit_log").select("*");
  check("client cannot read the audit log", (cAudit?.length ?? 0) === 0);

  const { data: apiKey, error: apiKeyErr } = await a.client
    .from("api_keys")
    .insert({
      workspace_id: wsA.id, name: "probe key",
      key_prefix: "tn_live_probe", key_hash: "0".repeat(64),
    })
    .select()
    .single();
  check("manager can create an API key", !apiKeyErr && !!apiKey, apiKeyErr?.message);

  const { data: cApiKeys } = await cc.from("api_keys").select("*");
  check("client cannot see API keys", (cApiKeys?.length ?? 0) === 0);

  const { data: webhook, error: webhookErr } = await a.client
    .from("webhooks")
    .insert({
      workspace_id: wsA.id, url: "https://example.com/hook",
      events: ["invoice.generated"], secret: "probe-secret",
    })
    .select()
    .single();
  check("manager can create a webhook", !webhookErr && !!webhook, webhookErr?.message);

  const { data: bWebhooks } = await b.client.from("webhooks").select("*").eq("id", webhook.id);
  check("tenant B cannot see tenant A's webhook", (bWebhooks?.length ?? 0) === 0);

  const { data: kiosk, error: kioskErr } = await a.client
    .from("kiosks")
    .insert({ workspace_id: wsA.id, name: "probe kiosk", device_token: `probe_${stamp}` })
    .select()
    .single();
  check("manager can register a kiosk", !kioskErr && !!kiosk, kioskErr?.message);

  const { data: cKiosk } = await cc.from("kiosks").select("*");
  check("client cannot see kiosk devices", (cKiosk?.length ?? 0) === 0);

  // kiosk_clock itself has no RLS policy to test -- it is a security-definer
  // function granted only to service_role, already proven end to end
  // against the live schema outside this suite (12/12 in kiosk-test.js).
  // What matters here is that it stays unreachable from a normal session.
  const { error: kioskClockAsUser } = await a.client.rpc("kiosk_clock", {
    p_device_token: kiosk.device_token, p_pin_hash: "irrelevant",
  });
  check("kiosk_clock cannot be called from an authenticated session",
    !!kioskClockAsUser, kioskClockAsUser ? "" : "RPC SUCCEEDED");

  await admin.from("kiosks").delete().eq("id", kiosk.id);
  await admin.from("webhooks").delete().eq("id", webhook.id);
  await admin.from("api_keys").delete().eq("id", apiKey.id);
  await admin.from("audit_log").delete().eq("id", auditRow.id);

  // --- Phase 1.5: Clockify import staging ---------------------------------
  const { data: importBatch, error: importBatchErr } = await a.client
    .from("import_batches")
    .insert({ workspace_id: wsA.id, source: "clockify" })
    .select()
    .single();
  check("manager can create an import batch", !importBatchErr && !!importBatch, importBatchErr?.message);

  const { error: importRowErr } = await a.client.from("import_rows").insert({
    batch_id: importBatch.id, workspace_id: wsA.id, description: item.title,
    member_name: "Probe Member",
    started_at: new Date(Date.now() - 86400e3).toISOString(),
    ended_at: new Date(Date.now() - 82800e3).toISOString(),
    duration_seconds: 3600,
  });
  check("manager can stage an import row", !importRowErr, importRowErr?.message);

  await a.client.rpc("stage_import_matches", { p_batch_id: importBatch.id });
  const { data: matchedRow } = await a.client.from("import_rows").select("*").eq("batch_id", importBatch.id).single();
  check("staged row picks up a suggested match against real content",
    matchedRow.suggested_content_item_id === item.id, `score=${matchedRow.match_confidence}`);

  const { error: commitBlockedErr } = await a.client.rpc("commit_import_batch", {
    p_batch_id: importBatch.id,
  });
  check("commit is blocked while the Clockify member is unmapped", !!commitBlockedErr);

  const { data: bImportBatches } = await b.client.from("import_batches").select("*").eq("id", importBatch.id);
  check("tenant B cannot see tenant A's import batch", (bImportBatches?.length ?? 0) === 0);

  const { data: cImportBatches } = await cc.from("import_batches").select("*");
  check("client cannot see import batches", (cImportBatches?.length ?? 0) === 0);

  await admin.from("import_batches").delete().eq("id", importBatch.id);

  // Staff are unaffected by the tightened policies.
  const { data: staffClients } = await a.client.from("clients").select("*");
  check("staff still see every client in their workspace",
    (staffClients?.length ?? 0) === 2, `saw ${staffClients?.length}`);
  const { data: staffContent } = await a.client.from("content_items").select("*");
  check("staff still see every content item",
    (staffContent?.length ?? 0) === 2, `saw ${staffContent?.length}`);

  // Anonymous access must see nothing at all.
  const anon = createClient(SUPABASE_URL, PUBLISHABLE, { auth: { persistSession: false } });
  const { data: anonWs } = await anon.from("workspaces").select("*");
  check("anonymous reads no workspaces", (anonWs?.length ?? 0) === 0);
  const { data: anonTe } = await anon.from("time_entries").select("*");
  check("anonymous reads no time entries", (anonTe?.length ?? 0) === 0);
  const { data: anonContent } = await anon.from("content_items").select("*");
  check("anonymous reads no content", (anonContent?.length ?? 0) === 0);
  const { data: anonMetrics } = await anon.from("post_current_metrics").select("*");
  check("anonymous reads no metrics", (anonMetrics?.length ?? 0) === 0);

  // One running timer per user.
  await a.client.from("time_entries").insert({
    workspace_id: wsA.id, user_id: a.id, description: "running 1",
    started_at: new Date().toISOString(),
  });
  const { error: dupTimer } = await a.client.from("time_entries").insert({
    workspace_id: wsA.id, user_id: a.id, description: "running 2",
    started_at: new Date().toISOString(),
  });
  check("second concurrent timer rejected", !!dupTimer, dupTimer ? "" : "ALLOWED TWO TIMERS");

  // Cleanup. workspaces.owner_id is ON DELETE RESTRICT, so the workspace must
  // go first -- deleting the user alone fails silently and leaves orphans.
  await admin.auth.admin.deleteUser(clientUser.id).catch(() => {});

  for (const [user, ws] of [
    [a, wsA],
    [b, wsB],
  ]) {
    if (ws) {
      const { error } = await admin.from("workspaces").delete().eq("id", ws.id);
      if (error) console.log(`  cleanup: workspace ${ws.id} -> ${error.message}`);
    }
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) console.log(`  cleanup: user ${user.id} -> ${error.message}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
