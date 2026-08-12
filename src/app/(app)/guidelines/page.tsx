import Link from "next/link";
import { FileText } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import ClientImage from "@/components/ClientImage";
import ClientActiveToggle from "@/components/ClientActiveToggle";
import NewGuidelineClient from "@/components/NewGuidelineClient";
import { canManage, PLATFORM_COLORS } from "@/lib/types";
import { requireSession } from "@/lib/workspace";
import { loadGuidelineClients, type GuidelineClient } from "@/lib/guidelines";

/**
 * Guidelines, entry point. One card per client, led by their picture.
 *
 * The grid is faces first because that is how the team refers to this work --
 * "the Steve videos", "Frankie's watches" -- and a wall of names in a list
 * reads slower than a wall of faces. Each card carries how complete that
 * client's guide actually is, so the gaps are visible from the index rather
 * than only after opening one.
 */
export default async function GuidelinesPage() {
  const session = await requireSession();
  const clients = await loadGuidelineClients(session.active.id);
  // Gated on the server. A non-manager never receives the markup, so the RLS
  // refusal path is never something the UI can walk someone into.
  const manages = canManage(session.active.role);

  const active = clients.filter((c) => !c.isArchived);
  const past = clients.filter((c) => c.isArchived);

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <PageHeader
        title="Guidelines"
        subtitle="How each client's content gets made — the rules, and the pieces every video needs."
      >
        {manages && <NewGuidelineClient workspaceId={session.active.id} />}
      </PageHeader>

      {active.length === 0 && past.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No clients yet.</p>
      ) : (
        <>
          <Grid clients={active} canManage={manages} />
          {past.length > 0 && (
            <div className="mt-10">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
                Past clients
              </h2>
              <Grid clients={past} canManage={manages} dimmed />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Grid({
  clients,
  canManage: manages,
  dimmed = false,
}: {
  clients: GuidelineClient[];
  canManage: boolean;
  dimmed?: boolean;
}) {
  return (
    <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {clients.map((c) => (
        <Card key={c.id} client={c} canManage={manages} dimmed={dimmed} />
      ))}
    </div>
  );
}

function Card({
  client: c,
  canManage: manages,
  dimmed,
}: {
  client: GuidelineClient;
  canManage: boolean;
  dimmed: boolean;
}) {
  const pct = c.sectionsTotal ? Math.round((c.sectionsFilled / c.sectionsTotal) * 100) : 0;
  const complete = c.sectionsTotal > 0 && c.sectionsFilled === c.sectionsTotal;

  return (
    <Link
      href={`/guidelines/${c.id}`}
      className={`group animate-rise flex flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] transition-all hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-card-hover)] ${
        dimmed ? "opacity-70 hover:opacity-100" : ""
      }`}
    >
      {/* The picture is the card's identity, so it gets the full width rather
          than sitting as a small avatar beside the name. */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-[var(--bg-subtle)]">
        <ClientImage
          name={c.name}
          seed={c.id}
          src={c.imageUrl}
          fill
          rounded="rounded-none"
          className="transition-transform duration-300 group-hover:scale-[1.03]"
        />
        {c.docUrl && (
          <span
            className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm"
            title="Has a source document"
          >
            <FileText size={12} />
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{c.name}</h3>
          <div className="flex shrink-0 items-center gap-1 pt-1">
            {c.platforms.map((p) => (
              <span
                key={p}
                className="size-2 rounded-full"
                style={{ background: PLATFORM_COLORS[p] ?? "var(--muted)" }}
                title={p}
              />
            ))}
          </div>
        </div>

        {/* "Remove" is archive, never delete. content_items.client_id is
            ON DELETE SET NULL, so deleting a client would silently orphan
            every video it owned -- and accounts, projects, invoices and
            expenses all reference it too. Archiving is reversible and is the
            mechanism the rest of the app already uses. */}
        {manages && (
          <div className="flex items-center gap-2">
            <ClientActiveToggle clientId={c.id} isActive={!c.isArchived} />
          </div>
        )}

        <div className="mt-auto">
          <div className="mb-1 flex items-center justify-between text-[11px] text-[var(--muted)]">
            <span>
              {complete ? "Guide complete" : `${c.sectionsFilled}/${c.sectionsTotal} sections`}
            </span>
            <span>{c.assetCount} asset{c.assetCount === 1 ? "" : "s"}</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-[var(--bg-subtle)]">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${pct}%`,
                background: complete ? "var(--success)" : "var(--accent)",
              }}
            />
          </div>
        </div>
      </div>
    </Link>
  );
}

/** Browser-tab identity; the root layout template appends the app name. */
export const metadata = { title: "Guidelines" };
