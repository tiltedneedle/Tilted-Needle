#!/usr/bin/env bash
# Produce /etc/tn-worker.env for the Phoenix box from the developer's .env.local.
#
#   bash deploy/phoenix/make-env.sh > /tmp/tn-worker.env
#   scp -i instance_ssh_key /tmp/tn-worker.env ubuntu@129.146.203.163:/tmp/
#   ssh ... 'sudo install -o root -g root -m 0600 /tmp/tn-worker.env /etc/tn-worker.env && rm /tmp/tn-worker.env'
#
# Only what the two services need leaves this machine. The worker runs the
# transcript kinds only, so it needs the database; the transcript service
# needs an ASR key (OpenAI-compatible, whisper-1) because it extracts audio
# and hands it to a hosted model rather than running one. Nothing else --
# not Apify, not YouTube, not the Vercel cron secret -- is copied.
#
# The DISCOVER_SECRET is generated fresh here rather than reused from the
# desktop: it guards a loopback endpoint on a different machine, and the two
# have no reason to share it.
set -euo pipefail
cd "$(dirname "$0")/../.."
[ -f .env.local ] || { echo ".env.local not found" >&2; exit 1; }

get() { sed -n "s/^$1=//p" .env.local | head -1 | sed -E 's/^["'"'"']|["'"'"']$//g'; }
need() { local v; v=$(get "$1"); [ -n "$v" ] || { echo "$1 is not set in .env.local" >&2; exit 1; }; printf '%s=%s\n' "$1" "$v"; }

SECRET=$(python -c "import secrets; print(secrets.token_hex(32))")

need NEXT_PUBLIC_SUPABASE_URL
need SUPABASE_SECRET_KEY
# ASR: server.py falls back to LLM_* when ASR_* are unset. Named explicitly
# here so a future change to the chat provider cannot silently move ASR.
printf 'ASR_API_KEY=%s\n' "$(get LLM_API_KEY)"
printf 'ASR_BASE_URL=%s\n' "$(get LLM_BASE_URL)"
printf 'ASR_MODEL=whisper-1\n'
printf 'DISCOVER_SECRET=%s\n' "$SECRET"
printf 'TIKTOK_DISCOVER_URL=http://127.0.0.1:8787/discover\n'
printf 'TIKTOK_DISCOVER_SECRET=%s\n' "$SECRET"
# The whole point of this host. See worker/platforms.mjs hostPlatforms().
printf 'TRANSCRIPT_PLATFORMS=tiktok,instagram\n'
printf 'WORKER_ID=tn-worker-phoenix\n'
printf 'BATCH=3\n'
