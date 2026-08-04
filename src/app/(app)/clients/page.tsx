import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import NewClientForm from "@/components/NewClientForm";
import ClientActiveToggle from "@/components/ClientActiveToggle";
import { Empty } from "@/components/Stat";
import { PLATFORM_COLORS } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { canManage } from "@/lib/types";

const PLATFORM_LABEL: Record<string, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
};

/**
 * Clients section, entry point. One card per client with the platforms they
 * are on at a glance; open one to see its channels, open a channel for its
 * own dashboard. Kept separate from the Content dashboard on purpose --
 * that page answers "what got made and how did it do," this one answers
 * "who is this client and where do they publish."
 */
export default async function ClientsPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;

  const [clientsRes, accountsRes] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, is_archived")
      .eq("workspace_id", ws)
      .order("name"),
    supabase
      .from("accounts")
      .select("client_id, platform_slug")
      .eq("workspace_id", ws)
      .eq("is_archived", false),
  ]);

  type ClientRow = { id: string; name: string; is_archived: boolean };
  const clients = (clientsRes.data ?? []) as ClientRow[];
  const platformsByClient = new Map<string, Set<string>>();
  for (const a of (accountsRes.data ?? []) as { client_id: string | null; platform_slug: string }[]) {
    if (!a.client_id) continue;
    if (!platformsByClient.has(a.client_id)) platformsByClient.set(a.client_id, new Set());
    platformsByClient.get(a.client_id)!.add(a.platform_slug);
  }

  const active = clients.filter((c) => !c.is_archived);
  const archived = clients.filter((c) => c.is_archived);

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <PageHeader
        title="Clients"
        subtitle="Every client and the channels they publish on. Open one to see its channels; open a channel for its own dashboard."
      />

      {canManage(session.active.role) && <NewClientForm workspaceId={ws} />}

      {active.length === 0 ? (
        <Empty>No active clients. Check below if one should be reactivated.</Empty>
      ) : (
        <div className="stagger grid gap-2.5 sm:grid-cols-2">
          {active.map((c) => (
            <Link
              key={c.id}
              href={`/clients/${c.id}`}
              className="card card-interactive animate-rise flex items-center gap-3 p-4 transition-colors hover:bg-[var(--bg-subtle)]"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{c.name}</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {[...(platformsByClient.get(c.id) ?? [])].map((p) => (
                    <span
                      key={p}
                      className="flex items-center gap-1 rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[11px]"
                    >
                      <span
                        className="size-1.5 rounded-full"
                        style={{ background: PLATFORM_COLORS[p] ?? "var(--muted)" }}
                      />
                      {PLATFORM_LABEL[p] ?? p}
                    </span>
                  ))}
                  {(platformsByClient.get(c.id)?.size ?? 0) === 0 && (
                    <span className="text-[11px] text-[var(--muted)]">No channels yet</span>
                  )}
                </div>
              </div>
              {canManage(session.active.role) && (
                <ClientActiveToggle clientId={c.id} isActive={!c.is_archived} />
              )}
            </Link>
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <details className="mt-6" open={active.length === 0}>
          <summary className="cursor-pointer text-xs text-[var(--muted)]">
            {archived.length} inactive client{archived.length === 1 ? "" : "s"}
          </summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {archived.map((c) => (
              <Link
                key={c.id}
                href={`/clients/${c.id}`}
                className="card flex items-center gap-3 p-3 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--bg-subtle)]"
              >
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                {canManage(session.active.role) && (
                  <ClientActiveToggle clientId={c.id} isActive={!c.is_archived} />
                )}
              </Link>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/** Browser-tab identity; the root layout template appends the app name. */
export const metadata = { title: "Clients" };
