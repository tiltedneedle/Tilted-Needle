"""
Put the worker ON a host that bootstrap.py has configured.

    python deploy/oracle/deploy_worker.py --host 1.2.3.4 --key ~/.ssh/tn_worker
    python deploy/oracle/deploy_worker.py --host 1.2.3.4 --key ~/.ssh/tn_worker --start

The division of labour, and why there are three scripts:

    provision.py      makes the INSTANCE exist        (OCI API)
    bootstrap.py      makes the HOST able to run it   (packages, users, units)
    deploy_worker.py  puts the CODE and SECRETS on it (this file)

The first migration was done by hand over SSH, which worked once and taught
three lessons this file now encodes:

  - The app's package.json must NOT reach the box. Installing it puts
    Next.js and React on a small ARM host for nothing; the worker's only
    runtime dependency is @supabase/supabase-js, so a trimmed manifest is
    written on the fly.
  - Secrets go straight from .env.local into a root-owned 0600
    /etc/tn-worker.env over the SSH pipe. They never touch a terminal, a
    log, or a temp file that outlives the run.
  - The unit file already carries --kinds without transcript (see
    cloud-init.yaml for why: datacenter IPs poison transcript jobs as
    terminally "no captions"). This script must never widen that.

Idempotent: re-running replaces the code and secrets and restarts the
services. State lives in Supabase, so nothing on the box is precious.
"""
import argparse
import io
import shlex
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

# What the worker actually imports (worker/index.mjs pulls TS straight from
# src/lib via the strip-types alias) plus the transcript service.
BUNDLE = [
    "worker",
    "scripts/register-alias.mjs",
    "scripts/alias-hooks.mjs",
    "src/lib",
    "deploy/tiktok-discover/server.py",
    "deploy/tiktok-discover/requirements.txt",
    "package.json",
]

# The env the worker and transcript service read. TIKTOK_DISCOVER_URL is
# forced to loopback because the service runs on this same box.
ENV_KEYS = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "LLM_API_KEY",
    "LLM_BASE_URL",
    "LLM_MODEL",
    "YOUTUBE_API_KEY",
    "TIKTOK_DISCOVER_SECRET",
    # Optional. Present only if a residential proxy has been bought; the
    # service treats an unset value as "no proxy" rather than an error.
    "YTDLP_PROXY",
]

REMOTE_INSTALL = r"""
set -e
rm -rf /opt/tn-worker/worker /opt/tn-worker/scripts /opt/tn-worker/src
mkdir -p /opt/tn-worker /opt/tn-transcript
tar xzf /tmp/tn-deploy.tgz -C /opt/tn-worker worker scripts src package.json
tar xzf /tmp/tn-deploy.tgz -C /tmp deploy/tiktok-discover/server.py deploy/tiktok-discover/requirements.txt
cp /tmp/deploy/tiktok-discover/server.py /opt/tn-transcript/server.py
cd /opt/tn-worker
node -e '
const p = require("./package.json");
const deps = { "@supabase/supabase-js": p.dependencies["@supabase/supabase-js"] };
require("fs").writeFileSync("./package.json",
  JSON.stringify({ name: "tn-worker", private: true, type: "module", dependencies: deps }, null, 2));
'
npm install --omit=dev --no-audit --no-fund 2>&1 | tail -1
/opt/tn-transcript/venv/bin/pip install --quiet -r /tmp/deploy/tiktok-discover/requirements.txt
chown -R worker:worker /opt/tn-worker /opt/tn-transcript
rm -f /tmp/tn-deploy.tgz
echo DEPLOYED
"""


def ssh(host: str, key: str, cmd: str, stdin: bytes | None = None) -> tuple[int, str]:
    p = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no",
         "-o", "ConnectTimeout=20", "-i", key, f"ubuntu@{host}",
         f"sudo -n bash -c {shlex.quote(cmd)}"],
        input=stdin, capture_output=True, timeout=1800,
    )
    return p.returncode, (p.stdout + p.stderr).decode("utf-8", "replace").strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", required=True)
    ap.add_argument("--key", required=True)
    ap.add_argument("--start", action="store_true",
                    help="start tn-worker and tn-transcript after deploying")
    args = ap.parse_args()
    key = str(Path(args.key).expanduser())

    # ---- code bundle -------------------------------------------------------
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for rel in BUNDLE:
            tar.add(REPO / rel, arcname=rel)
    with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as fh:
        fh.write(buf.getvalue())
        local_tgz = fh.name
    print(f"  bundle: {len(buf.getvalue()) // 1024} KB")

    rc = subprocess.run(
        ["scp", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no", "-i", key,
         local_tgz, f"ubuntu@{args.host}:/tmp/tn-deploy.tgz"],
        capture_output=True,
    ).returncode
    Path(local_tgz).unlink(missing_ok=True)
    if rc != 0:
        print("scp failed", file=sys.stderr)
        return 1

    code, out = ssh(args.host, key, REMOTE_INSTALL)
    print("  " + out.splitlines()[-1] if out else "")
    if code != 0 or "DEPLOYED" not in out:
        print(out[-800:], file=sys.stderr)
        return 1

    # ---- secrets, straight down the pipe -----------------------------------
    env: dict[str, str] = {}
    for line in (REPO / ".env.local").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    payload = [f"{k}={env[k]}" for k in ENV_KEYS if env.get(k)]
    payload += [
        "TIKTOK_DISCOVER_URL=http://127.0.0.1:8787",
        "DISCOVER_SECRET=" + env.get("TIKTOK_DISCOVER_SECRET", ""),
        "WORKER_ID=tn-worker-oracle",
    ]
    code, out = ssh(
        args.host, key,
        "cat > /etc/tn-worker.env && chmod 600 /etc/tn-worker.env && chown root:root /etc/tn-worker.env && wc -l < /etc/tn-worker.env",
        stdin=("\n".join(payload) + "\n").encode(),
    )
    print(f"  secrets: {out} lines placed" if code == 0 else out, flush=True)
    if code != 0:
        return 1

    # ---- the optional YouTube cookie jar ------------------------------------
    #
    # Sent only if it exists locally. Same handling as the secrets above:
    # straight down the SSH pipe into a root-owned 0600 file, never echoed.
    jar = REPO / ".youtube-cookies.txt"
    if jar.exists():
        code, out = ssh(
            args.host, key,
            "cat > /etc/tn-youtube-cookies.txt && chmod 600 /etc/tn-youtube-cookies.txt && "
            "chown root:root /etc/tn-youtube-cookies.txt && wc -l < /etc/tn-youtube-cookies.txt",
            stdin=jar.read_bytes(),
        )
        print(f"  cookies: {out} lines placed" if code == 0 else f"  cookies FAILED: {out[:120]}")
    else:
        print("  cookies: none locally (.youtube-cookies.txt absent) — YouTube "
              "captions will keep refusing this host")

    # ---- start and prove it -------------------------------------------------
    if args.start:
        code, out = ssh(
            args.host, key,
            "systemctl daemon-reload && systemctl restart tn-transcript tn-worker && sleep 8 && "
            "systemctl is-active tn-transcript tn-worker && "
            "journalctl -u tn-worker -n 2 --no-pager -o cat",
        )
        print("  " + out.replace("\n", "\n  "))
        if code != 0 or out.count("active") < 2:
            return 1
        # The unit must still exclude transcripts. A deploy that silently
        # widened the kinds would re-poison the queue (see cloud-init.yaml).
        #
        # `systemctl cat`, not the unit file: the restriction can live in the
        # file (new boxes, via cloud-init) or in a drop-in (the first box,
        # patched live), and only the merged view is what systemd actually
        # runs. Grepping the file alone stopped a correctly-restricted worker
        # -- its own startup log showed the kinds active -- because the guard
        # read the wrong layer.
        code, out = ssh(args.host, key,
                        "systemctl cat tn-worker | grep -o -- '--kinds=[a-z_,]*' | tail -1 || echo MISSING")
        print(f"  kinds guard: {out}")
        if "transcript" in out or "MISSING" in out:
            print("  REFUSING to leave this running: transcript jobs would be poisoned.", file=sys.stderr)
            ssh(args.host, key, "systemctl stop tn-worker")
            return 2
    else:
        print("  deployed but not started — pass --start to run it")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
