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
/**
 * Removes an entire client's guidelines: every section and every asset.
 *
 * deleteSection and deleteAsset already existed, but only one row at a time.
 * Clearing a client that had accumulated a dozen sections meant a dozen
 * confirmations, which is the kind of friction that leads to nobody clearing
 * anything -- so stale guidance stays on screen and gets treated as current.
 *
 * Deliberately does NOT touch the client, its image, or its document link.
 * "Delete the guidelines" means the written guidance, not the client record;
 * conflating the two is how someone loses a client by tidying up.
 */
export async function deleteAllGuidelines(
  clientId: string,
): Promise<Result & { summary?: string }> {
  const session = await requireSession();
  const supabase = await createClient();

  // Ownership is proven through the user's own RLS-bound client: a client in
  // another workspace simply does not come back.
  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .is("deleted_at", null)
    .eq("id", clientId)
    .eq("workspace_id", session.active.id)
    .maybeSingle();
  if (!client) return { error: "That client was not found." };

  const [{ count: sectionCount }, { count: assetCount }] = await Promise.all([
    supabase
      .from("client_guideline_sections")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId),
    supabase
      .from("client_assets")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId),
  ]);

  if ((sectionCount ?? 0) === 0 && (assetCount ?? 0) === 0) {
    return { error: "There are no guidelines to delete." };
  }

  const { error: sErr } = await supabase
    .from("client_guideline_sections")
    .delete()
    .eq("client_id", clientId);
  if (sErr) return { error: sErr.message };

  const { error: aErr } = await supabase
    .from("client_assets")
    .delete()
    .eq("client_id", clientId);
  if (aErr) return { error: aErr.message };

  revalidatePath("/guidelines", "layout");
  return {
    summary:
      `Deleted ${sectionCount ?? 0} section${sectionCount === 1 ? "" : "s"} and ` +
      `${assetCount ?? 0} asset${assetCount === 1 ? "" : "s"} for ${
        (client as { name: string }).name
      }.`,
  };
}

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
    // A binned client is not editable. This is an UPDATE rather than a read,
    // and the same rule applies: writing guidelines to something the user
    // believes they deleted would resurrect part of it silently.
    .is("deleted_at", null)
    .eq("id", clientId)
    .eq("workspace_id", session.active.id);
  if (error) return { error: error.message };
  revalidatePath("/guidelines", "layout");
  return {};
}
