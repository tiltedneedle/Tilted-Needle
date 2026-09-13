#!/usr/bin/env bash
# Produce /etc/tn-worker.env for the Phoenix box from the developer's .env.local.
#
#   bash deploy/phoenix/make-env.sh > /tmp/tn-worker.env
#   scp -i instance_ssh_key /tmp/tn-worker.env ubuntu@129.146.203.163:/tmp/
#   ssh ... 'sudo install -o root -g root -m 0600 /tmp/tn-worker.env /etc/tn-worker.env && rm /tmp/tn-worker.env'
#
# Only what the services need leaves this machine: the database credentials.
# ASR runs locally (tn-whisper), so no model-provider key is copied at all --
# nor Apify, nor YouTube, nor the Vercel cron secret.
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
# ASR is LOCAL: whisper.cpp on this box (tn-whisper.service, loopback 8090),
# speaking the same OpenAI-format endpoint server.py already calls. No key
# leaves this machine for it; ASR_API_KEY only has to be non-empty because
# server.py treats an empty one as "no ASR route" and the planner then queues
# nothing. Timeouts sized for large-v3-turbo on two ARM cores against this
# library's longest clip (210 s), just under the 15-minute job lease.
printf 'ASR_API_KEY=local\n'
printf 'ASR_BASE_URL=http://127.0.0.1:8090/v1\n'
printf 'ASR_MODEL=large-v3-turbo\n'
printf 'ASR_TIMEOUT_SECONDS=840\n'
printf 'ASR_FETCH_TIMEOUT_MS=870000\n'
printf 'DISCOVER_SECRET=%s\n' "$SECRET"
printf 'TIKTOK_DISCOVER_URL=http://127.0.0.1:8787/discover\n'
printf 'TIKTOK_DISCOVER_SECRET=%s\n' "$SECRET"
# The whole point of this host. See worker/platforms.mjs hostPlatforms().
printf 'TRANSCRIPT_PLATFORMS=tiktok,instagram\n'
printf 'WORKER_ID=tn-worker-phoenix\n'
printf 'BATCH=3\n'
