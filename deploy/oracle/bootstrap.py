"""
Apply the host spec in cloud-init.yaml to a host that is ALREADY running.

    python deploy/oracle/bootstrap.py --host 1.2.3.4 --key ~/.ssh/tn_worker --plan
    python deploy/oracle/bootstrap.py --host 1.2.3.4 --key ~/.ssh/tn_worker

WHY THIS EXISTS

cloud-init runs exactly once, at first boot, from user-data attached at launch.
That is fine while every instance comes from provision.py -- but the tenancy's
`tn-worker` was launched with EMPTY user-data (verified: 0 bytes at
/var/lib/cloud/instance/user-data.txt), so cloud-init reported "done" after 29
seconds having configured nothing. The result is a bare Ubuntu box wearing the
right name: no node, no worker user, no unit files, nothing in /opt.

Before this, the only way back was to terminate and relaunch. That is a
destructive action to fix a box holding no state, and in a region with one
availability domain and chronically exhausted A1 capacity it risks not getting
an instance back at all. So the host spec becomes something that can be
APPLIED, not only something that can be born.

ONE SOURCE OF TRUTH. This reads cloud-init.yaml and executes what it declares
-- packages, write_files, runcmd, in that order. It does not restate any of
it. A step added to the yaml is picked up here for free, which is the only way
the two stay honest with each other.

IDEMPOTENT, because it will be run on half-configured boxes. Every write is
compared before it is made, and runcmd lines are the ones the yaml already
guards (`useradd || true`, `mkdir -p`, `systemctl enable`). Lines that are not
safe to repeat are listed in ONCE_ONLY below and skipped when their effect is
already present.

Nothing here provisions anything: no shape, no volume, no instance. It cannot
move the tenancy outside Always Free because it never talks to the OCI API.
"""
import argparse
import shlex
import subprocess
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).parent
SPEC = HERE / "cloud-init.yaml"

# Commands whose effect is not safe or not useful to repeat, each with a test
# that decides whether the effect is already in place. A miss here costs a
# duplicated swapfile line in /etc/fstab, which is exactly the sort of thing
# that survives a reboot as a failure to mount.
ONCE_ONLY = [
    ("fallocate -l 2G /swapfile", "test -e /swapfile"),
    ("chmod 600 /swapfile", "test -e /swapfile"),
    ("mkswap /swapfile", "swapon --show=NAME --noheadings | grep -q /swapfile"),
    ("swapon /swapfile", "swapon --show=NAME --noheadings | grep -q /swapfile"),
    ('echo "/swapfile none swap sw 0 0" >> /etc/fstab', "grep -q '^/swapfile' /etc/fstab"),
    ("python3 -m venv /opt/tn-transcript/venv", "test -x /opt/tn-transcript/venv/bin/python"),
    ("curl -fsSL https://deb.nodesource.com/setup_22.x | bash -", "command -v node"),
    ("apt-get install -y nodejs", "command -v node"),
]


def run(host: str, key: str, cmd: str, sudo: bool = True, check: bool = True):
    """One SSH round trip. Returns (code, stdout+stderr)."""
    remote = f"sudo -n bash -c {shlex.quote(cmd)}" if sudo else cmd
    p = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no",
         "-o", "ConnectTimeout=20", "-i", key, f"ubuntu@{host}", remote],
        capture_output=True, text=True, timeout=1800,
    )
    out = (p.stdout + p.stderr).strip()
    if check and p.returncode != 0:
        print(f"  FAILED ({p.returncode}): {cmd[:70]}")
        if out:
            print("    " + out.replace("\n", "\n    ")[:600])
    return p.returncode, out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", required=True)
    ap.add_argument("--key", required=True, help="PRIVATE key that can reach ubuntu@host")
    ap.add_argument("--plan", action="store_true", help="show what would change")
    args = ap.parse_args()

    spec = yaml.safe_load(SPEC.read_text(encoding="utf-8"))
    key = str(Path(args.key).expanduser())

    code, who = run(args.host, key, "id -un", sudo=False)
    if code != 0:
        print(f"cannot reach ubuntu@{args.host}: {who[:200]}", file=sys.stderr)
        return 2
    print(f"  connected as {who} on {args.host}")

    # ---- packages ---------------------------------------------------------
    pkgs = spec.get("packages", [])
    if pkgs:
        print(f"  packages: {' '.join(pkgs)}")
        if not args.plan:
            run(args.host, key, "DEBIAN_FRONTEND=noninteractive apt-get update -qq")
            run(args.host, key,
                "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq " + " ".join(pkgs))

    # ---- write_files ------------------------------------------------------
    for f in spec.get("write_files", []):
        path, content = f["path"], f["content"]
        perms = f.get("permissions", "0644")
        # Compare before writing, so a re-run over a configured box is silent
        # rather than a wall of "wrote" lines that hide the one real change.
        code, _ = run(args.host, key,
                      f"test -f {shlex.quote(path)} && "
                      f"printf %s {shlex.quote(content)} | diff -q - {shlex.quote(path)} >/dev/null",
                      check=False)
        if code == 0:
            print(f"  unchanged: {path}")
            continue
        print(f"  {'WOULD write' if args.plan else 'write'}: {path}")
        if not args.plan:
            run(args.host, key,
                f"mkdir -p {shlex.quote(str(Path(path).parent).replace(chr(92), '/'))} && "
                f"printf %s {shlex.quote(content)} > {shlex.quote(path)} && "
                f"chmod {perms} {shlex.quote(path)}")

    # ---- runcmd -----------------------------------------------------------
    once = dict(ONCE_ONLY)
    for cmd in spec.get("runcmd", []):
        if isinstance(cmd, list):
            cmd = " ".join(cmd)
        guard = once.get(cmd.strip())
        if guard:
            code, _ = run(args.host, key, guard, check=False)
            if code == 0:
                print(f"  already done: {cmd[:64]}")
                continue
        print(f"  {'WOULD run' if args.plan else 'run'}: {cmd[:72]}")
        if not args.plan:
            run(args.host, key, cmd)

    if args.plan:
        print("\n  plan only — nothing changed")
        return 0

    print("\n  verifying")
    for label, probe in [
        ("node", "node -v"),
        ("worker user", "id -un worker"),
        ("swap", "swapon --show=NAME,SIZE --noheadings"),
        ("yt-dlp", "/opt/tn-transcript/venv/bin/yt-dlp --version"),
        ("units", "systemctl is-enabled tn-worker tn-transcript | tr '\\n' ' '"),
    ]:
        code, out = run(args.host, key, probe, check=False)
        print(f"    {label:12} {out.splitlines()[0] if out else '(missing)' if code else 'ok'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
