#!/usr/bin/env bash
# Install or update the Tilted Needle yt-dlp lane on the Oracle Phoenix box.
#
#   ssh -i instance_ssh_key ubuntu@129.146.203.163 'bash -s' < deploy/phoenix/deploy.sh
#
# Idempotent: safe to re-run for a code update. It does NOT write
# /etc/tn-worker.env -- that holds secrets and is produced on the developer
# machine by make-env.sh and copied separately. It exits before touching any
# unit if that file is missing.
#
# WHAT THIS BOX DOES AND DOES NOT DO. Measured 2026-09-13 from this address:
#   TikTok     metadata, eng-US caption track, audio   -> free transcripts
#   Instagram  audio                                    -> ASR transcripts
#   YouTube    "Sign in to confirm you're not a bot"    -> nothing, ever
# So the worker runs ONLY the transcript kinds, and only for tiktok and
# instagram (TRANSCRIPT_PLATFORMS in the env file). Everything IP-agnostic
# already runs in GitHub Actions.
#
# The arcade already on this machine is left alone: Node 22 is installed as a
# tarball under /opt/node-v22 rather than replacing the system Node 18 that
# runs Strike.
set -euo pipefail

REPO=https://github.com/tiltedneedle/Tilted-Needle.git
NODE_VER=v22.12.0
NODE_DIR=/opt/node-v22
WORKER=/opt/tn-worker
TRANSCRIPT=/opt/tn-transcript
VENV=/opt/tn/venv
ENVFILE=/etc/tn-worker.env

if [ ! -s "$ENVFILE" ]; then
  echo "!! $ENVFILE is missing. Produce it with deploy/phoenix/make-env.sh and copy it first." >&2
  exit 2
fi

echo "== node $NODE_VER (isolated) =="
if [ ! -x "$NODE_DIR/bin/node" ]; then
  sudo mkdir -p "$NODE_DIR"
  curl -fsSL "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-linux-arm64.tar.xz" \
    | sudo tar -xJ --strip-components=1 -C "$NODE_DIR"
fi
"$NODE_DIR/bin/node" --version

echo "== code =="
sudo mkdir -p "$WORKER" && sudo chown ubuntu:ubuntu "$WORKER"
if [ -d "$WORKER/.git" ]; then
  git -C "$WORKER" fetch -q origin main && git -C "$WORKER" reset -q --hard origin/main
else
  git clone -q --depth 1 "$REPO" "$WORKER"
fi
echo "   at $(git -C "$WORKER" rev-parse --short HEAD)"
( cd "$WORKER" && PATH="$NODE_DIR/bin:$PATH" npm ci --omit=dev --ignore-scripts --no-audit --no-fund 2>&1 | tail -1 )

echo "== transcript service (yt-dlp) =="
sudo mkdir -p "$TRANSCRIPT" && sudo chown ubuntu:ubuntu "$TRANSCRIPT"
cp "$WORKER/deploy/tiktok-discover/server.py" "$TRANSCRIPT/server.py"
if [ ! -x "$VENV/bin/python" ]; then python3 -m venv "$VENV"; fi
# curl_cffi is what makes TikTok answer at all: without a browser TLS
# fingerprint to impersonate, every TikTok request came back "Unexpected
# response from webpage request".
"$VENV/bin/pip" -q install -U yt-dlp curl_cffi flask 2>&1 | grep -v -i notice | tail -1 || true
echo "   yt-dlp $("$VENV/bin/yt-dlp" --version), ffmpeg $(ffmpeg -version 2>/dev/null | head -1 | cut -d' ' -f3)"

echo "== units =="
for u in tn-transcript.service tn-worker.service tn-enqueue-asr.service tn-enqueue-asr.timer; do
  sudo install -m 0644 "$WORKER/deploy/phoenix/$u" "/etc/systemd/system/$u"
done
sudo systemctl daemon-reload
sudo systemctl enable -q tn-transcript.service tn-worker.service tn-enqueue-asr.timer
sudo systemctl restart tn-transcript.service
sleep 3
sudo systemctl restart tn-worker.service
sudo systemctl start tn-enqueue-asr.timer

echo "== state =="
systemctl is-active tn-transcript tn-worker tn-enqueue-asr.timer | paste - - - | sed 's/^/   transcript worker timer: /'
# Health: the service's own view of its routes. `asr` and `ffmpeg` both true
# is what asrReady() in enqueue.mjs requires before it will plan ASR work.
SECRET=$(sudo sed -n 's/^DISCOVER_SECRET=//p' "$ENVFILE")
curl -s -H "Authorization: Bearer $SECRET" http://127.0.0.1:8787/health | head -c 400; echo
