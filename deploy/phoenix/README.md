# The Phoenix box: Tilted Needle's yt-dlp lane

An Oracle Always-Free A1 VM (2 OCPU / 12 GB, aarch64) in `us-phoenix-1`, on a
tenancy separate from the retired Singapore one. It also hosts a game arcade;
that is left alone. Access details live outside this repo in
`C:/Users/HP/Downloads/Oracle/`.

## What it is for, measured

From this address, 2026-09-13:

| platform  | metadata | captions          | audio | discovery |
|-----------|----------|-------------------|-------|-----------|
| tiktok    | yes      | yes, `eng-US` vtt | yes   | no (extractor broken upstream) |
| instagram | yes      | never published   | yes   | untested  |
| youtube   | **refused** -- "Sign in to confirm you're not a bot" |||

So the worker here runs `--kinds=transcript,transcript_asr` and
`TRANSCRIPT_PLATFORMS=tiktok,instagram`, nothing else. TikTok transcripts
come free from the caption track; Instagram's come from audio through a
hosted Whisper. YouTube jobs are handed back untouched (see
`hostPlatforms()` in `worker/platforms.mjs`) -- claiming one would cool the
kind for two hours and stall everything this box can do.

Everything IP-agnostic (comments, analyse, describe, ideas,
transcript_apify) already runs in GitHub Actions; this box does not
duplicate it.

## Deploy / update

```bash
# once: the secrets file (never committed)
bash deploy/phoenix/make-env.sh > /tmp/tn-worker.env
scp -i instance_ssh_key /tmp/tn-worker.env ubuntu@129.146.203.163:/tmp/
ssh -i instance_ssh_key ubuntu@129.146.203.163 \
  'sudo install -o root -g root -m 0600 /tmp/tn-worker.env /etc/tn-worker.env && rm /tmp/tn-worker.env'

# every time
ssh -i instance_ssh_key ubuntu@129.146.203.163 'bash -s' < deploy/phoenix/deploy.sh
```

Four units: `tn-whisper` (whisper.cpp, large-v3-turbo, 127.0.0.1:8090),
`tn-transcript` (server.py on 127.0.0.1:8787), `tn-worker`, and
`tn-enqueue-asr.timer` (hourly; CI cannot plan ASR work because it has no
audio route). Logs: `journalctl -u tn-worker -f`.

## Local Whisper (2026-09-14)

ASR runs on the box: whisper.cpp serving `large-v3-turbo` at the same
OpenAI-format endpoint server.py already called, so `ASR_BASE_URL` is the
only change. Chosen on measurement (a real 52 s TikTok, both cores):

| model | wall | RSS | verdict |
|---|---|---|---|
| small | 39 s | 0.8 GB | fast, but weaker than the whisper-1 the corpus was built with |
| **large-v3-turbo** | 158 s | **1.9 GB** | quality matches whisper-1; alone lifts the box past 20 % memory |
| turbo + `-fa` | 158 s | | flash attention: no gain on this CPU |
| turbo `-bs 1` | 146 s | | greedy: 7 %, not worth the quality trade |
| turbo q5_0 | 224 s | 0.9 GB | **slower** than f16 on this build |

`-l auto` adds ~46 s per clip (an extra encoder pass) and stays on: clients
include German accounts. The library is short-form (p50 48 s, p95 86 s,
max 210 s), so the longest clip takes ~13 min -- hence
`ASR_TIMEOUT_SECONDS=840` / `ASR_FETCH_TIMEOUT_MS=870000`, just under the
15-minute lease.

**This is what keeps the instance alive.** Oracle reclaims an Always-Free
A1 idle 7 days, where idle = CPU, network AND memory all under 20 %. The
resident model puts memory at 21-22 % permanently, and each transcription
pegs both cores. Real work, not fake load.

**Lessons that cost a day, do not rediscover:**
- **Node's `fetch` gives up on response headers at 300 s**, whatever
  `AbortSignal` you pass -- that is undici's own ceiling. The service
  finished every transcription and the worker had already left; retries
  landed 304-305 s apart. The ASR call uses `node:http` now.
- **Whisper cannot tell a song from speech.** `no_speech_prob` was 0.00 for
  music, for lyrics, and for real speech alike. A video set to a licensed
  track came back as 236 characters of Macklemore. TikTok's own `track`
  metadata separates them: "original sound" vs a named song. server.py
  refuses named tracks before transcribing.
- The ASR kind shares the caption handler and used to share its routing:
  a TikTok ranked as a caption candidate, so ASR jobs re-asked for captions
  and settled in 2 s without touching audio. Now `job.kind` routes straight
  to audio.
- The words-per-second gate ran only from 20 s; `*MUZIE*` on an 18.7 s clip
  walked through. From 8 s now.

## Gotchas

- `curl_cffi` is required or TikTok answers every request with "Unexpected
  response from webpage request". deploy.sh installs it.
- Node 22 is a tarball at `/opt/node-v22`; the system Node 18 runs the
  arcade's Strike server and is not touched.
- The worker's heartbeat shows on the /data page as `tn-worker-phoenix`.

## Measured in the first hour (2026-09-13)

- **Most of the "backlog" was stale.** Of 58 pending TikTok `transcript`
  jobs, 40 were for items Apify had already transcribed while those jobs
  waited for a host. The handler now checks for an existing transcript
  first (the Apify lane always did). Real TikTok work was 18 items.
- **Instagram ASR had nothing to do**: of 199 Instagram-only items, 160 had
  transcripts (the desktop's earlier run), 20 belong to archived clients, 14
  are unapproved. The lane is live and picks up new posts as they are approved.
- **Region-locked posts** answer "Your IP address is blocked from accessing
  this post" (a German eye clinic, from a US address). Classified as a
  transport failure, retried on bounded backoff, then failed; the Apify
  planner targets the item independently. 1 of 17 fetches. The box's own IP
  is not blocked -- verified against a post that worked an hour earlier.
- **Pacing is by request, not by claim.** `transcript` is metered at 30/hour
  (a burst of ~90 once earned a throttle). Tokens are refunded for skips and
  stale settles, so those churn at ~2.5 s each; real fetches keep the 30/hour.
- **The box is still idle by Oracle's reckoning** -- load 0.03, memory 7 %.
  Fetching is I/O-bound. Reclamation needs CPU, network AND memory all under
  20 % for 7 days. A local Whisper (OpenAI-compatible endpoint on loopback,
  `ASR_BASE_URL` pointed at it) would be real work, free ASR, and >20 % memory
  resident -- the natural next step if reclamation becomes a concern.
