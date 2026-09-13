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
