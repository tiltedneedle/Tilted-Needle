import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import ClientImage from "@/components/ClientImage";
import { ClientImageControl, DeleteGuidelinesButton } from "@/components/ClientMetaControls";
import GuidelineSections from "@/components/GuidelineSections";
import AssetKit from "@/components/AssetKit";
import { PLATFORM_COLORS, canManage } from "@/lib/types";
import { requireSession } from "@/lib/workspace";
import { loadGuidelineDetail } from "@/lib/guidelines";

/**
 * One client's guideline and editor kit.
 *
 * Written rules on the left, the kit on the right on a wide screen: the prose
 * is read once when you pick up a client, the kit is grabbed from on every
 * video, so they should not be competing for the same column. Below the fold
 * on narrow screens the kit comes first, for the same reason.
 */
export default async function GuidelinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const detail = await loadGuidelineDetail(session.active.id, id);
  if (!detail) notFound();

  const { client, sections, assets, handles } = detail;
  const manages = canManage(session.active.role);
  const complete = client.sectionsTotal > 0 && client.sectionsFilled === client.sectionsTotal;

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <Link
        href="/guidelines"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
      >
        <ArrowLeft size={14} /> Guidelines
      </Link>

      <header className="mb-7 flex flex-wrap items-start gap-4 border-b border-[var(--border)] pb-5">
        <ClientImage name={client.name} seed={client.id} src={client.imageUrl} size={84} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{client.name}</h1>
            {client.isArchived && (
              <span className="rounded-full bg-[var(--bg-subtle)] px-2 py-0.5 text-[11px] text-[var(--muted)]">
                Past client
              </span>
            )}
          </div>

          {handles.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              {handles.map((h) => (
                <span key={`${h.platform}-${h.handle}`} className="flex items-center gap-1.5 text-xs">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: PLATFORM_COLORS[h.platform] ?? "var(--muted)" }}
                  />
                  <span className="text-[var(--muted)]">@{h.handle}</span>
                </span>
              ))}
            </div>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
            <span
              className={`rounded-full px-2 py-0.5 ${
                complete
                  ? "bg-[var(--success)]/10 text-[var(--success)]"
                  : "bg-[var(--bg-subtle)]"
              }`}
            >
              {complete
                ? "Guide complete"
                : `${client.sectionsFilled}/${client.sectionsTotal} sections written`}
            </span>
            <span>
              {assets.length} asset{assets.length === 1 ? "" : "s"} in the kit
            </span>
          </div>

          {/* Both controls live here rather than in a settings page: this is
              the only screen that shows a client's picture and its guidelines
              together, so it is where changing either makes sense. */}
          {manages && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <ClientImageControl clientId={client.id} currentUrl={client.imageUrl} />
              <DeleteGuidelinesButton clientId={client.id} clientName={client.name} />
            </div>
          )}
        </div>

        {client.docUrl && (
          <a
            href={client.docUrl}
            target="_blank"
            rel="noreferrer"
            className="flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] px-3 py-1.5 text-xs font-medium transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-subtle)]"
          >
            <ExternalLink size={13} /> Source doc
          </a>
        )}
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="order-2 lg:order-1">
          <GuidelineSections clientId={client.id} sections={sections} canManage={manages} />
        </div>
        <div className="order-1 lg:order-2">
          <AssetKit clientId={client.id} assets={assets} canManage={manages} />
        </div>
      </div>
    </div>
  );
}
