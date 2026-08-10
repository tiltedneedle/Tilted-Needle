"""
Provision the Tilted Needle ingest worker on Oracle Always Free
(PRD-video-intelligence §15).

Idempotent: every resource is looked up by name first, so re-running adopts
what exists rather than creating a second copy. That is what makes the
instance disposable -- if Oracle reclaims it, this script rebuilds it.

    python deploy/oracle/provision.py --plan     # show what would happen
    python deploy/oracle/provision.py            # create/adopt everything

Requires the `oci` Python SDK and a working ~/.oci/config. The CLI is NOT
required (and does not install on Windows without long-path support, §14.11).

THE ALWAYS FREE CEILING IS ENFORCED HERE, not left to the operator. The
console will happily offer 41 A1 cores because trial quota is still in
effect; anything above 4 OCPU / 24 GB gets reclaimed or billed when the trial
converts (§14.5). This script refuses to exceed it.
"""
import argparse
import random
import time
import sys

import oci

# --- Always Free ceilings. Do not raise these. ------------------------------
MAX_A1_OCPUS = 4
MAX_A1_MEMORY_GB = 24

NAME = "tn-worker"
VCN_CIDR = "10.0.0.0/16"
SUBNET_CIDR = "10.0.0.0/24"

A1_SHAPE = "VM.Standard.A1.Flex"
MICRO_SHAPE = "VM.Standard.E2.1.Micro"


def log(msg: str) -> None:
    print(f"  {msg}", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", action="store_true", help="show actions without making changes")
    ap.add_argument("--ssh-key", required=False, help="path to the PUBLIC key to authorise")
    ap.add_argument("--ocpus", type=int, default=MAX_A1_OCPUS)
    ap.add_argument("--memory", type=int, default=MAX_A1_MEMORY_GB)
    ap.add_argument(
        "--watch",
        action="store_true",
        help="keep trying until capacity appears, then launch and exit",
    )
    ap.add_argument(
        "--watch-hours", type=float, default=24.0,
        help="give up after this long (default 24)",
    )
    args = ap.parse_args()

    # Capacity in a single-AD region comes and goes without warning, and the
    # only way to catch it is to be asking when it does. Watch mode turns
    # "check back later" -- which is a person's job -- into the script's job.
    #
    # Paced deliberately: Oracle rate-limits repeated launch attempts (it
    # answered "Too many requests" after a handful of manual retries), and a
    # tight loop would get the account throttled rather than served. Jittered
    # so several waiting scripts never sync up.
    if args.watch:
        deadline = time.time() + args.watch_hours * 3600
        attempt = 0
        throttled_run = 0
        asked = 0        # attempts that got a real capacity answer
        throttled = 0    # attempts Oracle refused before answering

        while time.time() < deadline:
            attempt += 1
            log(f"--- attempt {attempt} ---")
            outcome = "error"
            try:
                rc, outcome = launch_once(args, report=True)
                if rc == 0:
                    log(f"launched after {attempt} attempts "
                        f"({asked} real capacity checks, {throttled} throttled)")
                    return 0
            except Exception as e:  # noqa: BLE001 -- a transient API error must not end the watch
                log(f"attempt failed: {type(e).__name__}: {str(e)[:120]}")

            # ADAPTIVE PACING, and the reason it exists: a 12-hour run at a
            # flat 5-15 minutes made 147 attempts, but only 61 of them got a
            # real answer. The rest came back "Too many requests for the user"
            # -- Oracle throttling the account, which means asking MORE often
            # actively reduces the number of genuine capacity checks. Backing
            # off hard when throttled buys more real lottery tickets, not
            # fewer.
            if outcome == "throttled":
                throttled += 1
                throttled_run += 1
                base = min(1800 * (2 ** (throttled_run - 1)), 7200)  # 30m -> 2h cap
                wait = base * (0.75 + random.random() * 0.5)
                log(f"THROTTLED by Oracle ({throttled_run} in a row); backing off")
            else:
                if outcome == "no-capacity":
                    asked += 1
                throttled_run = 0
                wait = 600 + random.random() * 600  # 10-20 min

            remaining = deadline - time.time()
            if remaining <= 0:
                break
            log(f"next attempt in {wait / 60:.1f} min "
                f"({remaining / 3600:.1f}h left; {asked} real checks so far)")
            time.sleep(min(wait, remaining))

        log(f"watch window expired: {attempt} attempts, {asked} real capacity "
            f"checks, {throttled} throttled")
        return 1

    return launch_once(args)


def launch_once(args, report: bool = False):
    """
    Returns an exit code, or (code, outcome) when report=True.

    outcome is one of:
      "launched"    -- an instance is running
      "no-capacity" -- Oracle answered, and there is none
      "throttled"   -- Oracle refused to answer; this attempt asked nothing
      "error"       -- anything else

    The distinction matters: a throttled attempt is not evidence about
    capacity, and treating it as one makes the watcher retry faster
    exactly when it should slow down.
    """
    def out(code, outcome):
        return (code, outcome) if report else code


    if args.ocpus > MAX_A1_OCPUS or args.memory > MAX_A1_MEMORY_GB:
        print(
            f"REFUSED: {args.ocpus} OCPU / {args.memory} GB exceeds the Always Free "
            f"ceiling of {MAX_A1_OCPUS} OCPU / {MAX_A1_MEMORY_GB} GB.\n"
            "The console offers more because trial quota is still active; anything "
            "above the ceiling is reclaimed or billed at conversion (PRD §14.5).",
            file=sys.stderr,
        )
        return out(2, "error")

    cfg = oci.config.from_file()
    oci.config.validate_config(cfg)
    tenancy = cfg["tenancy"]

    identity = oci.identity.IdentityClient(cfg)
    net = oci.core.VirtualNetworkClient(cfg)
    compute = oci.core.ComputeClient(cfg)

    ad = identity.list_availability_domains(tenancy).data[0].name
    log(f"region={cfg['region']}  availability domain={ad}")
    # Singapore has exactly one AD, so there is no second one to retry in when
    # capacity runs out (§14.3). That is why the micro fallback exists below.

    plan = args.plan

    # --- VCN ---------------------------------------------------------------
    vcn = next((v for v in net.list_vcns(tenancy).data
                if v.display_name == NAME and v.lifecycle_state == "AVAILABLE"), None)
    if vcn:
        log(f"VCN exists: {vcn.id}")
    elif plan:
        log(f"WOULD create VCN {NAME} ({VCN_CIDR})")
    else:
        vcn = net.create_vcn(oci.core.models.CreateVcnDetails(
            cidr_block=VCN_CIDR, compartment_id=tenancy, display_name=NAME,
            dns_label="tnworker",
        )).data
        oci.wait_until(net, net.get_vcn(vcn.id), "lifecycle_state", "AVAILABLE")
        log(f"VCN created: {vcn.id}")

    if plan and not vcn:
        log("WOULD create: internet gateway, route table, subnet, instance")
        log(f"WOULD launch {A1_SHAPE} at {args.ocpus} OCPU / {args.memory} GB "
            f"(falling back to {MICRO_SHAPE} if capacity is unavailable)")
        return out(0, "launched")

    # --- Internet gateway + default route ----------------------------------
    ig = next((g for g in net.list_internet_gateways(tenancy, vcn_id=vcn.id).data
               if g.display_name == NAME), None)
    if not ig:
        if plan:
            log("WOULD create internet gateway")
        else:
            ig = net.create_internet_gateway(oci.core.models.CreateInternetGatewayDetails(
                compartment_id=tenancy, vcn_id=vcn.id, is_enabled=True, display_name=NAME,
            )).data
            log(f"internet gateway created: {ig.id}")
    else:
        log(f"internet gateway exists: {ig.id}")

    if ig and not plan:
        rt = net.get_route_table(vcn.default_route_table_id).data
        if not any(r.network_entity_id == ig.id for r in rt.route_rules):
            net.update_route_table(rt.id, oci.core.models.UpdateRouteTableDetails(
                route_rules=[oci.core.models.RouteRule(
                    destination="0.0.0.0/0",
                    destination_type="CIDR_BLOCK",
                    network_entity_id=ig.id,
                )],
            ))
            log("default route -> internet gateway")

    # --- Subnet ------------------------------------------------------------
    # The default security list is left exactly as Oracle ships it: SSH in,
    # everything out. No ingress rule is ever added, because the worker
    # listens on nothing (§14.9).
    subnet = next((s for s in net.list_subnets(tenancy, vcn_id=vcn.id).data
                   if s.display_name == NAME and s.lifecycle_state == "AVAILABLE"), None)
    if subnet:
        log(f"subnet exists: {subnet.id}")
    elif plan:
        log("WOULD create public subnet")
    else:
        subnet = net.create_subnet(oci.core.models.CreateSubnetDetails(
            compartment_id=tenancy, vcn_id=vcn.id, cidr_block=SUBNET_CIDR,
            display_name=NAME, dns_label="tnworker",
            prohibit_public_ip_on_vnic=False,
        )).data
        oci.wait_until(net, net.get_subnet(subnet.id), "lifecycle_state", "AVAILABLE")
        log(f"subnet created: {subnet.id}")

    # --- Instance ----------------------------------------------------------
    existing = [i for i in compute.list_instances(compartment_id=tenancy).data
                if i.display_name == NAME and i.lifecycle_state in ("RUNNING", "PROVISIONING", "STARTING")]
    if existing:
        i = existing[0]
        log(f"instance already running: {i.id} ({i.shape})")
        _print_ip(net, compute, tenancy, i.id)
        return out(0, "launched")

    if not args.ssh_key:
        print("ERROR: --ssh-key is required to launch (path to a PUBLIC key).", file=sys.stderr)
        return out(2, "error")
    with open(args.ssh_key, "r", encoding="utf-8") as fh:
        pubkey = fh.read().strip()

    with open(__file__.replace("provision.py", "cloud-init.yaml"), "rb") as fh:
        import base64
        user_data = base64.b64encode(fh.read()).decode()

    def image_for(shape: str) -> str:
        imgs = compute.list_images(
            compartment_id=tenancy, operating_system="Canonical Ubuntu",
            shape=shape, sort_by="TIMECREATED", sort_order="DESC",
        ).data
        lts = [i for i in imgs if "24.04" in i.display_name]
        return (lts or imgs)[0].id

    # A1 first, micro as the documented fallback. Quota headroom is not host
    # capacity: only the launch attempt proves it (§14.6).
    attempts = [
        (A1_SHAPE, oci.core.models.LaunchInstanceShapeConfigDetails(
            ocpus=args.ocpus, memory_in_gbs=args.memory)),
        (MICRO_SHAPE, None),
    ]

    throttled_any = False
    for shape, shape_cfg in attempts:
        if plan:
            log(f"WOULD launch {shape}")
            continue
        try:
            details = oci.core.models.LaunchInstanceDetails(
                availability_domain=ad,
                compartment_id=tenancy,
                display_name=NAME,
                shape=shape,
                shape_config=shape_cfg,
                create_vnic_details=oci.core.models.CreateVnicDetails(
                    subnet_id=subnet.id, assign_public_ip=True,
                ),
                source_details=oci.core.models.InstanceSourceViaImageDetails(
                    image_id=image_for(shape),
                ),
                metadata={"ssh_authorized_keys": pubkey, "user_data": user_data},
            )
            inst = compute.launch_instance(details).data
            log(f"launching {shape}: {inst.id}")
            oci.wait_until(compute, compute.get_instance(inst.id),
                           "lifecycle_state", "RUNNING", max_wait_seconds=900)
            log(f"instance RUNNING on {shape}")
            _print_ip(net, compute, tenancy, inst.id)
            return out(0, "launched")
        except oci.exceptions.ServiceError as e:
            msg = str(e.message).lower()
            if "too many requests" in msg or e.status == 429:
                log(f"{shape}: throttled ({e.message})")
                throttled_any = True
                continue
            if e.status == 500 or "capacity" in msg:
                log(f"{shape} unavailable ({e.message}) — trying the next shape")
                continue
            raise

    if not plan:
        print("Could not launch on any Always Free shape. Retry later: capacity "
              "in a single-AD region comes and goes (§14.3, §14.6).", file=sys.stderr)
        return out(1, "throttled" if throttled_any else "no-capacity")
    return out(0, "launched")


def _print_ip(net, compute, tenancy, instance_id) -> None:
    vnics = compute.list_vnic_attachments(compartment_id=tenancy, instance_id=instance_id).data
    for v in vnics:
        ip = net.get_vnic(v.vnic_id).data.public_ip
        if ip:
            log(f"public IP: {ip}")
            log(f"deploy:  scp -r worker package.json ubuntu@{ip}:/tmp/  &&  ssh ubuntu@{ip}")
            return
    log("no public IP assigned yet")


if __name__ == "__main__":
    raise SystemExit(main())
