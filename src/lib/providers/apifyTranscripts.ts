/**
 * Transcription through Apify, for every platform, with no desktop in the loop.
 *
 * WHY THIS EXISTS. The free routes all need a residential address: yt-dlp is
 * refused from datacenter ranges, so transcripts have only ever worked from
 * one desktop being switched on. That is not a shippable product. Apify runs
 * the fetch on THEIR infrastructure, which makes the whole lane IP-agnostic
 * and therefore runnable from GitHub Actions -- the system keeps working when
 * the desk is empty.
 *
 * THE PRICES ARE NOT FULLY KNOWABLE, AND THE DESIGN ASSUMES THAT.
 * Read from Apify on 2026-09-04:
 *
 *   tiktok     scrape-creators/best-tiktok-transcripts-scraper  $0.001/result
 *   youtube    starvibe/youtube-video-transcript                $0.005/result
 *   instagram  apple_yang/instagram-transcripts-scraper   published $0.001,
 *                                        MEASURED $0.005 AND BILLED ON FAILURE
 *
 * That last one is the point. An actor can charge for events whose price it
 * does not publish -- crawlerbros/instagram-transcript-scraper lists $0.5 PER
 * SEGMENT, which on a long reel is a bill nobody sanctioned. So this module
 * never trusts a published price. Every run carries maxTotalChargeUsd, a
 * ceiling Apify enforces: an actor with a surprise event is cut off mid-run
 * rather than draining the month. Published numbers only size that ceiling;
 * they never predict the invoice.
 *
 * TWO INDEPENDENT GUARDS, deliberately:
 *   1. Our own `transcription` pool, claimed BEFORE the run.
 *   2. maxTotalChargeUsd on the run, enforced by the vendor.
 * Neither is sufficient alone -- the pool counts ITEMS and the bill is per
 * EVENT, so only the second can bound an actor that charges per segment.
 */

import { routeAccount } from "@/lib/apifyRouting";

export type TranscriptActor = {
  actorId: string;
  /** Published unit price, or null when the actor does not disclose one. */
  unitUsd: number | null;
  /**
   * Hard ceiling per run, enforced by Apify. Generous against the published
   * price but small in absolute terms: the job is ONE video, so anything
   * near a dollar means the actor is charging for something unanticipated
   * and the run should die rather than continue.
   */
  maxChargeUsd: number;
  /** Which account funds it. TikTok has its own, with more headroom. */
  tokenEnv: "APIFY_TOKEN" | "APIFY_TIKTOK_TOKEN";
  input: (url: string) => Record<string, unknown>;
};

export const TRANSCRIPT_ACTORS: Record<string, TranscriptActor> = {
  tiktok: {
    actorId: "scrape-creators~best-tiktok-transcripts-scraper",
    unitUsd: 0.001,
    maxChargeUsd: 0.05,
    tokenEnv: "APIFY_TIKTOK_TOKEN",
    // `videos`, confirmed by the actor rejecting `videoUrls` with
    // "Field input.videos is required". A 400 costs nothing, which makes
    // probing the real shape cheaper than trusting an undocumented guess.
    input: (url) => ({ videos: [url] }),
  },
  youtube: {
    actorId: "starvibe~youtube-video-transcript",
    unitUsd: 0.005,
    maxChargeUsd: 0.05,
    tokenEnv: "APIFY_TOKEN",
    // `youtube_url`, and the actor named it itself. It rejects videoUrl,
    // urls, videoUrls, startUrls, videos, video_id and url -- but ACCEPTS an
    // empty input and returns a row whose own message field reads "No
    // youtube_url or channel_url provided in input.". Asking a vendor what it
    // wants beat six rounds of guessing, and every rejection was a free 400.
    input: (url) => ({ youtube_url: url }),
  },
  youtube_shorts: {
    actorId: "starvibe~youtube-video-transcript",
    unitUsd: 0.005,
    maxChargeUsd: 0.05,
    tokenEnv: "APIFY_TOKEN",
    input: (url) => ({ youtube_url: url }),
  },
  instagram: {
    actorId: "apple_yang~instagram-transcripts-scraper",
    /* MEASURED $0.005 PER ATTEMPT, five times the published $0.001, and
       charged EVEN WHEN NO TRANSCRIPT COMES BACK. Read from the account
       meter across one real run on 2026-09-04: $0.67427 -> $0.67927 for a
       call that returned "no transcript for this video".

       That is the undisclosed speech2text event, and it is exactly why this
       module refuses to trust published prices. The number here is the
       measured one so the budget maths is honest; the ceiling still bounds a
       run that behaves worse than this. */
    unitUsd: 0.005,
    maxChargeUsd: 0.05,
    tokenEnv: "APIFY_TOKEN",
    input: (url) => ({ urls: [url], directUrls: [url] }),
  },
};

export type TranscriptFetch = {
  ok: boolean;
  /** Which account actually paid, and why. Null when routing never ran. */
  routedTo?: string;
  routingReason?: string;
  text: string | null;
  /** What Apify actually charged, read back from the run, not assumed. */
  costUsd: number | null;
  runId: string | null;
  /** Distinguishes "this video has none" from "the call failed". */
  note: string | null;
  hitCeiling: boolean;
};

/**
 * Pull transcript text out of whatever shape an actor returns.
 *
 * Every one uses different keys and none documents them in a way worth
 * trusting, so this walks the object for the first plausible prose string
 * rather than hard-coding four schemas that will drift. Returns null rather
 * than a fragment when nothing looks like speech.
 */
/**
 * WEBVTT and SRT down to plain prose.
 *
 * NOT COSMETIC. Every transcript already in this database is prose -- the
 * column feeds a generated tsvector for search, the Tier 2 descriptor prompt,
 * and word-level analysis. The TikTok actor returns WEBVTT, and storing that
 * raw would index "WEBVTT" and "00:00:02.060" as searchable terms and hand a
 * model timestamps as though they were speech. Measured on the first live
 * fetch: 875 characters of which roughly half were cue markers.
 *
 * Consecutive duplicate lines are collapsed because caption tracks routinely
 * repeat a line across two cues, and a naive join turns that into a stutter
 * that reads as a transcription error.
 */
export function vttToProse(raw: string): string {
  const lines = raw.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/^WEBVTT/i.test(t)) continue;
    if (/^(NOTE|STYLE|REGION)\b/i.test(t)) continue;
    if (/^\d+$/.test(t)) continue;                       // SRT cue numbers
    if (t.includes("-->")) continue;                     // timing lines
    const clean = t.replace(/<[^>]+>/g, "").trim();      // inline karaoke tags
    if (!clean) continue;
    if (out.length && out[out.length - 1] === clean) continue;
    out.push(clean);
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

/** Does this look like a caption file rather than prose? */
function looksLikeCues(s: string): boolean {
  return /^WEBVTT/i.test(s.trim()) || /\d\d:\d\d[:.]\d\d[.,]\d{3}\s*-->/.test(s);
}

export function extractTranscript(item: unknown): string | null {
  if (item == null) return null;
  if (typeof item === "string") {
    const s = item.trim();
    if (!s) return null;
    return looksLikeCues(s) ? (vttToProse(s) || null) : s;
  }

  const KEYS = [
    "transcript", "text", "transcription", "captions", "caption",
    "subtitles", "content", "full_text", "fullText",
  ];
  const obj = item as Record<string, unknown>;

  for (const k of KEYS) {
    const v = obj[k];
    if (typeof v === "string" && v.trim().length > 20) {
      const s = v.trim();
      return looksLikeCues(s) ? (vttToProse(s) || null) : s;
    }
    if (Array.isArray(v)) {
      const joined = v
        .map((s) => (typeof s === "string" ? s : (s as Record<string, unknown>)?.text))
        .filter((s): s is string => typeof s === "string")
        .join(" ")
        .trim();
      if (joined.length > 20) return joined;
    }
  }

  for (const k of ["data", "result", "video"]) {
    const v = obj[k];
    if (v && typeof v === "object") {
      const inner = extractTranscript(Array.isArray(v) ? v[0] : v);
      if (inner) return inner;
    }
  }
  return null;
}

const API = "https://api.apify.com/v2";

/**
 * Fetch one transcript. Never throws -- a vendor failure is a status, and a
 * thrown error here would fail a queue job that should simply record why.
 */
export async function fetchTranscript(
  platformSlug: string,
  url: string,
  opts: { timeoutMs?: number } = {},
): Promise<TranscriptFetch> {
  const actor = TRANSCRIPT_ACTORS[platformSlug];
  if (!actor) {
    return {
      ok: false, text: null, costUsd: null, runId: null, hitCeiling: false,
      note: "no transcript actor configured for " + platformSlug,
    };
  }
  /* WHICH ACCOUNT PAYS. actor.tokenEnv is the default, not the answer: both
     accounts can run all three actors, and their credit expires on different
     days. The router prefers whichever has more spare PER REMAINING DAY, so
     credit about to lapse gets used before credit with three weeks to run.
     Falls back to the default whenever the live picture is unreadable. */
  const route = await routeAccount(actor.tokenEnv);
  let token = process.env[route.tokenEnv];
  let usedEnv: string = route.tokenEnv;

  // The routed account may simply not be configured on this host. Falling
  // back beats failing: the work matters more than which card pays for it.
  if (!token && route.tokenEnv !== actor.tokenEnv) {
    token = process.env[actor.tokenEnv];
    usedEnv = actor.tokenEnv;
  }
  if (!token) {
    return {
      ok: false, text: null, costUsd: null, runId: null, hitCeiling: false,
      note: usedEnv + " is not set",
    };
  }

  const timeout = opts.timeoutMs ?? 180000;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);

  try {
    const runUrl = API + "/acts/" + actor.actorId + "/run-sync-get-dataset-items"
      + "?token=" + encodeURIComponent(token)
      + "&maxTotalChargeUsd=" + actor.maxChargeUsd
      + "&timeout=" + Math.floor(timeout / 1000);

    const res = await fetch(runUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(actor.input(url)),
      signal: ctl.signal,
    });

    // Never present on the sync endpoint; kept so the failure branch can
    // still report one if Apify ever adds it.
    const runId = res.headers.get("x-apify-run-id");
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const hitCeiling = /maxTotalChargeUsd|charge limit/i.test(body);
      return {
        ok: false, text: null, costUsd: null, runId, hitCeiling,
        note: "Apify returned " + res.status + ": " + body.slice(0, 160),
      };
    }

    const items = await res.json().catch(() => []);
    const list = Array.isArray(items) ? items : [items];
    let text: string | null = null;
    for (const it of list) {
      text = extractTranscript(it);
      if (text) break;
    }

    /* NO PER-RUN COST, and that is a measured limitation rather than an
       omission. run-sync-get-dataset-items returns no run id -- its only
       apify headers are pagination -- so there is nothing to look the charge
       up by. An earlier version read `usageTotalUsd` off a run id that is
       never present, which would have reported $0 forever and looked like a
       free actor.

       Spend is therefore tracked where it is actually knowable: the ACCOUNT
       meter on the Data sync page, read straight from Apify. Per-run
       attribution would need the async run/poll API, which is a lot of
       machinery for a number the $5 hard cap already bounds. */
    const costUsd: number | null = null;

    return {
      ok: text != null,
      text,
      costUsd,
      runId,
      hitCeiling: false,
      routedTo: usedEnv,
      routingReason: route.reason,
      note: text ? null : "actor returned no transcript for this video",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false, text: null, costUsd: null, runId: null, hitCeiling: false,
      note: /abort/i.test(msg) ? "timed out after " + timeout + "ms" : msg,
    };
  } finally {
    clearTimeout(timer);
  }
}
