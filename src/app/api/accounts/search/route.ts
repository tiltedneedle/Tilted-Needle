import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { providerFor } from "@/lib/providers";
import { canManage, type WorkspaceRole } from "@/lib/types";

/**
 * Live account lookup for the "add an account" picker.
 *
 * Gated on an active manager session rather than left open, because each
 * free-text query costs 100 YouTube quota units out of a daily 10,000. An
 * unauthenticated endpoint here would let anyone exhaust the day's budget in
 * about a minute and stop every workspace's sync.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const platform = url.searchParams.get("platform") ?? "";
  const query = (url.searchParams.get("q") ?? "").trim();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: memberships } = await supabase
    .from("memberships")
    .select("role, is_active")
    .eq("user_id", auth.user.id)
    .eq("is_active", true);

  const manages = (memberships ?? []).some((m) =>
    canManage(m.role as WorkspaceRole),
  );
  if (!manages) {
    return NextResponse.json(
      { error: "Only managers and above can look up accounts." },
      { status: 403 },
    );
  }

  const provider = providerFor(platform);
  if (!provider) {
    return NextResponse.json({ error: `Unknown platform "${platform}".` }, { status: 400 });
  }
  if (!provider.capability.canDiscover) {
    return NextResponse.json(
      { error: provider.capability.reason, remedy: provider.capability.remedy, candidates: [] },
      { status: 200 },
    );
  }
  if (!provider.isConfigured()) {
    return NextResponse.json(
      {
        error: `${provider.missingEnv().join(", ")} is not set, so ${platform} cannot be searched.`,
        candidates: [],
      },
      { status: 200 },
    );
  }

  // Below two characters every query is noise, and each one would still cost
  // quota. The client debounces too; this is the backstop.
  if (query.length < 2) return NextResponse.json({ candidates: [] });

  const result = await provider.search(query);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, candidates: [] }, { status: 200 });
  }

  return NextResponse.json({ candidates: result.data });
}
