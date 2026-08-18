import type { PipelineStatus } from "@/components/PipelineHealth";
import { llmMonthlyTokenLimit } from "@/lib/llm";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

/**
 * Everything the operations panel needs, in one place (PRD §8.5).
 *
 * Deliberately tolerant: this is the screen an operator opens BECAUSE
 * something looks wrong, so a missing table or an empty queue must render as
 * "nothing here" rather than as an error page. A health display that itself
 * fails when the system is unhealthy is worse than none.
 */
export async function loadPipelineStatus(db: Db, ws: string): Promise<PipelineStatus> {
  const now = Date.now();

  const [hb, jobs, analyses, items, transcripts, clients, posts, analytics] = await Promise.all([
    db.from("worker_heartbeat").select("worker_id, last_seen_at, detail"),
    db.from("ingest_jobs").select("kind, status").eq("workspace_id", ws),
    db.from("ai_analyses").select("input_tokens, output_tokens, created_at").eq("workspace_id", ws),
    db.from("content_items").select("id, client_id").eq("workspace_id", ws),
    db.from("video_transcripts").select("content_item_id").eq("workspace_id", ws),
    db.from("clients").select("id, name").is("deleted_at", null).is("deleted_at", null).eq("workspace_id", ws).eq("is_archived", false),
    db.from("platform_posts").select("id, content_item_id").eq("workspace_id", ws),
    db.from("post_analytics").select("platform_post_id").eq("workspace_id", ws),
  ]);

  // Only workers seen in the last day are worth showing. Anything older is
  // archaeology, and listing it buries the one signal this panel exists for:
  // whether a worker that SHOULD be running has gone quiet.
  const RECENT_S = 86_400;
  const workers = ((hb.data ?? []) as {
    worker_id: string; last_seen_at: string; detail: Record<string, unknown>;
  }[])
    .map((w) => ({
      id: w.worker_id,
      secondsAgo: Math.max(0, (now - new Date(w.last_seen_at).getTime()) / 1000),
      detail: w.detail ?? {},
    }))
    .filter((w) => w.secondsAgo <= RECENT_S)
    .sort((a, b) => a.secondsAgo - b.secondsAgo);

  const byKind = new Map<string, PipelineStatus["queue"][number]>();
  for (const j of (jobs.data ?? []) as { kind: string; status: string }[]) {
    if (!byKind.has(j.kind)) {
      byKind.set(j.kind, { kind: j.kind, pending: 0, running: 0, failed: 0, unavailable: 0 });
    }
    const row = byKind.get(j.kind)!;
    if (j.status === "pending") row.pending++;
    else if (j.status === "running") row.running++;
    else if (j.status === "failed") row.failed++;
    else if (j.status === "unavailable") row.unavailable++;
  }

  // Calendar month, matching how the worker enforces the ceiling.
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const used = ((analyses.data ?? []) as {
    input_tokens: number | null; output_tokens: number | null; created_at: string;
  }[])
    .filter((a) => new Date(a.created_at) >= monthStart)
    .reduce((s, a) => s + (a.input_tokens ?? 0) + (a.output_tokens ?? 0), 0);
  // Shared with the worker so the panel cannot report a ceiling the job does
  // not enforce, which is what happened while both defaulted to "unlimited".
  const limit = llmMonthlyTokenLimit();

  const allItems = (items.data ?? []) as { id: string; client_id: string | null }[];
  const withText = new Set(
    ((transcripts.data ?? []) as { content_item_id: string }[]).map((t) => t.content_item_id),
  );

  // Owner-analytics coverage per client, which is the one dependency here that
  // is social rather than technical.
  const itemOfPost = new Map(
    ((posts.data ?? []) as { id: string; content_item_id: string }[]).map((p) => [
      p.id, p.content_item_id,
    ]),
  );
  const itemsWithOwnerData = new Set<string>();
  for (const a of (analytics.data ?? []) as { platform_post_id: string }[]) {
    const item = itemOfPost.get(a.platform_post_id);
    if (item) itemsWithOwnerData.add(item);
  }

  const coverage = ((clients.data ?? []) as { id: string; name: string }[])
    .map((c) => {
      const mine = allItems.filter((i) => i.client_id === c.id);
      return {
        clientName: c.name,
        videos: mine.length,
        withOwnerData: mine.filter((i) => itemsWithOwnerData.has(i.id)).length,
      };
    })
    .filter((c) => c.videos > 0)
    // Least covered first: this list exists to be chased.
    .sort((a, b) => a.withOwnerData / a.videos - b.withOwnerData / b.videos);

  return {
    workers,
    queue: [...byKind.values()].sort((a, b) => a.kind.localeCompare(b.kind)),
    tokens: limit > 0 ? { used, limit } : null,
    transcripts: { withText: withText.size, total: allItems.length },
    analytics: coverage,
  };
}
