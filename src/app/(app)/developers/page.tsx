import PageHeader from "@/components/PageHeader";
import DevelopersManager from "@/components/DevelopersManager";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { canManage } from "@/lib/types";
import { WEBHOOK_EVENTS } from "@/lib/webhooks";

export default async function DevelopersPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;

  if (!canManage(session.active.role)) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-6">
        <PageHeader title="Developers" subtitle="" />
        <div className="card p-8 text-sm text-[var(--muted)]">
          Only owners, admins, and managers manage API keys and webhooks.
        </div>
      </div>
    );
  }

  const [keysRes, hooksRes] = await Promise.all([
    supabase
      .from("api_keys")
      .select("id, name, key_prefix, created_at, last_used_at, revoked_at")
      .eq("workspace_id", ws)
      .order("created_at", { ascending: false }),
    supabase
      .from("webhooks")
      .select("id, url, events, is_active, created_at")
      .eq("workspace_id", ws)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <PageHeader
        title="Developers"
        subtitle="API keys authenticate GET requests to the read-only public API. Webhooks push events out."
      />
      <DevelopersManager
        workspaceId={ws}
        apiKeys={
          (keysRes.data ?? []) as {
            id: string;
            name: string;
            key_prefix: string;
            created_at: string;
            last_used_at: string | null;
            revoked_at: string | null;
          }[]
        }
        webhooks={
          (hooksRes.data ?? []) as {
            id: string;
            url: string;
            events: string[];
            is_active: boolean;
            created_at: string;
          }[]
        }
        availableEvents={[...WEBHOOK_EVENTS]}
      />
    </div>
  );
}
