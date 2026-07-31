"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";

type Result = { error?: string };

/**
 * Writes go through the caller's own Supabase client, so RLS is the
 * authorization boundary rather than a role check duplicated here. Members can
 * edit guidelines (an editor who spots a stale CTA should fix it in the
 * moment); deletes are manager-only and the policy enforces that -- an
 * unauthorised delete comes back as an error rather than silently succeeding.
 */

function touch(userId: string) {
  return { updated_at: new Date().toISOString(), updated_by: userId };
}

export async function saveSection(sectionId: string, body: string): Promise<Result> {
  const session = await requireSession();
  const supabase = await createClient();
  const { error } = await supabase
    .from("client_guideline_sections")
    .update({ body: body.trim() || null, ...touch(session.userId) })
    .eq("id", sectionId)
    .eq("workspace_id", session.active.id);
  if (error) return { error: error.message };
  revalidatePath("/guidelines", "layout");
  return {};
}

export async function addSection(clientId: string, title: string): Promise<Result> {
  const trimmed = title.trim();
  if (!trimmed) return { error: "Give the section a title." };

  const session = await requireSession();
  const supabase = await createClient();

  // New sections land at the end rather than displacing the standard spine.
  const { data: last } = await supabase
    .from("client_guideline_sections")
    .select("sort_order")
    .eq("client_id", clientId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("client_guideline_sections").insert({
    workspace_id: session.active.id,
    client_id: clientId,
    title: trimmed,
    body: null,
    sort_order: (last?.sort_order ?? -1) + 1,
    updated_by: session.userId,
  });
  if (error) return { error: error.message };
  revalidatePath("/guidelines", "layout");
  return {};
}

export async function deleteSection(sectionId: string): Promise<Result> {
  const session = await requireSession();
  const supabase = await createClient();
  const { error } = await supabase
    .from("client_guideline_sections")
    .delete()
    .eq("id", sectionId)
    .eq("workspace_id", session.active.id);
  if (error) return { error: error.message };
  revalidatePath("/guidelines", "layout");
  return {};
}

export type AssetInput = {
  kind: string;
  label: string;
  body?: string | null;
  url?: string | null;
  notes?: string | null;
};

export async function addAsset(clientId: string, input: AssetInput): Promise<Result> {
  const label = input.label.trim();
  if (!label) return { error: "Give the asset a name." };

  const session = await requireSession();
  const supabase = await createClient();

  const { data: last } = await supabase
    .from("client_assets")
    .select("sort_order")
    .eq("client_id", clientId)
    .eq("kind", input.kind)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("client_assets").insert({
    workspace_id: session.active.id,
    client_id: clientId,
    kind: input.kind,
    label,
    body: input.body?.trim() || null,
    url: input.url?.trim() || null,
    notes: input.notes?.trim() || null,
    sort_order: (last?.sort_order ?? -1) + 1,
    updated_by: session.userId,
  });
  if (error) return { error: error.message };
  revalidatePath("/guidelines", "layout");
  return {};
}

export async function updateAsset(assetId: string, input: AssetInput): Promise<Result> {
  const label = input.label.trim();
  if (!label) return { error: "Give the asset a name." };

  const session = await requireSession();
  const supabase = await createClient();
  const { error } = await supabase
    .from("client_assets")
    .update({
      kind: input.kind,
      label,
      body: input.body?.trim() || null,
      url: input.url?.trim() || null,
      notes: input.notes?.trim() || null,
      ...touch(session.userId),
    })
    .eq("id", assetId)
    .eq("workspace_id", session.active.id);
  if (error) return { error: error.message };
  revalidatePath("/guidelines", "layout");
  return {};
}

export async function deleteAsset(assetId: string): Promise<Result> {
  const session = await requireSession();
  const supabase = await createClient();
  const { error } = await supabase
    .from("client_assets")
    .delete()
    .eq("id", assetId)
    .eq("workspace_id", session.active.id);
  if (error) return { error: error.message };
  revalidatePath("/guidelines", "layout");
  return {};
}

/** Client photo and the link back to the source document. */
export async function updateClientMeta(
  clientId: string,
  fields: { imageUrl?: string | null; docUrl?: string | null },
): Promise<Result> {
  const session = await requireSession();
  const supabase = await createClient();

  const patch: Record<string, string | null> = {};
  if (fields.imageUrl !== undefined) patch.image_url = fields.imageUrl?.trim() || null;
  if (fields.docUrl !== undefined) patch.guideline_doc_url = fields.docUrl?.trim() || null;
  if (Object.keys(patch).length === 0) return {};

  const { error } = await supabase
    .from("clients")
    .update(patch)
    .eq("id", clientId)
    .eq("workspace_id", session.active.id);
  if (error) return { error: error.message };
  revalidatePath("/guidelines", "layout");
  return {};
}
