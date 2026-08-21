/**
 * TikTok comments through Apify. The one comment route in this project that
 * costs real money, so the design is mostly about not spending it.
 *
 * WHY NOT yt-dlp, LIKE INSTAGRAM
 *
 * Instagram comments come free through the yt-dlp box. TikTok cannot: its
 * extractor is broken upstream, and `getcomments` does not fail gracefully --
 * the whole extraction throws "Unexpected response from webpage request".
 * Checked from BOTH addresses before reaching for a paid actor, because the
 * datacenter box is refused by TikTok for unrelated reasons and it would have
 * been easy to mistake that for the extractor being unavailable. The
 * residential address fails identically, so this is upstream breakage rather
 * than an IP problem, and no free route exists today.
 *
 * WHAT THE MONEY LOOKS LIKE
 *
 * The Apify account is on the FREE plan: a $5 hard monthly ceiling, not a
 * budget that bills over. Measured against the live library at $0.0003 per
 * comment:
 *
 *     all 144 TikTok posts, every comment      23,644 comments   $7.09
 *     capped at 50 comments per post            1,109 comments   $0.33
 *
 * Uncapped is not merely expensive, it is impossible -- it exceeds the plan's
 * entire monthly allowance, and one post carrying 13,200 comments accounts for
 * more than half of it. So the cap is not a tuning knob, it is what makes the
 * feature exist at all. It is also barely a loss: the median TikTok post here
 * has ONE comment, and a themed reading of 50 comments says nearly everything
 * a reading of 13,200 would.
 *
 * AND THE PART THAT COSTS NOTHING
 *
 * 62 of those 144 posts have zero comments, and we already know it -- the
 * metric snapshots the sync collects carry a comment count straight from the
 * platform. Asking Apify to confirm a zero we have already been told is money
 * spent to learn nothing. Those posts are answered from the snapshot instead,
 * which is a real observation and therefore a legitimate verdict, recorded as
 * such and made recheckable because a quiet post can find an audience later.
 */

export type TikTokComment = {
  text: string;
  authorHandle: string | null;
  likes: number | null;
  publishedAt: string | null;
  externalId: string | null;
};

export type TikTokCommentsResult =
  | { ok: true; comments: TikTokComment[]; charged: number }
  | { ok: false; error: string; exhausted?: boolean };

const API = "https://api.apify.com/v2";

/** $0.0003 per returned comment, no start fee -- the cheapest of the actors
 *  checked, and the only one of the top three that charges nothing to start. */
const PRICE_PER_COMMENT_USD = 0.0003;

function actorId(): string {
  return process.env.APIFY_TIKTOK_COMMENTS_ACTOR ?? "apidojo~tiktok-comments-scraper";
}

/**
 * The per-post ceiling. Overridable, but the default is chosen from the
 * measured distribution rather than picked round: at 50 the whole library costs
 * a third of a dollar, and only 10% of posts have more comments than this to
 * give.
 */
export function commentCap(): number {
  const raw = Number(process.env.TIKTOK_COMMENT_CAP ?? 50);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 500) : 50;
}

/** What a run WOULD cost, for callers that must decide before spending. */
export function estimateCostUsd(commentCount: number): number {
  return Math.min(commentCount, commentCap()) * PRICE_PER_COMMENT_USD;
}

/**
 * How much of the monthly allowance is left.
 *
 * Checked before spending rather than after being refused, because a 402 from
 * the middle of a backfill leaves some posts fetched and others not, with no
 * record of which. Returns null if Apify will not say -- and a caller that
 * cannot find out must proceed as if the answer were "not much".
 */
export async function remainingBudgetUsd(): Promise<number | null> {
  const token = process.env.APIFY_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`${API}/users/me/limits?token=${encodeURIComponent(token)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const limit = body?.data?.limits?.maxMonthlyUsageUsd;
    const used = body?.data?.current?.monthlyUsageUsd;
    if (typeof limit !== "number" || typeof used !== "number") return null;
    return Math.max(0, limit - used);
  } catch {
    return null;
  }
}

export async function fetchTikTokComments(
  postUrl: string,
  { limit = commentCap(), timeoutMs = 180_000 }: { limit?: number; timeoutMs?: number } = {},
): Promise<TikTokCommentsResult> {
  const token = process.env.APIFY_TOKEN;
  if (!token) return { ok: false, error: "APIFY_TOKEN is not set." };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(
      `${API}/acts/${actorId()}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startUrls: [postUrl],
          // Both spellings are sent because the actors in this space disagree
          // about the name and silently ignore the one they do not know --
          // which would mean an UNCAPPED run, i.e. the expensive failure.
          maxItems: limit,
          maxComments: limit,
          commentsPerPost: limit,
        }),
        signal: controller.signal,
        cache: "no-store",
      },
    );

    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "Apify rejected the token. Check APIFY_TOKEN." };
    }
    if (res.status === 402) {
      // The free plan blocks rather than bills. The remedy is to wait for the
      // reset, so this is flagged distinctly: a caller should stop the whole
      // backfill rather than retry this post.
      return {
        ok: false,
        exhausted: true,
        error: "Apify monthly credit exhausted; TikTok comments pause until the plan resets.",
      };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Apify returned HTTP ${res.status}. ${body.slice(0, 160)}` };
    }

    const rows = await res.json();
    if (!Array.isArray(rows)) {
      return { ok: false, error: "Apify returned an unexpected response shape." };
    }

    /* Sliced again on our side. The actor is asked for a cap three different
       ways above and may honour none of them -- we are charged per row
       RETURNED, so the request-side cap protects the bill and this one only
       protects the database. Both are cheap; neither is redundant. */
    const capped = rows.slice(0, limit);
    return {
      ok: true,
      charged: rows.length,
      comments: capped.map(normalise).filter((c): c is TikTokComment => c !== null),
    };
  } catch (e) {
    const err = e as Error;
    if (err.name === "AbortError") {
      return { ok: false, error: `Apify run exceeded ${Math.round(timeoutMs / 1000)}s and was abandoned.` };
    }
    return { ok: false, error: `Could not reach Apify: ${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Actors in this category do not agree on field names, and an actor can be
 * swapped by environment variable, so every field is read from a list of
 * plausible spellings rather than one. A row whose text cannot be found is
 * dropped rather than stored empty -- an empty comment is not evidence, and it
 * would inflate the denominator that themes are reported against.
 */
function normalise(row: Record<string, unknown>): TikTokComment | null {
  /* Reads NESTED paths too, because the author is not a top-level field on
     this actor -- it lives under `user`. The first version of this function
     looked only at the top level and returned null for every author on a
     working fetch, which is the quiet kind of wrong: comments stored fine, the
     job reported success, and the attribution was simply gone. Verified
     against a real run before being trusted. */
  const pick = (...paths: string[]) => {
    for (const path of paths) {
      let v: unknown = row;
      for (const seg of path.split(".")) {
        v = v && typeof v === "object" ? (v as Record<string, unknown>)[seg] : undefined;
      }
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number") return String(v);
    }
    return null;
  };

  const text = pick("text", "comment", "commentText", "content");
  if (!text) return null;

  const likesRaw = pick("likeCount", "diggCount", "likes", "likesCount");
  const likes = likesRaw === null ? null : Number(likesRaw);

  return {
    text,
    // The alternatives are kept because ACTOR IS AN ENV VAR: swap it and the
    // field names change under you. The names that actually work today are
    // first in each list.
    authorHandle: pick("user.username", "uniqueId", "username", "authorHandle", "author"),
    likes: Number.isFinite(likes) ? likes : null,
    publishedAt: toIso(pick("createdAt", "createTimeISO", "createTime", "publishedAt", "timestamp")),
    externalId: pick("id", "cid", "commentId"),
  };
}

/**
 * The row mapping, exposed so it can be tested against a real payload without
 * a paid call. Normalising is where this provider has actually been wrong, and
 * it is wrong SILENTLY -- the fetch succeeds and the fields are simply null --
 * so it is the part most worth pinning down offline.
 */
export function normaliseForTest(rows: Record<string, unknown>[]): TikTokComment[] {
  return rows.map(normalise).filter((c): c is TikTokComment => c !== null);
}

function toIso(value: string | null): string | null {
  if (!value) return null;
  // Unix seconds, which is what most of these actors emit.
  if (/^\d{9,10}$/.test(value)) return new Date(Number(value) * 1000).toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
