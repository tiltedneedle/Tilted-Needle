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

# Recent-only: this endpoint is asked "what is new," not "give me this
# account's entire history." A generous default keeps a single request fast
# and its yt-dlp process short-lived.
DEFAULT_LIMIT = 12
MAX_LIMIT = 30


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
    if not video_id:
        return jsonify({"error": "v query param is required."}), 400

    url = f"https://www.youtube.com/watch?v={video_id}"
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "writesubtitles": True,
        "writeautomaticsub": True,
        # json3 carries per-segment timings; the plain formats do not, and
        # timings are what make a transcript line clickable later.
        "subtitlesformat": "json3",
    }

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
            raw = ydl.urlopen(track["url"]).read().decode("utf-8", "replace")
    except yt_dlp.utils.DownloadError as e:
        msg = str(e)
        if "Private video" in msg or "unavailable" in msg.lower():
            return jsonify({
                "videoId": video_id, "available": False,
                "reason": "video is private or unavailable",
            }), 200
        return jsonify({"error": f"Extraction failed: {msg}"}), 502
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": f"Unexpected error: {e}"}), 500

    segments = _segments_from_json3(raw)
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
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8787)))
