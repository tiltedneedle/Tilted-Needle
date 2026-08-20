"""
Watch every Oracle tenancy/region we have for Always Free A1 capacity.

    python deploy/oracle/watch_regions.py            # report once
    python deploy/oracle/watch_regions.py --watch    # poll until something frees

WHY MORE THAN ONE

A1 capacity is per REGION, not per account, and it is the binding constraint
on this project -- not quota. Measured 2026-08-20, both tenancies report an
entitlement of 2 OCPU / 12 GB with 0 used, and both answer
OUT_OF_HOST_CAPACITY for every size and every fault domain:

    ap-singapore-1  (tiltedneedletools, PAYG)   1/6, 2/12, 4/24  all out
    me-abudhabi-1   (cyberxnerd702)             1/6, 2/12, 4/24  all out

So the second account is not a way around the problem; it is a second place
to be waiting. That is still worth having, because whichever region frees
first wins and neither costs anything to ask.

WHAT MAKES POLLING TWO PLACES AFFORDABLE

CreateComputeCapacityReport, which answers the capacity question outside the
launch_instance rate budget (see capacity.py). Asking by launching would cost
one throttle per extra region; asking by report costs nothing, so watching
two tenancies is exactly as cheap as watching one.

NOTHING HERE PROVISIONS. It reports, and it refuses to consider any size above
the Always Free ceiling. Landing an instance is still provision.py's job, on
the profile that won.
"""
import argparse
import random
import sys
import time

import oci

from capacity import shape_report

# The Always Free A1 ceiling, and the ladder worth taking. Smallest first: A1
# Flex resizes in place, so a 1/6 that exists beats a 2/12 that does not.
SIZES = [(1, 6), (2, 12)]
MAX_OCPUS, MAX_MEMORY_GB = 2, 12

# Every tenancy we hold, by ~/.oci/config profile.
PROFILES = ["DEFAULT", "ABUDHABI"]


def context(profile: str):
    """
    A tenancy to watch, from ~/.oci/config or from the environment.

    CI has no config file, so when OCI_USER_OCID is present the credentials
    are assembled from env vars exactly as probe_capacity.py does it -- the
    key arrives as a string because a GitHub secret is a string, and is
    written 0600 into the runner's temp space, which is destroyed with the
    job. One profile only in that mode: CI carries one tenancy's secrets.
    """
    import os

    if os.environ.get("OCI_USER_OCID") and profile == "DEFAULT":
        from probe_capacity import load_config  # same assembly, one copy
        cfg = load_config()
    else:
        cfg = oci.config.from_file(profile_name=profile)
    tenancy = cfg["tenancy"]
    ad = oci.identity.IdentityClient(cfg).list_availability_domains(tenancy).data[0].name
    return {
        "profile": profile,
        "region": cfg["region"],
        "tenancy": tenancy,
        "ad": ad,
        "compute": oci.core.ComputeClient(cfg),
    }


def sweep(ctxs) -> list[tuple[dict, int, int]]:
    """Every (context, ocpus, memory) that reports room right now."""
    free = []
    for c in ctxs:
        parts = []
        for ocpus, mem in SIZES:
            if ocpus > MAX_OCPUS or mem > MAX_MEMORY_GB:
                continue  # never ask for something we may not keep
            status = shape_report(c["compute"], c["tenancy"], c["ad"], ocpus, mem)
            parts.append(f"{ocpus:g}/{mem:g}={status}")
            if status == "AVAILABLE":
                free.append((c, ocpus, mem))
        print(f"  {c['region']:<16} {'  '.join(parts)}", flush=True)
    return free


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--watch", action="store_true")
    ap.add_argument("--hours", type=float, default=24.0)
    args = ap.parse_args()

    ctxs = []
    for p in PROFILES:
        try:
            ctxs.append(context(p))
        except Exception as e:  # noqa: BLE001 -- a missing profile is not fatal
            print(f"  {p}: unavailable ({type(e).__name__})", file=sys.stderr)
    if not ctxs:
        print("no usable profiles in ~/.oci/config", file=sys.stderr)
        return 2

    deadline = time.time() + args.hours * 3600
    checks = 0
    while True:
        checks += 1
        print(f"--- check {checks} ---", flush=True)
        free = sweep(ctxs)
        if free:
            c, ocpus, mem = free[0]
            print(f"\nCAPACITY: {ocpus:g} OCPU / {mem:g} GB in {c['region']} "
                  f"(profile {c['profile']})")
            print("Claim it with:")
            print(f"  OCI_CLI_PROFILE={c['profile']} python deploy/oracle/provision.py "
                  f"--shape a1 --ocpus {ocpus:g} --memory {mem:g} --ssh-key ~/.ssh/tiltedneedle_worker.pub")
            return 0
        if not args.watch or time.time() > deadline:
            break
        # No launch was attempted, so nothing is throttled and the next ask
        # can be soon.
        wait = 300 + random.random() * 300
        print(f"  nothing free; again in {wait / 60:.1f} min "
              f"({(deadline - time.time()) / 3600:.1f}h left)", flush=True)
        time.sleep(min(wait, max(0, deadline - time.time())))

    print("\nno capacity in any region during the window")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
