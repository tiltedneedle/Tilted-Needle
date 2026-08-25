"""Re-derive Instagram poster frames, from a machine Instagram will talk to.

    python scripts/instagram-thumbnails.py [--limit N] [--dry-run]

WHY THIS RUNS HERE AND NOT IN CI. Instagram publishes no free thumbnail route:
its CDN links are signed and lapse within weeks, and the public oEmbed was
withdrawn. yt-dlp can read the poster frame straight off the post page, but
only from an address Instagram will serve -- and a GitHub runner is not one.
This desktop is, which is the same reason every transcript in the corpus was
fetched from it.

I had recorded Instagram thumbnails as unrecoverable. That was wrong: it was
true of the *stored* urls, which are dead, and I generalised it to the poster
frames themselves. 166 posts, none with a working thumbnail, all recoverable.

THE URL THIS PRODUCES IS ALSO SIGNED, so writing it to the database would be
repeating the original mistake with a fresher timestamp. It is written only as
a staging value; scripts/cache-thumbnails.mjs then copies the bytes into our
own bucket, which is what actually makes it permanent. Run them in that order:

    python scripts/instagram-thumbnails.py
    node --experimental-strip-types --import ./scripts/register-alias.mjs \
      scripts/cache-thumbnails.mjs

PACED, DELIBERATELY. Instagram is the platform most willing to rate-limit an
address it finds interesting, and this desktop's clean reputation is the only
reason the transcript lane works at all. Losing it to save four minutes on a
backfill would be a bad trade.
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

import yt_dlp

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DELAY_SECONDS = 2.0


def env() -> dict:
    out = {}
    with open(os.path.join(REPO, ".env.local"), encoding="utf-8") as fh:
        for line in fh:
            if "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


E = env()
BASE = E["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
KEY = E["SUPABASE_SECRET_KEY"]
HEAD = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}


def rest(path: str, method: str = "GET", body=None):
    req = urllib.request.Request(f"{BASE}/rest/v1/{path}", method=method, headers=HEAD)
    data = json.dumps(body).encode() if body is not None else None
    with urllib.request.urlopen(req, data, timeout=60) as r:
        raw = r.read()
    return json.loads(raw) if raw else None


DRY = "--dry-run" in sys.argv
LIMIT = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else 10**9

accounts = rest("accounts?select=id,platform_slug&platform_slug=eq.instagram")
ids = {a["id"] for a in accounts}
if not ids:
    print("no instagram accounts")
    raise SystemExit(0)

posts = rest(
    "platform_posts?select=id,account_id,url,thumbnail_url"
    f"&account_id=in.({','.join(ids)})&url=not.is.null&order=id"
)

# Anything already copied into our own bucket is finished; re-deriving it
# would spend a request to replace a permanent url with a temporary one.
todo = [p for p in posts if "post-thumbnails" not in (p.get("thumbnail_url") or "")][:LIMIT]
print(f"instagram posts with a url   {len(posts)}")
print(f"needing a fresh poster       {len(todo)}")

if DRY:
    print("\n--dry-run: nothing fetched or written.")
    raise SystemExit(0)

opts = {"quiet": True, "no_warnings": True, "skip_download": True}
found = missing = failed = 0

for i, p in enumerate(todo, 1):
    try:
        with yt_dlp.YoutubeDL(opts) as y:
            info = y.extract_info(p["url"], download=False) or {}
        thumb = info.get("thumbnail")
        if thumb:
            rest(
                f"platform_posts?id=eq.{p['id']}",
                "PATCH",
                {"thumbnail_url": thumb},
            )
            found += 1
        else:
            # The extractor answered and reported no poster. That is a real
            # answer about the post, not a failure of this script.
            missing += 1
    except Exception as e:  # noqa: BLE001
        failed += 1
        first = str(e).replace("\n", " ")[:110]
        print(f"  [{i}] {p['url']}: {first}")

    if i % 20 == 0:
        print(f"  {i}/{len(todo)} — {found} found, {missing} none, {failed} failed")
    time.sleep(DELAY_SECONDS)

print(f"\nfresh poster url written   {found}")
print(f"extractor reported none    {missing}")
print(f"failed                     {failed}")
print("\nNow cache the bytes, or these expire again:")
print("  node --experimental-strip-types --import ./scripts/register-alias.mjs \\")
print("    scripts/cache-thumbnails.mjs")
