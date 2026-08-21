"""
TikTok profile-discovery service.

The one job this server has: given a TikTok handle, list that account's
recent videos with their current view/like/comment counts. It exists because
TikTok blocks profile pages for anonymous scraping (see src/lib/providers/
tiktok.ts), and the actual extraction library for this (yt-dlp) is Python,
while the rest of this app is Node on Vercel. Rather than restructure the
live Vercel project into its multi-runtime "Services" mode -- real risk to a
production app for one endpoint -- this runs as its own tiny service on a
box you control, and the Node app calls it over HTTPS.

Deliberately NOT the metrics-refresh path: that already works for free via
TikTok's public embed page (see tiktok.ts fetchMetrics), which needs no
server at all. This service is discovery only -- finding new uploads -- so
if it is ever offline, nothing about already-tracked videos stops updating.

Run: python3 server.py
Requires: pip install flask yt-dlp
"""

import os
import time
from flask import Flask, request, jsonify
import yt_dlp

app = Flask(__name__)

# Same shared-secret-as-bearer-token pattern as /api/sync in the main app.
# Fails closed: an unset secret means every request is rejected, not that
# the endpoint is open to the internet.
SECRET = os.environ.get("DISCOVER_SECRET")

# An optional Netscape-format cookie jar, exported from a signed-in YouTube
# session. Set YTDLP_COOKIES to its path.
#
# WHY IT IS OPTIONAL AND WHY IT MATTERS
#
# From a residential address YouTube answers without it and this stays unset.
# From a datacenter address YouTube refuses every request with "Sign in to
# confirm you're not a bot" -- measured against seven yt-dlp client variants,
# a PO-token provider, and an anonymous cookie jar, all refused identically.
# Cookies from an AUTHENTICATED session are the one countermeasure YouTube's
# own error message names and the only one left untested.
#
# yt-dlp's documentation warns that using cookies from an account you care
# about can get that account flagged. Use a throwaway.
# An outbound proxy for yt-dlp, e.g. http://user:pass@gate.example.com:7000.
#
# WHY IT IS THE ONLY REAL FIX FOR THE DATACENTER BLOCK
#
# YouTube refuses this host by ADDRESS, before client choice or token
# generation matter -- measured across seven yt-dlp client variants, a
# bgutil PO-token provider, and an anonymous cookie jar, all refused
# identically. Cookies from a signed-in session are the one untested
# countermeasure and carry an account-ban risk; a residential proxy sidesteps
# the question entirely by not being a datacenter address.
#
# Captions are TINY -- a track is a few tens of KB, so a per-GB residential
# plan costs cents for the whole library. Unset by default: the desktop
# runner has a residential address already and needs none.
YTDLP_PROXY = os.environ.get("YTDLP_PROXY") or None

COOKIE_FILE = os.environ.get("YTDLP_COOKIES") or None
if COOKIE_FILE and not os.path.exists(COOKIE_FILE):
    print(f"WARNING: YTDLP_COOKIES points at {COOKIE_FILE}, which does not exist.")
    COOKIE_FILE = None


def _with_cookies(opts: dict) -> dict:
    """Attach the cookie jar and proxy when configured. No-op otherwise."""
    if COOKIE_FILE:
        opts["cookiefile"] = COOKIE_FILE
    if YTDLP_PROXY:
        opts["proxy"] = YTDLP_PROXY
    return opts


# The bot challenge, in the words YouTube actually uses. Matched so it can be
# reported as a TRANSPORT failure rather than a fact about the video --
# recording "this video has no captions" because an IP was refused is how 21
# videos were wrongly written off already.
BOT_CHALLENGE = ("sign in to confirm", "not a bot", "confirm you")

# Recent-only: this endpoint is asked "what is new," not "give me this
# account's entire history." A generous default keeps a single request fast
# and its yt-dlp process short-lived.
DEFAULT_LIMIT = 12
# Raised for backfill: this box is ours and the only cost is time. Full
# extract_info is broken for TikTok upstream, so flat listing is the ONLY
# working route to per-video metadata -- it has to be able to reach a whole
# account's history, not just the recent page.
MAX_LIMIT = 200


def authorised(req) -> bool:
    if not SECRET:
        return False
    return req.headers.get("Authorization") == f"Bearer {SECRET}"


@app.route("/discover", methods=["GET"])
def discover():
    if not authorised(request):
        return jsonify({"error": "Unauthorised."}), 401

    handle = (request.args.get("handle") or "").strip().lstrip("@")
    if not handle:
        return jsonify({"error": "handle query param is required."}), 400

    try:
        limit = min(MAX_LIMIT, max(1, int(request.args.get("limit", DEFAULT_LIMIT))))
    except ValueError:
        return jsonify({"error": "limit must be an integer."}), 400

    url = f"https://www.tiktok.com/@{handle}"

    # extract_flat="in_playlist" reads the profile's video list without
    # opening each video page individually -- one process, one profile
    # fetch, proportional to `limit`, not to the account's whole history.
    opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": "in_playlist",
        "playlistend": limit,
        "skip_download": True,
    }
    _with_cookies(opts)

    started = time.time()
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except yt_dlp.utils.DownloadError as e:
        msg = str(e)
        # A private or nonexistent account is a normal, expected outcome --
        # not a server error -- so it gets its own status rather than a 500.
        if "Unable to find user" in msg or "private" in msg.lower():
            return jsonify({"error": f"No such public account: @{handle}", "videos": []}), 200
        return jsonify({"error": f"Extraction failed: {msg}"}), 502
    except Exception as e:  # noqa: BLE001 -- any yt-dlp internal failure surfaces, not swallowed
        return jsonify({"error": f"Unexpected error: {e}"}), 500

    entries = (info or {}).get("entries") or []
    videos = []
    for e in entries:
        if not e:
            continue
        videos.append(
            {
                "externalId": e.get("id"),
                "title": (e.get("title") or "Untitled").strip(),
                "url": e.get("url")
                or f"https://www.tiktok.com/@{handle}/video/{e.get('id')}",
                # yt-dlp's flat extraction may omit some fields depending on
                # version; missing means unknown, not zero.
                "postedAt": _iso_date(e.get("timestamp")),
                # The exact instant, not just the calendar date. Flat
                # extraction has always carried it; the date-only field above
                # was discarding it. Kept as raw epoch so the caller decides
                # the timezone rather than inheriting this box's.
                "timestampEpoch": e.get("timestamp"),
                "description": (e.get("description") or "").strip() or None,
                "views": e.get("view_count"),
                "likes": e.get("like_count"),
                "comments": e.get("comment_count"),
            }
        )

    return jsonify(
        {
            "handle": handle,
            "videos": videos,
            "tookMs": round((time.time() - started) * 1000),
        }
    )


@app.route("/meta", methods=["GET"])
def meta():
    """
    Publish timestamp and description for one post, by URL.

    Exists because the sync stores only a DATE (posted_at) while yt-dlp knows
    the exact instant, and because TikTok's only text is its caption -- which
    the discovery path keeps just the first line of, as a title, and discards.
    Both are free here: one extract_info call, no metered provider, no API
    quota. TikTok sits at 0/78 timestamps purely because nothing ever asked.

    Metadata only: extract_flat is not used because the flat listing omits the
    description, which is half the point.
    """
    if not authorised(request):
        return jsonify({"error": "Unauthorised."}), 401

    url = (request.args.get("url") or "").strip()
    if not url:
        return jsonify({"error": "url query param is required."}), 400

    opts = {"quiet": True, "no_warnings": True, "skip_download": True}
    started = time.time()
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False) or {}
    except yt_dlp.utils.DownloadError as e:
        msg = str(e)
        if "private" in msg.lower() or "unavailable" in msg.lower():
            return jsonify({"url": url, "available": False,
                            "reason": "post is private or unavailable"}), 200
        return jsonify({"error": f"Extraction failed: {msg}"}), 502
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": f"Unexpected error: {e}"}), 500

    return jsonify({
        "url": url,
        "available": True,
        # Epoch seconds; the caller converts. Null rather than a guess when
        # the extractor did not report one.
        "timestamp": info.get("timestamp"),
        "description": (info.get("description") or "").strip() or None,
        "durationSeconds": info.get("duration"),
        "tookMs": round((time.time() - started) * 1000),
    })


@app.route("/transcript", methods=["GET"])
def transcript():
    """
    A YouTube video's transcript, via yt-dlp.

    Added because the direct route died. YouTube's timedtext endpoint now
    requires a proof-of-origin token (PoToken) generated at runtime by the
    player's own JavaScript, and without one it answers a plain HTTP request
    with 200 and an EMPTY BODY -- no status, no message. Measured against this
    library: caption tracks are listed, the track is fetched, nothing comes
    back.

    yt-dlp already solves that, and this box already runs yt-dlp. So the fix
    is one endpoint on a service that exists rather than new infrastructure:
    same bearer secret, same failure conventions, same process model.

    Deliberately per-video and on demand. Transcripts are fetched once and
    cached forever in Postgres, so this is a handful of calls a week.
    """
    if not authorised(request):
        return jsonify({"error": "Unauthorised."}), 401

    video_id = (request.args.get("v") or "").strip()
    url = (request.args.get("url") or "").strip()
    if not video_id and not url:
        return jsonify({"error": "v or url query param is required."}), 400

    # `v` stays supported for YouTube ids; `url` covers every other platform,
    # because TikTok and Instagram have no id shape this service can assume.
    if not url:
        url = f"https://www.youtube.com/watch?v={video_id}"
    if not url.startswith(("http://", "https://")):
        return jsonify({"error": "url must be absolute."}), 400
    video_id = video_id or url
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "writesubtitles": True,
        "writeautomaticsub": True,
        # DELIBERATELY NO `subtitleslangs`. Setting a language glob makes
        # yt-dlp request a track PER MATCHING LANGUAGE, so "en.*" or "all"
        # multiplies the request count several times over against the one
        # endpoint that is already rate-limiting this project -- silently,
        # since each extra request looks identical in the log. _pick_track
        # chooses the language from what the video actually publishes, which
        # needs one request and gets a better answer.
        # json3 carries per-segment timings; the plain formats do not, and
        # timings are what make a transcript line clickable later.
        # json3 for YouTube, vtt for TikTok. Asking for both and picking what
        # arrives is what makes this endpoint platform-agnostic; a single
        # format would work on exactly one platform.
        "subtitlesformat": "json3/vtt/best",
    }
    _with_cookies(opts)

    started = time.time()
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False) or {}

            # Human-written tracks first: auto-generated captions mangle
            # names, brands and accents, which is exactly the vocabulary a
            # marketing corpus gets searched for.
            manual = info.get("subtitles") or {}
            auto = info.get("automatic_captions") or {}
            track, lang, generated = _pick_track(manual, auto)
            if not track:
                return jsonify({
                    "videoId": video_id,
                    "available": False,
                    "reason": "no caption track published for this video",
                }), 200

            # Fetched through yt-dlp's own session so its header and token
            # handling apply -- which is the entire point of routing here.
            try:
                raw = ydl.urlopen(track["url"]).read().decode("utf-8", "replace")
            except Exception as fetch_err:  # noqa: BLE001
                # THE TRACK EXISTS. Whatever went wrong here is transport, and
                # saying otherwise writes the video off: the caller settles
                # `available: false` as terminal.
                #
                # 429 is the one that actually happens. YouTube throttles an IP
                # that has asked a lot recently -- including a residential one,
                # which is how this was found: a day of testing earned this
                # desktop a 429 and the endpoint answered "Unexpected error",
                # a 500 that named neither the cause nor the remedy.
                status = getattr(fetch_err, "code", None) or getattr(fetch_err, "status", None)
                if status == 429:
                    return jsonify({
                        "error": (
                            "YouTube is rate-limiting this host (HTTP 429). The caption "
                            "track exists and was located; only fetching it was refused. "
                            "Retry later from this host, or from one that has been quieter."
                        ),
                        "rateLimited": True,
                    }), 429
                return jsonify({
                    "error": f"caption track located but could not be fetched: {fetch_err}",
                }), 502
    except yt_dlp.utils.DownloadError as e:
        msg = str(e)
        # A bot challenge is about THIS HOST, not this video. It must never
        # become `available: false`, because the caller settles that as
        # terminal and the video is written off for good.
        if any(p in msg.lower() for p in BOT_CHALLENGE):
            return jsonify({
                "error": (
                    "YouTube refused this host with a bot challenge"
                    + (" despite the configured cookies (they may have expired)"
                       if COOKIE_FILE else " and no cookies are configured")
                    + ". This says nothing about whether the video has captions."
                ),
                "botChallenge": True,
            }), 502
        if "Private video" in msg or "unavailable" in msg.lower():
            return jsonify({
                "videoId": video_id, "available": False,
                "reason": "video is private or unavailable",
            }), 200
        return jsonify({"error": f"Extraction failed: {msg}"}), 502
    except Exception as e:  # noqa: BLE001
        # A 429 can surface from ANY yt-dlp call, not just the caption fetch --
        # extraction itself is throttled first, which is where this actually
        # came from. Classified here so the label does not depend on guessing
        # which call tripped it.
        if "429" in str(e) or "Too Many Requests" in str(e):
            return jsonify({
                "error": (
                    "YouTube is rate-limiting this host (HTTP 429). This is about the "
                    "host, not the video: retry later, or from somewhere quieter."
                ),
                "rateLimited": True,
            }), 429
        return jsonify({"error": f"Unexpected error: {e}"}), 500

    segments = _segments_from_json3(raw) or _segments_from_vtt(raw)
    if not segments:
        return jsonify({
            "videoId": video_id, "available": False,
            "reason": "caption track contained no readable text",
        }), 200

    return jsonify({
        "videoId": video_id,
        "available": True,
        "language": lang,
        "isGenerated": generated,
        "segments": segments,
        "text": " ".join(s["text"] for s in segments),
        "tookMs": round((time.time() - started) * 1000),
    })


def _pick_track(manual, auto):
    """Human track beats machine; English breaks ties but never wins outright
    -- a German clinic's video should keep its German."""
    def best(tracks):
        if not tracks:
            return None, None
        for lang in list(tracks):
            if lang.startswith("en"):
                return tracks[lang], lang
        lang = next(iter(tracks))
        return tracks[lang], lang

    entries, lang = best(manual)
    if entries:
        return _json3(entries), lang, False
    entries, lang = best(auto)
    if entries:
        return _json3(entries), lang, True
    return None, None, None


def _json3(entries):
    for e in entries:
        if e.get("ext") == "json3":
            return e
    return entries[0] if entries else None


def _segments_from_json3(raw):
    import json as _json
    try:
        data = _json.loads(raw)
    except ValueError:
        return []
    out = []
    for ev in data.get("events") or []:
        text = "".join(seg.get("utf8", "") for seg in (ev.get("segs") or []))
        text = " ".join(text.split())
        if not text:
            continue
        out.append({
            "startMs": ev.get("tStartMs") or 0,
            "durMs": ev.get("dDurationMs") or 0,
            "text": text,
        })
    return out


def _iso_datetime(ts):
    if not ts:
        return None
    try:
        import datetime as _dt
        return _dt.datetime.fromtimestamp(int(ts), _dt.timezone.utc).isoformat()
    except (ValueError, OSError, OverflowError):
        return None


def _segments_from_vtt(raw):
    """
    WebVTT -> the same segment shape json3 produces.

    TikTok serves vtt, YouTube json3, and everything downstream should not have
    to care which. Cue settings and positioning tags are dropped: this is a
    transcript, not a rendering.
    """
    if "-->" not in raw:
        return []
    out = []
    lines = raw.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if "-->" in line:
            start, _, rest = line.partition("-->")
            end = rest.strip().split(" ")[0]
            text_lines = []
            i += 1
            while i < len(lines) and lines[i].strip() and "-->" not in lines[i]:
                text_lines.append(lines[i].strip())
                i += 1
            # Strip inline karaoke/positioning tags like <00:00:01.000><c>.
            text = " ".join(text_lines)
            text = _strip_tags(text)
            text = " ".join(text.split())
            if text:
                s_ms = _vtt_ms(start.strip())
                e_ms = _vtt_ms(end)
                out.append({
                    "startMs": s_ms,
                    "durMs": max(0, e_ms - s_ms),
                    "text": text,
                })
            continue
        i += 1
    return out


def _strip_tags(text):
    out = []
    depth = 0
    for ch in text:
        if ch == "<":
            depth += 1
        elif ch == ">":
            depth = max(0, depth - 1)
        elif depth == 0:
            out.append(ch)
    return "".join(out)


def _vtt_ms(stamp):
    """'00:01:02.500' or '01:02.500' -> milliseconds."""
    stamp = stamp.strip().replace(",", ".")
    parts = stamp.split(":")
    try:
        parts = [float(p) for p in parts]
    except ValueError:
        return 0
    if len(parts) == 3:
        secs = parts[0] * 3600 + parts[1] * 60 + parts[2]
    elif len(parts) == 2:
        secs = parts[0] * 60 + parts[1]
    else:
        secs = parts[0]
    return int(secs * 1000)


def _iso_date(ts):
    if not ts:
        return None
    try:
        return time.strftime("%Y-%m-%d", time.gmtime(ts))
    except (OverflowError, OSError, ValueError):
        return None


@app.route("/health", methods=["GET"])
def health():
    # Deliberately unauthenticated and free of any yt-dlp call: this is what
    # confirms the process and dependencies are alive, not that TikTok is
    # currently reachable.
    return jsonify({"ok": True})


if __name__ == "__main__":
    if not SECRET:
        print("WARNING: DISCOVER_SECRET is not set. Every request will be rejected.")
    # Loopback by DEFAULT. On the Oracle host the worker calls this from the
    # same machine, and that box has a public IP -- binding every interface
    # would put a scraping service on the open internet behind nothing but a
    # shared secret. Set HOST=0.0.0.0 deliberately if it ever needs to be
    # reachable from elsewhere.
    app.run(
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", 8787)),
    )
