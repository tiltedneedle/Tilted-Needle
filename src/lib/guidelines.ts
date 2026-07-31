/**
 * Loaders for the Guidelines section.
 *
 * A client's brand rules and the reusable pieces an editor drops into every
 * video for them. Kept apart from lib/dashboards.ts on purpose: that file is
 * about what got made and how it performed, this one is about how the next
 * one should be made.
 */
import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/selectAll";

export type GuidelineSection = {
  id: string;
  title: string;
  body: string | null;
  sortOrder: number;
};

export type ClientAsset = {
  id: string;
  kind: string;
  label: string;
  body: string | null;
  url: string | null;
  notes: string | null;
  sortOrder: number;
};

export type GuidelineClient = {
  id: string;
  name: string;
  imageUrl: string | null;
  docUrl: string | null;
  isArchived: boolean;
  platforms: string[];
  /** How much of the guideline is actually written -- drives the grid's meter. */
  sectionsFilled: number;
  sectionsTotal: number;
  assetCount: number;
};

/** The grid: one card per client, with enough to show progress at a glance. */
export async function loadGuidelineClients(ws: string): Promise<GuidelineClient[]> {
  const supabase = await createClient();

  const [clientsRes, accountsRes, sectionsRes, assetsRes] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, image_url, guideline_doc_url, is_archived")
      .eq("workspace_id", ws)
      .order("name"),
    supabase
      .from("accounts")
      .select("client_id, platform_slug")
      .eq("workspace_id", ws)
      .eq("is_archived", false),
    // Both of these are one row per client per section/asset and grow with the
    // roster, so they page rather than trusting a single 1000-row response.
    selectAll<{ client_id: string; body: string | null }>(() =>
      supabase
        .from("client_guideline_sections")
        .select("client_id, body")
        .eq("workspace_id", ws)
        .order("id"),
    ),
    selectAll<{ client_id: string }>(() =>
      supabase.from("client_assets").select("client_id").eq("workspace_id", ws).order("id"),
    ),
  ]);

  const platforms = new Map<string, Set<string>>();
  for (const a of (accountsRes.data ?? []) as { client_id: string | null; platform_slug: string }[]) {
    if (!a.client_id) continue;
    if (!platforms.has(a.client_id)) platforms.set(a.client_id, new Set());
    platforms.get(a.client_id)!.add(a.platform_slug);
  }

  const total = new Map<string, number>();
  const filled = new Map<string, number>();
  for (const s of sectionsRes.data ?? []) {
    total.set(s.client_id, (total.get(s.client_id) ?? 0) + 1);
    if (s.body && s.body.trim()) filled.set(s.client_id, (filled.get(s.client_id) ?? 0) + 1);
  }

  const assets = new Map<string, number>();
  for (const a of assetsRes.data ?? []) {
    assets.set(a.client_id, (assets.get(a.client_id) ?? 0) + 1);
  }

  type Row = {
    id: string;
    name: string;
    image_url: string | null;
    guideline_doc_url: string | null;
    is_archived: boolean;
  };
  return ((clientsRes.data ?? []) as Row[]).map((c) => ({
    id: c.id,
    name: c.name,
    imageUrl: c.image_url,
    docUrl: c.guideline_doc_url,
    isArchived: c.is_archived,
    platforms: [...(platforms.get(c.id) ?? [])].sort(),
    sectionsFilled: filled.get(c.id) ?? 0,
    sectionsTotal: total.get(c.id) ?? 0,
    assetCount: assets.get(c.id) ?? 0,
  }));
}

export type GuidelineDetail = {
  client: GuidelineClient;
  sections: GuidelineSection[];
  assets: ClientAsset[];
  /** Handles per platform, so the page can show where this client publishes. */
  handles: { platform: string; handle: string }[];
};

export async function loadGuidelineDetail(
  ws: string,
  clientId: string,
): Promise<GuidelineDetail | null> {
  const supabase = await createClient();

  const { data: client } = await supabase
    .from("clients")
    .select("id, name, image_url, guideline_doc_url, is_archived")
    .eq("id", clientId)
    .eq("workspace_id", ws)
    .maybeSingle();
  if (!client) return null;

  const [sectionsRes, assetsRes, accountsRes] = await Promise.all([
    supabase
      .from("client_guideline_sections")
      .select("id, title, body, sort_order")
      .eq("client_id", clientId)
      .order("sort_order")
      .order("id"),
    supabase
      .from("client_assets")
      .select("id, kind, label, body, url, notes, sort_order")
      .eq("client_id", clientId)
      .order("sort_order")
      .order("id"),
    supabase
      .from("accounts")
      .select("platform_slug, handle")
      .eq("client_id", clientId)
      .eq("is_archived", false)
      .order("platform_slug"),
  ]);

  const sections = ((sectionsRes.data ?? []) as {
    id: string;
    title: string;
    body: string | null;
    sort_order: number;
  }[]).map((s) => ({ id: s.id, title: s.title, body: s.body, sortOrder: s.sort_order }));

  const assets = ((assetsRes.data ?? []) as {
    id: string;
    kind: string;
    label: string;
    body: string | null;
    url: string | null;
    notes: string | null;
    sort_order: number;
  }[]).map((a) => ({
    id: a.id,
    kind: a.kind,
    label: a.label,
    body: a.body,
    url: a.url,
    notes: a.notes,
    sortOrder: a.sort_order,
  }));

  const handles = ((accountsRes.data ?? []) as { platform_slug: string; handle: string }[]).map(
    (a) => ({ platform: a.platform_slug, handle: a.handle }),
  );

  return {
    client: {
      id: client.id,
      name: client.name,
      imageUrl: client.image_url,
      docUrl: client.guideline_doc_url,
      isArchived: client.is_archived,
      platforms: [...new Set(handles.map((h) => h.platform))],
      sectionsFilled: sections.filter((s) => s.body && s.body.trim()).length,
      sectionsTotal: sections.length,
      assetCount: assets.length,
    },
    sections,
    assets,
    handles,
  };
}
