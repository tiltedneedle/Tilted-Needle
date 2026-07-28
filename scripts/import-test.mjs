// Tests the Clockify import pipeline: staging, trigram fuzzy matching
// against real content, blocking commit on unmapped members, and
// idempotency. Runs against the live database and a real authenticated
// session, because commit_import_batch checks auth.uid() internally via
// can_manage_workspace -- a raw service-role call has no session and
// bypasses the very check being tested.
//
//   npm run test:import
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

(async () => {
  const { data: ws } = await admin
    .from("workspaces")
    .select("id")
    .order("created_at")
    .limit(1);
  if (!ws?.length) throw new Error("no workspace found to run against");
  const wsId = ws[0].id;

  const { data: content } = await admin
    .from("content_items")
    .select("id, title")
    .eq("workspace_id", wsId)
    .limit(1);
  if (!content?.length) {
    console.log("SKIP: no content_items in this workspace to match against.");
    process.exit(0);
  }
  const target = content[0];

  const stamp = Date.now();
  const managerEmail = `import-test-manager-${stamp}@example.com`;
  const otherEmail = `import-test-other-${stamp}@example.com`;
  const password = "ImportTest!234";

  const { data: createdManager, error: createErr } = await admin.auth.admin.createUser({
    email: managerEmail,
    password,
    email_confirm: true,
  });
  if (createErr) throw new Error(createErr.message);
  const managerId = createdManager.user.id;

  // A second, distinct person. commit_import_batch previously ran as
  // security invoker, so its INSERT into time_entries was subject to the
  // normal RLS policy requiring user_id = auth.uid() -- writing a row for
  // anyone other than the signed-in caller failed outright. That only
  // surfaces when a Clockify member is mapped to someone who is NOT the
  // person running the import, so this test deliberately maps to two
  // different people rather than mapping everything back to the manager.
  const { data: createdOther, error: otherErr } = await admin.auth.admin.createUser({
    email: otherEmail,
    password,
    email_confirm: true,
  });
  if (otherErr) throw new Error(otherErr.message);
  const otherUserId = createdOther.user.id;

  await admin.from("memberships").insert([
    { workspace_id: wsId, user_id: managerId, role: "admin", seat: "full" },
    { workspace_id: wsId, user_id: otherUserId, role: "member", seat: "full" },
  ]);

  const manager = createClient(SUPABASE_URL, PUBLISHABLE, { auth: { persistSession: false } });
  await manager.auth.signInWithPassword({ email: managerEmail, password });

  const exactDesc = target.title;
  // Must reliably differ from exactDesc regardless of the real title's
  // shape: stripping "A " / a trailing "." (an earlier version of this
  // test) was a no-op for a title with neither, which silently collapsed
  // two distinct rows onto one description string and dropped a row from
  // the commit count. Truncating a fixed suffix always changes the string
  // for anything long enough to be a real title, while staying similar
  // enough for trigram matching to still find it.
  const fuzzyDesc =
    exactDesc.length > 6 ? exactDesc.slice(0, -3).trim() : `${exactDesc} x`;
  if (fuzzyDesc === exactDesc) {
    throw new Error(`fuzzy transform failed to change the description: "${exactDesc}"`);
  }
  const unrelatedDesc = "Quarterly tax filing meeting";

  try {
    const { data: batch, error: batchErr } = await manager
      .from("import_batches")
      .insert({ workspace_id: wsId, source: "clockify" })
      .select()
      .single();
    check("manager can create an import batch", !batchErr && !!batch, batchErr?.message);
    const batchId = batch.id;

    const { error: rowsErr } = await manager.from("import_rows").insert(
      [
        { desc: exactDesc, member: "Import Member A" },
        { desc: fuzzyDesc, member: "Import Member A" },
        { desc: unrelatedDesc, member: "Import Member B" },
      ].map((r) => ({
        batch_id: batchId,
        workspace_id: wsId,
        description: r.desc,
        member_name: r.member,
        started_at: new Date(Date.now() - 30 * 86400e3).toISOString(),
        ended_at: new Date(Date.now() - 30 * 86400e3 + 3600e3).toISOString(),
        duration_seconds: 3600,
        is_billable: true,
      })),
    );
    check("manager can stage import rows", !rowsErr, rowsErr?.message);

    await manager.from("import_member_map").insert([
      { batch_id: batchId, workspace_id: wsId, clockify_name: "Import Member A" },
      { batch_id: batchId, workspace_id: wsId, clockify_name: "Import Member B" },
    ]);

    await manager.rpc("stage_import_matches", { p_batch_id: batchId });

    const { data: staged } = await manager
      .from("import_rows")
      .select("*")
      .eq("batch_id", batchId);
    const exactRow = staged.find((r) => r.description === exactDesc);
    const fuzzyRow = staged.find((r) => r.description === fuzzyDesc);
    const unrelatedRow = staged.find((r) => r.description === unrelatedDesc);

    check(
      "exact description matched with high confidence",
      exactRow.suggested_content_item_id === target.id && Number(exactRow.match_confidence) > 0.9,
      `score=${exactRow.match_confidence}`,
    );
    check(
      "fuzzy description matched the same content item",
      fuzzyRow.suggested_content_item_id === target.id,
      `score=${fuzzyRow.match_confidence}`,
    );
    check(
      "unrelated description scored low rather than false-matching",
      Number(unrelatedRow.match_confidence) < 0.5,
      `score=${unrelatedRow.match_confidence}`,
    );

    const { error: blockedErr } = await manager.rpc("commit_import_batch", { p_batch_id: batchId });
    check(
      "commit is blocked while any member is unmapped",
      !!blockedErr && /not yet mapped/.test(blockedErr.message),
      blockedErr?.message,
    );

    // Deliberately mapped to two DIFFERENT people, not both back to the
    // manager -- see the comment above on why that is the case this bug
    // needed.
    await manager
      .from("import_member_map")
      .update({ resolved_user_id: managerId })
      .eq("batch_id", batchId)
      .eq("clockify_name", "Import Member A");
    await manager
      .from("import_member_map")
      .update({ resolved_user_id: otherUserId })
      .eq("batch_id", batchId)
      .eq("clockify_name", "Import Member B");

    await manager
      .from("import_rows")
      .update({ status: "approved", resolved_content_item_id: exactRow.suggested_content_item_id })
      .in("id", [exactRow.id, fuzzyRow.id]);
    await manager.from("import_rows").update({ status: "skipped" }).eq("id", unrelatedRow.id);

    const { data: committedN, error: commitErr } = await manager.rpc("commit_import_batch", {
      p_batch_id: batchId,
    });
    check(
      "commit succeeds once every member is mapped, inserts all 3 rows",
      !commitErr && Number(committedN) === 3,
      commitErr?.message ?? `got ${committedN}`,
    );

    const { data: newEntries } = await admin
      .from("time_entries")
      .select("description, content_item_id, user_id")
      .eq("workspace_id", wsId)
      .in("description", [exactDesc, fuzzyDesc, unrelatedDesc]);
    const approvedOk = newEntries
      .filter((e) => e.description !== unrelatedDesc)
      .every((e) => e.content_item_id === target.id);
    const skippedOk =
      newEntries.find((e) => e.description === unrelatedDesc)?.content_item_id === null;
    check("approved rows land with the content link attached", approvedOk);
    check("skipped rows land as plain time entries with no content link", skippedOk);

    // The regression this test exists to catch: commit_import_batch used to
    // run as security invoker, so writing a row for anyone but the signed-in
    // manager was rejected by time_entries' own RLS ("new row violates
    // row-level security policy"). Only surfaces when the two mapped people
    // are actually different, which is why the setup above insists on that.
    const memberAEntries = newEntries.filter((e) => e.description !== unrelatedDesc);
    const memberBEntry = newEntries.find((e) => e.description === unrelatedDesc);
    check(
      "entries land under the Clockify member's mapped person, not just the manager running the import",
      memberAEntries.every((e) => e.user_id === managerId) && memberBEntry?.user_id === otherUserId,
      `memberA=${memberAEntries.map((e) => e.user_id)} memberB=${memberBEntry?.user_id}`,
    );

    const { data: batchAfter } = await manager
      .from("import_batches")
      .select("status")
      .eq("id", batchId)
      .single();
    check("batch is marked committed", batchAfter.status === "committed");

    const countRows = async () =>
      (
        await admin
          .from("time_entries")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", wsId)
          .in("description", [exactDesc, fuzzyDesc, unrelatedDesc])
      ).count;

    const countBefore = await countRows();
    const { error: recommitErr } = await manager.rpc("commit_import_batch", { p_batch_id: batchId });
    const countAfter = await countRows();
    check(
      "re-committing an already-committed batch is rejected, not duplicated",
      !!recommitErr && /already been committed/.test(recommitErr.message) && countBefore === countAfter,
      `before=${countBefore} after=${countAfter}`,
    );

    await admin
      .from("time_entries")
      .delete()
      .eq("workspace_id", wsId)
      .in("description", [exactDesc, fuzzyDesc, unrelatedDesc]);
    await admin.from("import_batches").delete().eq("id", batchId);
  } finally {
    await admin
      .from("memberships")
      .delete()
      .eq("workspace_id", wsId)
      .in("user_id", [managerId, otherUserId]);
    await admin.auth.admin.deleteUser(managerId);
    await admin.auth.admin.deleteUser(otherUserId);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
