import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import ClientActiveToggle from "@/components/ClientActiveToggle";
import EditClientForm from "@/components/EditClientForm";
import { Empty } from "@/components/Stat";
import { PlatformChips } from "@/components/PlatformReach";
import { PLATFORM_COLORS, PLATFORM_LABEL, canManage } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { loadClientChannels } from "@/lib/channelDashboard";

export default async function ClientChannelsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;
  const manages = canManage(session.active.role);

  const data = await loadClientChannels(supabase, ws, id);
  if (!data) notFound();

  // The edit form needs the contact fields the channel loader has no
  // business carrying; one tiny targeted read, managers only.
  let contact: { email: string | null; note: string | null } = { email: null, note: null };
  if (manages) {
    const { data: row } = await supabase
      .from("clients")
      .select("email, note").is("deleted_at", null).is("deleted_at", null)
      .eq("id", id)
      .maybeSingle();
    contact = { email: row?.email ?? null, note: row?.note ?? null };
  }

  const live = data.channels.filter((c) => !c.isArchived);

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <Link
        href="/clients"
        className="mb-3 inline-block text-sm text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
      >
        ← Clients
      </Link>
      <PageHeader title={data.client.name} subtitle="Channels for this client. Open one for its own dashboard.">
        {manages && (
          <ClientActiveToggle clientId={id} isActive={!data.client.isArchived} size="md" />
        )}
        <Link
          href={`/accounts?client=${id}`}
          className="rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--fg)]"
        >
          Add or manage channels →
        </Link>
      </PageHeader>

      {manages && (
        <div className="mb-5 flex justify-end">
          <EditClientForm
            clientId={id}
            name={data.client.name}
            email={contact.email}
            note={contact.note}
          />
        </div>
      )}

      {live.length === 0 ? (
        <Empty>
          No channels yet for this client.{" "}
          <Link href={`/accounts?client=${id}`} className="text-[var(--accent)] hover:underline">
            Add one
          </Link>
          .
        </Empty>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {live.map((ch) => (
            <Link
              key={ch.accountId}
              href={`/clients/${id}/${ch.accountId}`}
              className="card animate-rise p-3.5 transition-colors hover:bg-[var(--bg-subtle)]"
            >
              <div className="flex items-center gap-2">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: PLATFORM_COLORS[ch.platformSlug] ?? "var(--muted)" }}
                />
                <span className="text-sm font-medium">
                  {PLATFORM_LABEL[ch.platformSlug] ?? ch.platformSlug}
                </span>
                <span className="truncate text-xs text-[var(--muted)]">
                  @{ch.handle.replace(/^@/, "")}
                </span>
              </div>

              <div className="mt-2 flex items-baseline gap-2">
                <span className="tabular text-lg font-semibold">
                  {ch.totalViews.toLocaleString()}
                </span>
                <span className="text-xs text-[var(--muted)]">
                  views across {ch.videoCount} video{ch.videoCount === 1 ? "" : "s"}
                </span>
              </div>

              <div className="mt-1.5 flex items-center justify-between">
                {ch.recentGain && ch.recentGain.views > 0 ? (
                  <span className="tabular text-xs text-emerald-500">
                    +{ch.recentGain.views.toLocaleString()}
                    <span className="ml-0.5 opacity-70">/{ch.recentGain.days.toFixed(0)}d</span>
                  </span>
                ) : (
                  <span className="text-xs text-[var(--muted)]">
                    {ch.lastSyncedAt ? "no recent change" : "not synced yet"}
                  </span>
                )}
                {ch.lastSyncError && (
                  <span
                    className="rounded bg-[var(--danger)]/10 px-1.5 py-0.5 text-[11px] text-[var(--danger)]"
                    title={ch.lastSyncError}
                  >
                    sync issue
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* All platforms this client's channels reach, for a quick recap above
          the per-channel cards -- the client-wide, cross-platform view still
          lives on Content; this is just a glance, not a duplicate. */}
      {live.length > 1 && (
        <p className="mt-4 text-xs text-[var(--muted)]">
          <PlatformChips
            platforms={live.map((c) => ({ platform: c.platformSlug, views: c.totalViews }))}
          />
        </p>
      )}
    </div>
  );
}
