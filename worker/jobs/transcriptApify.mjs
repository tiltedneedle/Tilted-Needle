/**
 * Transcribe one video through Apify. No desktop, no residential IP.
 *
 * This is the lane that makes the product shippable. Every other transcript
 * route needs an address a platform will serve, which in practice meant one
 * machine being switched on; Apify fetches on its own infrastructure, so this
 * kind is IP-agnostic and belongs in the GitHub Actions drain list beside
 * comments and analyse.
 *
 * BUDGET IS CLAIMED BEFORE THE VENDOR IS CALLED, the same ordering every
 * metered read in this project uses. Claiming afterwards means a crash
 * mid-run leaves credit spent and unrecorded, and on accounts that BLOCK
 * rather than bill, an unrecorded overspend silently stops the pipeline for
 * the rest of the cycle.
 *
 * ONE POOL FOR EVERY PLATFORM, HELD IN MICRO-DOLLARS. transcription_budget
 * replaced four per-platform item pools because an "item" is not a unit here:
 * a TikTok transcript is $0.001 and an Instagram one $0.005. Each fetch
 * debits its own measured price, so the pool means the same thing whatever
 * mix of platforms turns up.
 *
 * A REFUSED CLAIM IS NOT A FAILURE. Running out of transcription budget is
 * the system working: the job goes back to pending with no attempt spent, and
 * the next cycle picks it up. Marking it failed would burn four attempts
 * against a wall that opens on a known date.
 */
import { fetchTranscript, TRANSCRIPT_ACTORS } from "../../src/lib/providers/apifyTranscripts.ts";

export async function transcriptApify({ db, job, log }) {
  const { data: item, error: itemErr } = await db
    .from("content_items")
    .select("id, workspace_id, title")
    .eq("id", job.subject_id)
    .maybeSingle();
  if (itemErr) throw new Error(`content_items: ${itemErr.message}`);
  if (!item) return { unavailable: true, note: "content item is gone" };

  // Already transcribed by any route -- desktop, paste, or a previous run.
  const { data: existing } = await db
    .from("video_transcripts").select("content_item_id")
    .eq("content_item_id", item.id).maybeSingle();
  if (existing) return { unavailable: true, note: "already transcribed" };

  /* Pick the post to transcribe. A video can be on several platforms and only
     some have an actor, so the choice is "the first platform we can actually
     serve" rather than "the first post". Ordered by id so the same video
     resolves the same way on a retry. */
  const { data: posts, error: postErr } = await db
    .from("platform_posts")
    .select("id, url, account:accounts(platform_slug)")
    .eq("content_item_id", item.id)
    .not("url", "is", null)
    .order("id");
  if (postErr) throw new Error(`platform_posts: ${postErr.message}`);

  const candidate = (posts ?? [])
    .map((p) => ({
      url: p.url,
      platform: Array.isArray(p.account) ? p.account[0]?.platform_slug : p.account?.platform_slug,
    }))
    .find((p) => p.platform && TRANSCRIPT_ACTORS[p.platform]);

  if (!candidate) {
    // A real answer about this video, not a transient failure: nothing it is
    // posted on has a transcript actor configured.
    return { unavailable: true, note: "no platform on this video has a transcript actor" };
  }

  /* ONE POOL, DENOMINATED IN MONEY, for every platform.
     A shared pool counting ITEMS would be dishonest here: a TikTok transcript
     costs $0.001 and an Instagram one $0.005, so "500 transcriptions" means
     anywhere between $0.50 and $2.50 depending which platforms come up. Each
     fetch therefore debits its own measured price and the ledger holds
     micro-dollars. */
  const actor = TRANSCRIPT_ACTORS[candidate.platform];
  // Unpriced actors are charged at the most expensive one we have measured,
  // never at zero -- an unknown price must cost the budget MORE caution, not
  // less, or an undisclosed event drains the pool for free.
  const micros = Math.round((actor.unitUsd ?? 0.005) * 1_000_000);

  const { data: granted, error: claimErr } = await db.rpc("claim_transcription_budget", {
    p_workspace_id: item.workspace_id,
    p_micros: micros,
  });
  if (claimErr) throw new Error(`claiming transcription budget: ${claimErr.message}`);
  if (!granted || Number(granted) < micros) {
    const err = new Error("transcription budget exhausted for this cycle");
    // The signal the worker understands: cool the kind, leave the job
    // pending, spend no attempt. Running out before the cycle ends is a
    // NORMAL outcome here by design -- the queue simply waits for the reset.
    err.blocked = true;
    throw err;
  }

  const res = await fetchTranscript(candidate.platform, candidate.url);

  if (!res.ok) {
    /* NOTHING WAS FETCHED, SO THE CLAIM IS HANDED BACK. Without this a run of
       vendor errors burns the cycle's whole transcription allowance without
       storing a single transcript. */
    await db.rpc("refund_transcription_budget", {
      p_workspace_id: item.workspace_id, p_micros: micros,
    });

    if (res.hitCeiling) {
      // Our own per-run ceiling stopped it. That is a configuration answer,
      // not a video problem, and retrying changes nothing.
      return { unavailable: true, note: `charge ceiling hit: ${res.note}` };
    }
    if (/no transcript/i.test(res.note ?? "")) {
      // The actor answered and this video has no captions. Terminal and
      // NORMAL -- the same shape as "no caption tracks published".
      return { unavailable: true, note: res.note };
    }
    throw new Error(res.note ?? "transcript fetch failed");
  }

  const { error: insErr } = await db.from("video_transcripts").insert({
    workspace_id: item.workspace_id,
    content_item_id: item.id,
    // Its own source value. enrichment provenance already distinguishes a
    // published caption track from ASR, and a vendor's caption scrape is a
    // third thing -- folding it into "public" would make the corpus lie about
    // where its words came from.
    source: "apify",
    language: null,
    is_generated: true,
    full_text: res.text,
    // No timings survive the prose conversion, and inventing evenly spaced
    // ones would put fabricated positions on a replay chart later.
    segments: [],
    fetched_at: new Date().toISOString(),
  });
  if (insErr) throw new Error(`storing transcript: ${insErr.message}`);

  log("info", "transcript_apify_stored", {
    item: item.id, platform: candidate.platform, chars: res.text.length,
  });

  return { stats: { platform: candidate.platform, chars: res.text.length } };
}
