import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveApiKey, isErrorResponse } from "@/lib/publicApi";

/**
 * GET /api/v1/time-entries?since=ISO&limit=100
 *
 * Read-only by design for the first public endpoint: a write API multiplies
 * the blast radius of a leaked key (double billing, forged hours) for a
 * feature nobody has asked to automate yet. Reads cover the common
 * integration need -- pulling tracked time into an external report.
 */
export async function GET(request: NextRequest) {
  const auth = await resolveApiKey(request);
  if (isErrorResponse(auth)) return auth;

  const since = request.nextUrl.searchParams.get("since");
  const limit = Math.min(
    Number(request.nextUrl.searchParams.get("limit")) || 100,
    500,
  );

  const admin = createAdminClient();
  let query = admin
    .from("time_entries")
    .select(
      "id, user_id, project_id, task_id, content_item_id, description, started_at, ended_at, duration_seconds, is_billable",
    )
    .eq("workspace_id", auth.workspaceId)
    .not("ended_at", "is", null)
    .order("started_at", { ascending: false })
    .limit(limit);

  if (since) query = query.gte("started_at", since);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data });
}
