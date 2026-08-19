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
OCPUs against a real allowance of 2. Anything above the ceiling is reclaimed or
billed at conversion, and by then it is someone's invoice rather than someone's
mistake.
"""
import argparse
import json
import sys

import oci

# The ceilings. These are the rule; do not raise them (AGENTS.md).
#
# 2 OCPU / 12 GB, not the 4 / 24 this file shipped with. Oracle tightened the
# Always Free A1 allowance on 2026-06-15 and provision.py and
# probe_capacity.py were both moved to the new number; this file was not, so
# the one component whose entire job is to fail loudly when the tenancy sits
# outside Always Free would have stayed silent all the way to DOUBLE the
# allowance. An audit that passes a billable tenancy is worse than no audit,
# because it is trusted.
MAX_A1_OCPUS = 2
MAX_A1_MEMORY_GB = 12
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
                "vpus": bv.vpus_per_gb,
            })
            # Performance is billed SEPARATELY from capacity. Balanced (10) is
            # the launch default and the floor for a boot volume; anything
            # above it is a charge that the GB total here cannot show.
            if (bv.vpus_per_gb or 0) > 10:
                problems.append(
                    f"BOOT VOLUME PERFORMANCE: {bv.display_name} is at {bv.vpus_per_gb} VPU/GB. "
                    "Above Balanced (10) is billed even inside the 200 GB allowance."
                )
        for v in block.list_volumes(availability_domain=ad.name, compartment_id=tenancy).data:
            if v.lifecycle_state != "AVAILABLE":
                continue
            total_gb += int(v.size_in_gbs or 0)
            volume_count += 1
            findings["volumes"].append({
                "name": v.display_name, "type": "block", "sizeGb": v.size_in_gbs,
                "vpus": v.vpus_per_gb,
            })
            if (v.vpus_per_gb or 0) > 10:
                problems.append(
                    f"VOLUME PERFORMANCE: {v.display_name} is at {v.vpus_per_gb} VPU/GB. "
                    "Above Balanced (10) is billed even inside the 200 GB allowance."
                )

    if total_gb > MAX_BLOCK_GB:
        problems.append(f"STORAGE OVER CEILING: {total_gb} GB, limit is {MAX_BLOCK_GB}.")
    # One boot volume per instance, plus the 2 block volumes the allowance
    # covers. The old tolerance only alarmed at 5+, so three or four volumes
    # passed silently against a declared ceiling of two -- slack that the
    # trial covered by refusing to provision and Pay As You Go simply bills.
    max_volumes = MAX_BLOCK_VOLUMES + len(instances)
    if volume_count > max_volumes:
        problems.append(
            f"UNEXPECTED VOLUME COUNT: {volume_count} volumes for {len(instances)} "
            f"instance(s); expected at most {max_volumes}. Detached volumes bill."
        )

    # --- What Oracle says it has actually charged ---------------------------
    #
    # Every other check in this file infers billability from the resource
    # list, which means it can only catch what it already believes is
    # chargeable -- and one of those beliefs was wrong for a day (a NAT
    # gateway was recorded here as $33/month; OCI has no such SKU). A budget
    # reads the real number and holds no beliefs at all, so it is the one
    # check that cannot be fooled by a mistake in this file.
    #
    # It is also the only guard that survives a resource this audit does not
    # enumerate, in a region or service nobody thought of.
    try:
        budgets = oci.budget.BudgetClient(cfg).list_budgets(
            compartment_id=tenancy, target_type="ALL"
        ).data
        live = [b for b in budgets if b.lifecycle_state == "ACTIVE"]
        findings["budgets"] = len(live)
        findings["actualSpend"] = max(
            (float(b.actual_spend) for b in live if b.actual_spend is not None), default=None
        )
        if not live:
            problems.append(
                "NO BUDGET ALERT. On Pay As You Go nothing refuses a billable request, "
                "so a spend alarm is the only guard that does not depend on this file "
                "guessing Oracle's price list correctly. "
                "Create one: python deploy/oracle/budget.py --email you@example.com"
            )
        elif findings["actualSpend"]:
            problems.append(
                f"MONEY HAS BEEN SPENT: ${findings['actualSpend']:.2f} charged this period. "
                "This tenancy is supposed to cost nothing."
            )
    except Exception:  # noqa: BLE001
        findings["budgets"] = None
        findings["actualSpend"] = None

    # --- Other subscribed regions ------------------------------------------
    #
    # The 200 GB allowance is HOME REGION ONLY: "volumes created outside of
    # the home region incur regular block volume costs", from the first GB.
    # Everything above this point inspects one region, so a volume in a
    # second subscribed region is invisible to it -- free on the trial
    # because provisioning there was refused, billable now.
    try:
        subs = identity.list_region_subscriptions(tenancy).data
        home = [r.region_name for r in subs if r.is_home_region]
        others = [r.region_name for r in subs if not r.is_home_region]
        findings["homeRegion"] = home[0] if home else None
        findings["otherRegions"] = others
        if others:
            problems.append(
                f"SUBSCRIBED TO {len(others)} NON-HOME REGION(S): {', '.join(others)}. "
                "This audit only inspects "
                f"{cfg['region']}; storage outside the home region bills from the first GB."
            )
    except Exception:  # noqa: BLE001
        findings["otherRegions"] = None

    # --- What Pay As You Go unlocks ----------------------------------------
    #
    # On the trial, anything past the free allowance was REFUSED or reclaimed;
    # the account could not really overspend. On Pay As You Go it is simply
    # billed, so the surfaces below went from impossible to merely
    # unattended. None of them is compute, none is caught by an OCPU ceiling,
    # and every one of them is a standing monthly charge rather than a
    # one-off.
    #
    # CORRECTION, and it was mine. This block shipped claiming a NAT gateway
    # is "about $33 a month forever" and the largest standing charge here.
    # That is AWS's price. OCI publishes NO SKU for NAT, service or internet
    # gateways, and states there is no charge for data movement within a
    # region -- likewise no SKU for public IPs, reserved or ephemeral. The
    # sweeps below stay, because a gateway or reserved IP appearing in this
    # tenancy is still drift worth seeing, but they are drift detection and
    # not the bill guard I said they were. The real standing charges are
    # further down: capacity reservations, backups, out-of-region volumes.
    net = oci.core.VirtualNetworkClient(cfg)
    billable: list[str] = []

    def sweep(label: str, fn, is_free=lambda r: False):
        """Count live resources of a kind, minus any that are genuinely free."""
        try:
            rows = [
                r for r in fn()
                if getattr(r, "lifecycle_state", "AVAILABLE") not in ("TERMINATED", "TERMINATING", "DELETED", "DELETING")
            ]
        except Exception:  # noqa: BLE001 -- service unreachable is not a finding
            findings[label] = None
            return
        paid = [r for r in rows if not is_free(r)]
        findings[label] = len(rows)
        if paid:
            names = ", ".join(getattr(r, "display_name", "?") or "?" for r in paid[:3])
            billable.append(f"{len(paid)} {label} ({names})")

    # Every VCN in one sweep, not one sweep per VCN -- the per-VCN loop this
    # replaced overwrote its own count each pass, so with two VCNs only the
    # last one's gateways were ever reported. Silently, and in the single
    # check with the largest standing charge behind it.
    vcns = [v.id for v in net.list_vcns(compartment_id=tenancy).data]
    sweep("natGateways", lambda: [
        g for vid in vcns
        for g in net.list_nat_gateways(compartment_id=tenancy, vcn_id=vid).data
    ])
    # A reserved IP outlives whatever it was attached to, which is how it
    # gets forgotten -- worth surfacing as drift even though, contrary to
    # what this file used to say, OCI lists no charge for it.
    sweep("reservedPublicIps",
          lambda: net.list_public_ips(scope="REGION", compartment_id=tenancy).data,
          is_free=lambda r: getattr(r, "lifetime", "") != "RESERVED")
    sweep("loadBalancers",
          lambda: oci.load_balancer.LoadBalancerClient(cfg).list_load_balancers(compartment_id=tenancy).data)
    sweep("fileSystems",
          lambda: oci.file_storage.FileStorageClient(cfg).list_file_systems(
              compartment_id=tenancy, availability_domain=ads[0].name).data)
    # A vault bills per key version per month whether or not anything uses it,
    # and deleting one takes a mandatory waiting period.
    sweep("vaults",
          lambda: oci.key_management.KmsVaultClient(cfg).list_vaults(compartment_id=tenancy).data)

    if billable:
        problems.append(
            "UNEXPECTED NETWORK RESOURCES: " + "; ".join(billable) + ". "
            "Not necessarily billable, but nothing in this project creates "
            "them -- confirm what they are for."
        )

    # ---- What ACTUALLY bills on Pay As You Go ------------------------------
    #
    # Researched against Oracle's own docs and price list rather than
    # assumed. Each of these is free-tier-shaped enough to look safe and is
    # charged the moment it crosses a line the resource inventory above
    # cannot see.
    charges: list[str] = []

    # Capacity reservations bill from CREATION at ~85% of on-demand while
    # idle, 100% when used, with no minimum commitment -- and they are
    # unavailable on free tier, so they only became possible at conversion.
    # This is the single most expensive mistake available in this tenancy,
    # and it is exactly what somebody reaches for when Singapore says "out of
    # host capacity" for the tenth time.
    try:
        res = oci.core.ComputeClient(cfg).list_compute_capacity_reservations(
            compartment_id=tenancy
        ).data
        live_res = [r for r in res if r.lifecycle_state not in ("DELETED", "DELETING")]
        findings["capacityReservations"] = len(live_res)
        if live_res:
            charges.append(
                f"{len(live_res)} compute capacity reservation(s) — billed from creation "
                "at ~85% of on-demand even while unused, NOT Always Free"
            )
    except Exception:  # noqa: BLE001
        findings["capacityReservations"] = None

    # Only 5 volume backups are free. On the trial the sixth failed; on Pay
    # As You Go it succeeds and bills, and a Bronze/Silver/Gold policy
    # accumulates them on a schedule nobody is watching.
    try:
        backups = block.list_boot_volume_backups(compartment_id=tenancy).data
        backups += block.list_volume_backups(compartment_id=tenancy).data
        live_backups = [b for b in backups if b.lifecycle_state == "AVAILABLE"]
        findings["volumeBackups"] = len(live_backups)
        if len(live_backups) > 5:
            charges.append(f"{len(live_backups)} volume backups — only the first 5 are free")
    except Exception:  # noqa: BLE001
        findings["volumeBackups"] = None

    # Object Storage: 20 GB COMBINED on the free tier becomes 10/10/10 GB PER
    # TIER at conversion, so Standard holdings over 10 GB start billing.
    try:
        os_client = oci.object_storage.ObjectStorageClient(cfg)
        ns = os_client.get_namespace().data
        buckets = os_client.list_buckets(namespace_name=ns, compartment_id=tenancy).data
        findings["buckets"] = len(buckets)
        if buckets:
            charges.append(
                f"{len(buckets)} object storage bucket(s) — free allowance is 10 GB per "
                "tier after conversion; check size if these are not empty"
            )
    except Exception:  # noqa: BLE001
        findings["buckets"] = None

    if charges:
        problems.append("BILLABLE ON PAY AS YOU GO: " + "; ".join(charges) + ".")

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
        # Printed even when every count is zero. A check that reports nothing
        # is indistinguishable from a check that never ran -- which is how
        # this file came to be trusted while enforcing the wrong ceiling.
        vpus = sorted({v.get("vpus") for v in findings["volumes"] if v.get("vpus") is not None})
        print("  volume perf      :", ", ".join(f"{v} VPU/GB" for v in vpus) or "n/a",
              "(10 = Balanced, the free default; above bills)")
        print("  regions          :",
              f"home {findings.get('homeRegion') or '?'}",
              ("+ " + ", ".join(findings["otherRegions"])) if findings.get("otherRegions") else "(no others)")
        print("  drift sweep      :", ", ".join(
            f"{k} {'?' if findings.get(k) is None else findings.get(k)}"
            for k in ("natGateways", "reservedPublicIps", "loadBalancers", "fileSystems", "vaults")
        ))
        spend = findings.get("actualSpend")
        print("  budget alerts    :",
              f"{findings.get('budgets') if findings.get('budgets') is not None else '?'} active",
              f"— charged so far ${spend:.2f}" if spend is not None else "— charged so far $0.00")
        print("  billable sweep   :", ", ".join(
            f"{k} {'?' if findings.get(k) is None else findings.get(k)}"
            for k in ("capacityReservations", "volumeBackups", "buckets")
        ))
        print()
        if problems:
            print("WITHIN ALWAYS FREE: NO")
            for p in problems:
                print(f"  ! {p}")
        else:
            print("WITHIN ALWAYS FREE: yes — nothing found in this tenancy can generate a bill.")

    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
