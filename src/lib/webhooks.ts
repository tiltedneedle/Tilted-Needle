import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Dispatches an event to every active webhook subscribed to it, signing the
 * payload with HMAC-SHA256 so a receiver can verify it actually came from
 * this app and was not forged or altered in transit -- the same scheme
 * GitHub and Stripe webhooks use.
 *
 * Every attempt is logged to webhook_deliveries regardless of outcome: a
 * webhook a subscriber cannot reach must be debuggable from the delivery
 * history, not invisible.
 *
 * Fire-and-forget: called after the triggering action's own writes commit,
 * and a delivery failure must never roll back or fail the action itself.
 */
export async function dispatchWebhook(
  supabase: SupabaseClient,
  workspaceId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { data: hooks, error } = await supabase
    .from("webhooks")
    .select("id, url, secret, events")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true);

  if (error) {
    console.error("webhook lookup failed:", error.message);
    return;
  }

  const targets = (hooks ?? []).filter((h) => (h.events as string[]).includes(event));
  if (targets.length === 0) return;

  const body = JSON.stringify({ event, data: payload, sent_at: new Date().toISOString() });

  await Promise.all(
    targets.map(async (hook) => {
      const signature = createHmac("sha256", hook.secret).update(body).digest("hex");
      let statusCode: number | null = null;
      let deliveryError: string | null = null;

      try {
        const res = await fetch(hook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Tilted-Needle-Signature": `sha256=${signature}`,
            "X-Tilted-Needle-Event": event,
          },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        statusCode = res.status;
      } catch (e) {
        deliveryError = e instanceof Error ? e.message : "delivery failed";
      }

      await supabase.from("webhook_deliveries").insert({
        webhook_id: hook.id,
        event,
        payload,
        status_code: statusCode,
        error: deliveryError,
      });
    }),
  );
}

export const WEBHOOK_EVENTS = [
  "timesheet.approved",
  "timesheet.rejected",
  "invoice.generated",
  "time_off_request.approved",
  // Listed as subscribable, but nothing fires it yet. Detecting a boost is
  // a query over history (PRD 5), not a state transition triggered by one
  // action -- dispatching it from the Performance page's render would fire
  // on every page view rather than once per real boost. It needs a
  // scheduled job that diffs "boosting now" against "boosting last run",
  // which does not exist in this app yet.
  "content.boosted",
] as const;
