import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Everything the command palette can jump to, in one round trip.
 *
 * Fetched once per palette OPEN, not per keystroke: the whole workspace is a
 * few hundred names, filtering that in the client is instant, and a
 * per-keystroke endpoint would be a rate-limit surface for no gain.
 *
 * Session-scoped and read through the user's own client, so RLS decides what
 * each person may see -- this route adds no reach a page does not already
 * have. Videos are capped at the most recent 400 by production date: the
 * palette is "jump to what I am working on", not an archive search, and the
 * archive already has /content's filters.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const [clientsRes, videosRes] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name")
      .is("deleted_at", null)
      .eq("is_archived", false)
      .order("name"),
    supabase
      .from("content_items")
      .select("id, title, client:clients(name)")
      .order("produced_at", { ascending: false, nullsFirst: false })
      .limit(400),
  ]);

  return NextResponse.json({
    clients: (clientsRes.data ?? []).map((c) => ({ id: c.id, name: c.name })),
    videos: (videosRes.data ?? []).map((v) => ({
      id: v.id,
      title: v.title,
      client: (Array.isArray(v.client) ? v.client[0] : v.client)?.name ?? null,
    })),
  });
}
