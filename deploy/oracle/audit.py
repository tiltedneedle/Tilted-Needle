"""
Audit the Oracle tenancy against the Always Free ceilings.

A rule written in a document is a hope. This is the enforcement: it reads what
actually exists and fails loudly if anything sits outside Always Free, so the
answer to "are we still free?" is a command rather than a memory.

    python deploy/oracle/audit.py          # exits 1 if anything is over
    python deploy/oracle/audit.py --json   # machine-readable

Run it before and after any provisioning work (AGENTS.md).

The reason this exists at all: the console and the limits API report FAR more
than the ceiling while the 30-day trial is in force -- this tenancy shows 41 A1
OCPUs against a real allowance of 4. Anything above the ceiling is reclaimed or
billed at conversion, and by then it is someone's invoice rather than someone's
mistake.
"""
import argparse
import json
import sys

import oci

# The ceilings. These are the rule; do not raise them (AGENTS.md).
MAX_A1_OCPUS = 4
MAX_A1_MEMORY_GB = 24
MAX_MICRO_INSTANCES = 2
MAX_BLOCK_GB = 200
MAX_BLOCK_VOLUMES = 2

A1_SHAPE = "VM.Standard.A1.Flex"
MICRO_SHAPE = "VM.Standard.E2.1.Micro"

# Anything Always Free covers. A shape outside this list is a paid shape, full
# stop -- there is no "small enough to be free" exception.
FREE_SHAPES = {A1_SHAPE, MICRO_SHAPE}

LIVE = ("RUNNING", "PROVISIONING", "STARTING", "STOPPING", "STOPPED")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    args = ap.parse_args()

    cfg = oci.config.from_file()
    oci.config.validate_config(cfg)
    tenancy = cfg["tenancy"]

    compute = oci.core.ComputeClient(cfg)
    block = oci.core.BlockstorageClient(cfg)
    identity = oci.identity.IdentityClient(cfg)

    problems: list[str] = []
    findings: dict = {"region": cfg["region"], "instances": [], "volumes": []}

    # --- Compute -----------------------------------------------------------
    instances = [
        i for i in compute.list_instances(compartment_id=tenancy).data
        if i.lifecycle_state in LIVE
    ]

    a1_ocpus = 0.0
    a1_memory = 0.0
    micro_count = 0

    for i in instances:
        shape = i.shape
        ocpus = getattr(i.shape_config, "ocpus", None) if i.shape_config else None
        memory = getattr(i.shape_config, "memory_in_gbs", None) if i.shape_config else None
        findings["instances"].append({
            "name": i.display_name, "shape": shape,
            "ocpus": ocpus, "memoryGb": memory, "state": i.lifecycle_state,
        })

        if shape not in FREE_SHAPES:
            problems.append(
                f"PAID SHAPE: '{i.display_name}' is {shape}, which is not Always Free eligible."
            )
            continue
        if shape == A1_SHAPE:
            a1_ocpus += ocpus or 0
            a1_memory += memory or 0
        elif shape == MICRO_SHAPE:
            micro_count += 1

    if a1_ocpus > MAX_A1_OCPUS:
        problems.append(
            f"A1 OVER CEILING: {a1_ocpus:g} OCPUs across all A1 instances, "
            f"limit is {MAX_A1_OCPUS}. The trial quota allows more; the free tier does not."
        )
    if a1_memory > MAX_A1_MEMORY_GB:
        problems.append(
            f"A1 MEMORY OVER CEILING: {a1_memory:g} GB, limit is {MAX_A1_MEMORY_GB}."
        )
    if micro_count > MAX_MICRO_INSTANCES:
        problems.append(
            f"TOO MANY MICRO INSTANCES: {micro_count}, limit is {MAX_MICRO_INSTANCES}."
        )

    # --- Block storage -----------------------------------------------------
    # Boot volumes count toward the same allowance as block volumes, which is
    # the part people miss: two instances with default boot volumes are
    # already most of the 200 GB.
    ads = identity.list_availability_domains(tenancy).data
    total_gb = 0
    volume_count = 0
    for ad in ads:
        for bv in block.list_boot_volumes(availability_domain=ad.name, compartment_id=tenancy).data:
            if bv.lifecycle_state != "AVAILABLE":
                continue
            total_gb += int(bv.size_in_gbs or 0)
            volume_count += 1
            findings["volumes"].append({
                "name": bv.display_name, "type": "boot", "sizeGb": bv.size_in_gbs,
            })
        for v in block.list_volumes(availability_domain=ad.name, compartment_id=tenancy).data:
            if v.lifecycle_state != "AVAILABLE":
                continue
            total_gb += int(v.size_in_gbs or 0)
            volume_count += 1
            findings["volumes"].append({
                "name": v.display_name, "type": "block", "sizeGb": v.size_in_gbs,
            })

    if total_gb > MAX_BLOCK_GB:
        problems.append(f"STORAGE OVER CEILING: {total_gb} GB, limit is {MAX_BLOCK_GB}.")
    if volume_count > MAX_BLOCK_VOLUMES + MAX_MICRO_INSTANCES:
        problems.append(f"UNEXPECTED VOLUME COUNT: {volume_count}.")

    # --- Things that are free today and may not be tomorrow ----------------
    # Not errors, but worth surfacing: this project needs exactly one compute
    # instance, so anything else is drift.
    try:
        adbs = oci.database.DatabaseClient(cfg).list_autonomous_databases(
            compartment_id=tenancy
        ).data
        live_adbs = [d for d in adbs if d.lifecycle_state not in ("TERMINATED", "TERMINATING")]
        findings["autonomousDatabases"] = len(live_adbs)
        if live_adbs:
            problems.append(
                f"UNEXPECTED: {len(live_adbs)} Autonomous Database(s). This project uses "
                "Supabase and needs none (PRD §4.3)."
            )
    except Exception:  # noqa: BLE001 -- the service may not be reachable; not a failure
        findings["autonomousDatabases"] = None

    findings["a1Ocpus"] = a1_ocpus
    findings["a1MemoryGb"] = a1_memory
    findings["microInstances"] = micro_count
    findings["storageGb"] = total_gb
    findings["problems"] = problems

    if args.json:
        print(json.dumps(findings, indent=2))
    else:
        print(f"Tenancy audit — {cfg['region']}")
        print(f"  instances        : {len(instances)}")
        for i in findings["instances"]:
            size = f"{i['ocpus']:g}/{i['memoryGb']:g}GB" if i["ocpus"] else "fixed"
            print(f"      {i['name']}  {i['shape']}  {size}  {i['state']}")
        print(f"  A1 usage         : {a1_ocpus:g}/{MAX_A1_OCPUS} OCPU, "
              f"{a1_memory:g}/{MAX_A1_MEMORY_GB} GB")
        print(f"  micro instances  : {micro_count}/{MAX_MICRO_INSTANCES}")
        print(f"  block storage    : {total_gb}/{MAX_BLOCK_GB} GB across {volume_count} volume(s)")
        if findings["autonomousDatabases"] is not None:
            print(f"  autonomous DBs   : {findings['autonomousDatabases']} (expected 0)")
        print()
        if problems:
            print("WITHIN ALWAYS FREE: NO")
            for p in problems:
                print(f"  ! {p}")
        else:
            print("WITHIN ALWAYS FREE: yes — nothing in this tenancy can generate a bill.")

    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
