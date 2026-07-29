import { NextResponse } from "next/server";
import { runSync, serviceClient } from "@/lib/syncRunner";

/**
 * Scheduled public-metrics refresh.
 *
 * Runs with the service role and no user session, so it is gated on a shared
 * secret rather than a cookie. Without that gate this route would let anyone
 * on the internet burn the workspace's daily API quota.
 *
 * Vercel Cron calls this on the schedule in vercel.json. Vercel signs its own
 * cron requests with CRON_SECRET; a manual call from a terminal can present
 * the same value as a Bearer token.
 */
export const dynamic = "force-dynamic";
// Discovery plus metrics across several accounts comfortably exceeds the
// default 10s budget on a first run.
export const maxDuration = 60;

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // Fail closed. An unset secret must not mean "open to everyone".
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json(
      { error: "Unauthorised. Set CRON_SECRET and send it as a Bearer token." },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const workspaceId = url.searchParams.get("workspace") ?? undefined;

  try {
    const db = serviceClient();
    const started = Date.now();
    const results = await runSync(db, { workspaceId, trigger: "cron" });

    return NextResponse.json({
      ok: true,
      durationMs: Date.now() - started,
      accounts: results.length,
      synced: results.filter((r) => r.status === "ok").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      failed: results.filter((r) => r.status === "error").length,
      snapshotsWritten: results.reduce((s, r) => s + r.snapshotsWritten, 0),
      postsCreated: results.reduce((s, r) => s + r.postsCreated, 0),
      results,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
