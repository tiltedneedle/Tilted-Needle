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

Three units: `tn-transcript` (server.py on 127.0.0.1:8787), `tn-worker`, and
`tn-enqueue-asr.timer` (hourly; CI cannot plan ASR work because it has no
audio route). Logs: `journalctl -u tn-worker -f`.

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
