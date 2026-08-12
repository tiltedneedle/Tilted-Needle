import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
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
 *
 * CADENCE: every six hours (was daily). A client's post used to sit up to 24
 * hours before anything noticed it -- and since the approval queue was added,
 * that is 24 hours before anyone can even approve it.
 *
 * Running four times as often costs nothing extra, which is the only reason
 * it is safe: metered spend is not governed by how often this fires. Metrics
 * refresh only when a post's age band says it is due
 * (scrape_schedule.interval_days), and metered DISCOVERY is gated by a 10-day
 * per-account cooldown. Firing four times a day asks those questions four
 * times and gets "not yet" three of them. Only YouTube's free quota sees more
 * use, and it resets daily.
 */
export const dynamic = "force-dynamic";
// A full run across ~30 accounts takes over a minute -- at 60 the function
// was killed mid-list with an HTTP 504, and whichever accounts sat at the
// tail never synced: six Instagram accounts were found six days stale while
// their siblings refreshed every morning. 300s is the Fluid Compute ceiling.
// The ordering fix in runSync (stalest accounts first) is the structural
// guard: even if a run still dies, starvation can no longer be chronic.
export const maxDuration = 300;

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
  const accountId = url.searchParams.get("account") ?? undefined;
  // One platform per call, so the scheduler can spread ~30 accounts across
  // several bounded requests instead of one that outruns maxDuration. The
  // first live cron run took over ten minutes and only completed because
  // curl retried it in pieces -- which reported a red X for work that had
  // actually succeeded.
  const platformSlug = url.searchParams.get("platform") ?? undefined;
  // Batch size. Even one platform can outrun the limit -- Instagram's eleven
  // accounts are ~27s each through Apify and returned 504 every time -- so
  // the caller asks for a few at a time and repeats until a batch comes back
  // short. Absent means "everything", which is what a manual run wants.
  const maxRaw = Number(url.searchParams.get("max"));
  const maxAccounts = Number.isFinite(maxRaw) && maxRaw > 0 ? Math.floor(maxRaw) : undefined;
  // What makes the batching terminate. The caller pins this to the moment it
  // started, so accounts it has already synced drop out of the queue instead
  // of rotating back to the front -- see runSync's staleBefore.
  const staleBefore = url.searchParams.get("staleBefore") ?? undefined;
  // Vercel Cron never sends this -- it is for a deliberate operator call
  // (e.g. a fresh account's first import) that wants the fuller manual
  // catch-up rather than the throttled automatic cadence. Safe to expose:
  // both paths require the same bearer secret, this only changes which of
  // an already-authorised caller's own budget pools gets spent.
  const trigger = url.searchParams.get("trigger") === "manual" ? "manual" : "cron";

  try {
    const db = serviceClient();
    const started = Date.now();
    const results = await runSync(db, {
      workspaceId,
      accountId,
      platformSlug,
      maxAccounts,
      staleBefore,
      trigger,
    });

    // The pages themselves are dynamically rendered (session-based) and
    // always hit the database fresh, so this is not what keeps data
    // correct -- it is what keeps a browser tab already sitting on /content
    // from serving a client-side Router Cache entry captured before this
    // run wrote anything. The tag bust is different: a sync writes
    // snapshots, which feed the cached rankings model.
    if (results.some((r) => r.status === "ok")) {
      revalidatePath("/content");
      revalidatePath("/accounts");
      revalidateTag("rankings", "max");
    }

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
