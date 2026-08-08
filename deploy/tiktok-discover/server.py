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
        # json3 carries per-segment timings; the plain formats do not, and
        # timings are what make a transcript line clickable later.
        # json3 for YouTube, vtt for TikTok. Asking for both and picking what
        # arrives is what makes this endpoint platform-agnostic; a single
        # format would work on exactly one platform.
        "subtitlesformat": "json3/vtt/best",
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


@app.route("/meta", methods=["GET"])
def meta():
    """
    Publish time, caption text and comments for one post, on any platform.

    Exists because the official APIs cover exactly one platform. YouTube has a
    free Data API for all three of these; TikTok and Instagram have none, and
    the app was storing NO publish timestamps for TikTok (0 of 78) and caption
    text for almost nothing.

    Measured, so the caller knows what to expect rather than guessing:
      timestamp    -- available on TikTok and Instagram
      description  -- available on both (the caption text)
      comments     -- Instagram yes; TikTok returns none even on a post with
                      169 of them, so its extractor plainly does not support
                      them. Reported as an empty list, never as a failure.

    Comments are capped: a viral post has thousands, they are only ever read
    in aggregate, and an unbounded fetch would run for minutes.
    """
    if not authorised(request):
        return jsonify({"error": "Unauthorised."}), 401

    url = (request.args.get("url") or "").strip()
    if not url.startswith(("http://", "https://")):
        return jsonify({"error": "url query param is required and must be absolute."}), 400

    want_comments = request.args.get("comments", "1") != "0"
    try:
        limit = min(500, max(0, int(request.args.get("limit", 200))))
    except ValueError:
        limit = 200

    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "getcomments": want_comments,
        "extractor_args": {
            "youtube": {"max_comments": [str(limit)]},
            "instagram": {"max_comments": [str(limit)]},
            "tiktok": {"max_comments": [str(limit)]},
        },
    }

    started = time.time()
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False) or {}
    except yt_dlp.utils.DownloadError as e:
        msg = str(e)
        if "Private" in msg or "unavailable" in msg.lower() or "not exist" in msg.lower():
            return jsonify({"url": url, "available": False, "reason": "post is private or gone"}), 200
        return jsonify({"error": f"Extraction failed: {msg}"}), 502
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": f"Unexpected error: {e}"}), 500

    comments = []
    for c in (info.get("comments") or [])[:limit]:
        text = (c.get("text") or "").strip()
        if not text:
            continue
        comments.append({
            "id": str(c.get("id") or ""),
            "author": c.get("author") or c.get("author_id"),
            "text": text,
            "likeCount": c.get("like_count"),
            # yt-dlp gives a unix timestamp where the platform exposes one.
            "publishedAt": _iso_datetime(c.get("timestamp")),
        })

    return jsonify({
        "url": url,
        "available": True,
        "externalId": info.get("id"),
        "timestamp": _iso_datetime(info.get("timestamp")),
        "description": info.get("description"),
        "title": info.get("title"),
        "durationSeconds": info.get("duration"),
        "viewCount": info.get("view_count"),
        "likeCount": info.get("like_count"),
        "commentCount": info.get("comment_count"),
        "comments": comments,
        "tookMs": round((time.time() - started) * 1000),
    })


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
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8787)))
