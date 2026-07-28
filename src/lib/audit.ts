import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Records an accountability entry. Callers pass their own request-scoped
 * client so the insert runs as the acting user and is itself subject to the
 * audit_log RLS policies -- there is no service-role bypass here, because an
 * audit trail that writes outside the rules it audits is not trustworthy.
 *
 * Fire-and-forget by design: a logging failure must never block the action
 * being logged (approving a timesheet should not fail because the audit
 * insert had a transient error).
 */
export async function logAudit(
  supabase: SupabaseClient,
  input: {
    workspaceId: string;
    actorId: string;
    action: string;
    entityType: string;
    entityId?: string | null;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await supabase.from("audit_log").insert({
    workspace_id: input.workspaceId,
    actor_id: input.actorId,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    detail: input.detail ?? {},
  });
  if (error) console.error(`audit log write failed for ${input.action}:`, error.message);
}
