import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import ClientDashboard from "@/components/ClientDashboard";
import { EmptyScreen } from "@/components/Stat";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { canManage, one } from "@/lib/types";
import { totalsByPlatform, type MetricRow } from "@/lib/rollup";
import { Eye, Briefcase } from "lucide-react";

/**
 * The client-facing view: one client, their delivered work, nothing else.
 *
 * WHOSE PORTAL THIS IS HAS TO BE DECIDED, NOT ASSUMED.
 *
 * This page used to take the first client RLS would hand back --
 * `.limit(1).maybeSingle()` with no filter -- and then query content and
 * posts with no client filter at all, trusting row-level security to scope
 * everything. For a client user that is right: RLS returns exactly their
 * rows. For anyone else it was badly wrong, and staff can reach this route
 * (the layout guard only redirects clients AWAY from staff pages; it never
 * kept staff off this one).
 *
 * Rendered as the owner it printed the heading "Youmi Khoury" above 466
 * videos and 60.5M views -- every client in the workspace, aggregated, under
 * one arbitrary client's name, mixing eye-surgery posts with private-jet
 * content. Nobody had seen it, because the workspace has no client users at
 * all: this surface has never been exercised by the role it exists for.
 *
 * So the client is now resolved explicitly and every query is filtered by it.
 * RLS stays the boundary -- this is defence in depth, the same reasoning the
 * layout guard already applies -- but a page that cannot say whose data it is
 * showing must not show any.
 */
export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const session = await requireSession();
  const supabase = await createClient();
  const sp = await searchParams;
  const staff = canManage(session.active.role);

  /**
   * A client user's own id comes from their membership -- the same row
   * `my_client_id()` reads inside the RLS policies, so the page and the
   * database agree on who they are by construction.
   *
   * Staff must name the client. Previewing a client's portal is a real need
   * ("what do they actually see?"), but it is a request for a SPECIFIC
   * client, and guessing is what produced the mixed page above.
   */
  const { data: membership } = await supabase
    .from("memberships")
    .select("client_id")
    .eq("workspace_id", session.active.id)
    .eq("user_id", session.userId)
    .eq("is_active", true)
    .maybeSingle();

  const clientId = staff ? (sp.client ?? null) : (membership?.client_id ?? null);

  /* Staff with no client named: offer the list rather than invent an answer. */
  if (staff && !clientId) {
    const { data: clients } = await supabase
      .from("clients")
      .select("id, name")
      .is("deleted_at", null)
      .eq("is_archived", false)
      .order("name");
    return (
      <div className="mx-auto max-w-4xl px-6 py-6">
        <PageHeader
          title="Client portal"
          subtitle="What a client sees when they sign in. Pick one to preview."
        />
        {(clients ?? []).length === 0 ? (
          <EmptyScreen
            icon={Briefcase}
            title="No clients yet"
            hint="The portal shows one client their delivered work and its results. Add a client first, then preview what they will see."
          />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {(clients ?? []).map((c) => (
              <Link
                key={c.id}
                href={`/portal?client=${c.id}`}
                className="card card-interactive flex items-center gap-2.5 p-4 text-sm transition-colors hover:bg-[var(--bg-subtle)]"
              >
                <Eye size={15} className="shrink-0 text-[var(--muted)]" />
                <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  /* A client user whose membership names no client. RLS would return nothing
     anyway, so this is the honest message instead of an empty dashboard. */
  if (!clientId) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-6">
        <PageHeader title={session.active.name} />
        <EmptyScreen
          icon={Briefcase}
          title="This account is not linked to a client yet"
          hint="Your sign-in works, but nobody has connected it to a client record — so there is nothing to show. Ask your account manager to finish the setup."
        />
      </div>
    );
  }

  const [clientRes, itemsRes, postsRes] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name")
      .eq("id", clientId)
      .is("deleted_at", null)
      .maybeSingle(),
    // Approved only. The portal is the agency's claim about what it
    // delivered, so a video the client posted themselves does not belong in
    // it -- not as a row and not in the totals. Hiding it entirely, rather
    // than listing it and excluding it from the figures, was the deliberate
    // choice: a portal where a row and a total disagree needs explaining
    // every time a client reads it.
    supabase
      .from("content_items")
      .select("id, title, produced_at, length_seconds, subject")
      .eq("client_id", clientId)
      .eq("review_state", "approved")
      .order("produced_at", { ascending: false, nullsFirst: false }),
    supabase
      .from("platform_posts")
      .select(
        "content_item_id, posted_at, account:accounts(platform_slug), metrics:post_current_metrics(views, likes, comments)",
      ),
  ]);

  /* A staff preview of a client that does not exist -- a stale link, a
     deleted client -- must not fall through to an empty dashboard wearing
     the workspace's name. */
  if (!clientRes.data) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-6">
        <PageHeader title="Client portal" />
        <EmptyScreen
          icon={Briefcase}
          title="No such client"
          hint="This link points at a client that has been removed, or that you cannot see."
        >
          <Link href="/portal" className="btn">
            Pick a client
          </Link>
        </EmptyScreen>
      </div>
    );
  }

  type Item = {
    id: string;
    title: string;
    produced_at: string | null;
    length_seconds: number | null;
    subject: string | null;
  };
  type PostRow = {
    content_item_id: string;
    account: { platform_slug: string } | { platform_slug: string }[] | null;
    metrics:
      | { views: number | null; likes: number | null; comments: number | null }
      | { views: number | null; likes: number | null; comments: number | null }[]
      | null;
  };

  const items = (itemsRes.data ?? []) as Item[];
  const metricRows: MetricRow[] = [];
  const perItem = new Map<string, { platform: string; views: number }[]>();

  /* The posts query cannot filter on approval by itself, so it is narrowed to
     the items that survived above -- which are now this client's items only,
     so the same pass also keeps other clients' posts out of the totals.
     Without it the client's own posts would be absent from the LIST while
     still inflating the platform TOTALS: a figure they cannot reconcile
     against anything on screen, and one that overstates what was delivered. */
  const shown = new Set(items.map((i) => i.id));

  for (const p of (postsRes.data ?? []) as unknown as PostRow[]) {
    if (!shown.has(p.content_item_id)) continue;
    const acct = one(p.account);
    if (!acct) continue;
    const m = one(p.metrics);
    metricRows.push({
      platform: acct.platform_slug,
      views: m?.views ?? 0,
      likes: m?.likes ?? 0,
      comments: m?.comments ?? 0,
    });
    if (!perItem.has(p.content_item_id)) perItem.set(p.content_item_id, []);
    perItem
      .get(p.content_item_id)!
      .push({ platform: acct.platform_slug, views: m?.views ?? 0 });
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      {/* Staff need to know they are looking at somebody else's view, or they
          will read these numbers as the workspace's. Never rendered for the
          client whose portal it is. */}
      {staff && (
        <div className="no-print mb-4 flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2 text-xs">
          <Eye size={13} className="shrink-0 text-[var(--muted)]" />
          <span className="text-[var(--muted)]">
            Previewing what <span className="font-medium text-[var(--fg)]">{clientRes.data.name}</span> sees.
            Internal hours and costs are hidden here.
          </span>
          <Link href="/portal" className="ml-auto underline decoration-dotted underline-offset-2">
            Switch client
          </Link>
        </div>
      )}
      <PageHeader
        title={clientRes.data.name}
        subtitle="Everything published for you, with results kept separate by platform."
      />
      {items.length === 0 ? (
        <EmptyScreen
          icon={Briefcase}
          title="Nothing published yet"
          hint="Approved work appears here as soon as it goes out, with its reach on each platform kept separate."
        />
      ) : (
        <ClientDashboard
          totals={totalsByPlatform(metricRows)}
          itemCount={items.length}
          // Internal hours are deliberately not surfaced to clients; passing 0
          // suppresses the time and hours-per-1k figures.
          trackedSeconds={0}
          items={items.map((i) => ({
            id: i.id,
            title: i.title,
            producedAt: i.produced_at,
            platforms: perItem.get(i.id) ?? [],
          }))}
          readOnly
        />
      )}
    </div>
  );
}
