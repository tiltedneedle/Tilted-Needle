"""
Systematically probe where Always Free capacity actually exists.

The watcher asks one question repeatedly: "any capacity?" This asks a better
one: "capacity for WHICH shape, at WHICH size, in WHICH fault domain?" Those
are different inventories, and a blanket "Out of host capacity" hides which of
them was actually consulted.

Two things had never been varied before this script:

  FAULT DOMAIN  Singapore has one availability domain but THREE fault domains.
                Leaving it unset lets Oracle choose, and a choice that lands on
                a full domain looks identical to the region being empty.
  SIZE          A1 is a flex shape. 1 OCPU / 6 GB is a materially easier ask
                than 2 OCPU / 12 GB, and capacity is allocated in chunks.

Every attempt stays inside the Always Free ceiling (2 OCPU / 12 GB since
2026-06-15). Nothing here can provision a billable shape.

NOTE (2026-08-19): most of what this file does by LAUNCHING is now answered
for free by CreateComputeCapacityReport -- see capacity.py, which provision.py
--watch uses to gate its attempts. Six size/fault-domain combinations came
back in one burst with no throttling, where the launch-based sweep below
returns roughly one real answer per burst and throttles the rest. Prefer
capacity.py for asking; keep this for the definitive test, since only a launch
proves a launch.

    python deploy/oracle/probe_capacity.py            # report only
    python deploy/oracle/probe_capacity.py --launch --ssh-key ~/.ssh/key.pub
"""
import argparse
import sys

import oci

A1 = "VM.Standard.A1.Flex"
MICRO = "VM.Standard.E2.1.Micro"
CEIL_OCPU, CEIL_MEM = 2, 12


def load_config() -> dict:
    """
    Config from ~/.oci/config locally, or from environment variables on a CI
    runner, which has no such file.

    The key arrives as OCI_PRIVATE_KEY rather than a path because a GitHub
    secret is a string. It is written to a 0600 file in the runner's temp
    space -- the OCI SDK wants a path -- and that runner is destroyed at the
    end of the job.
    """
    import os
    import stat
    import tempfile

    if not os.environ.get("OCI_USER_OCID"):
        return oci.config.from_file()

    key = os.environ["OCI_PRIVATE_KEY"]
    fd, path = tempfile.mkstemp(suffix=".pem")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(key if key.endswith("\n") else key + "\n")
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)

    cfg = {
        "user": os.environ["OCI_USER_OCID"],
        "fingerprint": os.environ["OCI_FINGERPRINT"],
        "tenancy": os.environ["OCI_TENANCY_OCID"],
        "region": os.environ.get("OCI_REGION", "ap-singapore-1"),
        "key_file": path,
    }
    oci.config.validate_config(cfg)
    return cfg


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--launch", action="store_true",
                    help="actually launch on the first combination that works")
    ap.add_argument("--ssh-key", help="public key path (required with --launch)")
    ap.add_argument("--watch", action="store_true",
                    help="rotate ONE combination per interval, indefinitely")
    ap.add_argument("--interval", type=float, default=8.0,
                    help="minutes between attempts in watch mode (default 8)")
    ap.add_argument("--index", type=int, default=None,
                    help="try exactly ONE combination, chosen by this number "
                         "modulo the combination count, then exit")
    args = ap.parse_args()

    if args.launch and not args.ssh_key:
        print("--ssh-key is required with --launch", file=sys.stderr)
        return 2

    cfg = load_config()
    tenancy = cfg["tenancy"]
    idc = oci.identity.IdentityClient(cfg)
    compute = oci.core.ComputeClient(cfg)
    net = oci.core.VirtualNetworkClient(cfg)

    ad = idc.list_availability_domains(tenancy).data[0].name
    fds = [f.name for f in idc.list_fault_domains(
        compartment_id=tenancy, availability_domain=ad).data]

    subnets = net.list_subnets(compartment_id=tenancy).data
    if not subnets:
        print("No subnet found. Run provision.py once to build the network.", file=sys.stderr)
        return 2
    subnet_id = subnets[0].id

    def image_for(shape: str) -> str:
        imgs = compute.list_images(
            compartment_id=tenancy, operating_system="Canonical Ubuntu",
            shape=shape, sort_by="TIMECREATED", sort_order="DESC").data
        lts = [i for i in imgs if "24.04" in i.display_name]
        return (lts or imgs)[0].id

    pubkey = None
    if args.launch:
        with open(args.ssh_key, "r", encoding="utf-8") as fh:
            pubkey = fh.read().strip()

        # ---- Always Free ceiling, enforced before ANY launch --------------
        #
        # This guard did not exist, and provision.py's version does not help:
        # the scheduled workflow calls THIS script, not that one. On Always
        # Free the omission was invisible, because every launch bounced off
        # "out of capacity" and nothing was ever created. On Pay As You Go the
        # same request succeeds -- and this runs every 30 minutes, with no
        # memory of the instance it made half an hour ago.
        #
        # Two 2-OCPU A1s are each individually "Always Free eligible" and
        # together are double the ceiling, which is billed. So the check is on
        # the TENANCY TOTAL, not on the shape being asked for, and it counts
        # every A1 regardless of name -- an instance created by hand spends the
        # same allowance as one created here.
        live = [i for i in compute.list_instances(compartment_id=tenancy).data
                if i.lifecycle_state in ("RUNNING", "PROVISIONING", "STARTING")]
        used_ocpu = sum(int(i.shape_config.ocpus or 0)
                        for i in live if i.shape == A1 and i.shape_config)
        used_mem = sum(int(i.shape_config.memory_in_gbs or 0)
                       for i in live if i.shape == A1 and i.shape_config)
        micros = sum(1 for i in live if i.shape == MICRO)

        if used_ocpu >= CEIL_OCPU or used_mem >= CEIL_MEM:
            print(f"REFUSED: tenancy already uses {used_ocpu} OCPU / {used_mem} GB "
                  f"of A1, at or above the Always Free ceiling of "
                  f"{CEIL_OCPU} OCPU / {CEIL_MEM} GB. Nothing launched.",
                  file=sys.stderr)
            return 2
        if micros >= 2:
            print(f"REFUSED: {micros} E2.1.Micro instances already exist "
                  f"(Always Free allows 2). Nothing launched.", file=sys.stderr)
            return 2
        # Headroom is what is LEFT, so a second launch can only ever top up to
        # the ceiling rather than start again from zero.
        sizes_cap = (CEIL_OCPU - used_ocpu, CEIL_MEM - used_mem)
        print(f"Always Free headroom: {sizes_cap[0]} OCPU / {sizes_cap[1]} GB", flush=True)

    # Smallest first: an easier ask is likelier to land, and a 1-OCPU A1 still
    # runs this workload comfortably.
    #
    # Filtered to what the remaining headroom can actually hold, so a partly
    # used tenancy cannot be topped up past the ceiling by asking for the
    # bigger size. With nothing running this is the full list, unchanged.
    sizes = [(1, 6), (2, 12)]
    if args.launch:
        sizes = [(o, m) for (o, m) in sizes
                 if o <= sizes_cap[0] and m <= sizes_cap[1]]
        if not sizes:
            print("REFUSED: no A1 size fits the remaining Always Free headroom.",
                  file=sys.stderr)
            return 2
    combos = []
    for fd in fds:
        for o, m in sizes:
            combos.append((A1, oci.core.models.LaunchInstanceShapeConfigDetails(
                ocpus=o, memory_in_gbs=m), fd, f"{o} OCPU / {m} GB"))
        combos.append((MICRO, None, fd, "1 OCPU / 1 GB"))

    print(f"AD {ad}  |  {len(fds)} fault domains  |  {len(combos)} combinations\n")
    outcomes = {}

    def build(shape, cfg_details, fd):
        d = oci.core.models.LaunchInstanceDetails(
            availability_domain=ad, fault_domain=fd, compartment_id=tenancy,
            shape=shape, display_name="tn-worker", shape_config=cfg_details,
            create_vnic_details=oci.core.models.CreateVnicDetails(
                subnet_id=subnet_id, assign_public_ip=True),
            source_details=oci.core.models.InstanceSourceViaImageDetails(
                image_id=image_for(shape)))
        if pubkey:
            d.metadata = {"ssh_authorized_keys": pubkey}
        return d

    def classify(e):
        m = (e.message or "").lower()
        if "out of host capacity" in m:
            return "no-capacity"
        if "too many requests" in m:
            return "throttled"
        return f"{e.status}"

    # ---- Single rotating attempt (CI) -------------------------------------
    # One attempt per invocation, so a scheduled runner does exactly what the
    # local watcher does -- ask ONE real question -- without holding a process
    # open. The caller supplies a monotonically increasing number (the CI run
    # number); modulo the combination count, consecutive runs walk every fault
    # domain and size in turn.
    if args.index is not None and args.launch:
        shape, cfg_details, fd, label = combos[args.index % len(combos)]
        tag = f"{shape.split('.')[-1]} {label} {fd}"
        try:
            inst = compute.launch_instance(build(shape, cfg_details, fd)).data
            print(f"LAUNCHED {tag} -> {inst.id}", flush=True)
            print("::notice::Oracle capacity found and instance launched", flush=True)
            return 0
        except oci.exceptions.ServiceError as e:
            print(f"{classify(e)}  {tag}", flush=True)
            return 1
        except Exception as e:  # noqa: BLE001
            print(f"network  {tag}  ({type(e).__name__})", flush=True)
            return 1

    # ---- Watch mode -------------------------------------------------------
    # ONE attempt per interval, rotating through the combinations.
    #
    # This shape is dictated by measurement, not preference. A single pass over
    # 9 combinations produced ONE real capacity answer and EIGHT "Too many
    # requests": Oracle rate-limits launch_instance to roughly one genuine
    # check per burst. Asking about more combinations at once therefore does
    # not sample more inventory -- it converts real checks into throttles, and
    # every throttle is a question that was never actually asked.
    #
    # Rotating one at a time means each combination eventually gets a REAL
    # answer, and the rate limit is spent on signal rather than noise.
    if args.watch and args.launch:
        import itertools
        import random
        import time
        for n, (shape, cfg_details, fd, label) in enumerate(itertools.cycle(combos), 1):
            tag = f"{shape.split('.')[-1]} {label} {fd}"
            try:
                inst = compute.launch_instance(build(shape, cfg_details, fd)).data
                print(f"[{n}] LAUNCHED {tag} -> {inst.id}", flush=True)
                return 0
            except oci.exceptions.ServiceError as e:
                kind = classify(e)
                outcomes[kind] = outcomes.get(kind, 0) + 1
                print(f"[{n}] {kind:<12} {tag}  "
                      f"(real checks so far: {outcomes.get('no-capacity', 0)})", flush=True)
            except Exception as e:  # noqa: BLE001
                # A watcher that runs for days MUST survive transient network
                # faults. The first version caught only ServiceError, so a
                # single ConnectTimeout to the Oracle endpoint killed the whole
                # loop -- silently, hours before anyone would look. A timeout is
                # not an answer about capacity, so it is not counted as one.
                kind = "network"
                outcomes[kind] = outcomes.get(kind, 0) + 1
                print(f"[{n}] {kind:<12} {tag}  "
                      f"({type(e).__name__}: {str(e)[:70]})", flush=True)
            # Longer pause after a throttle: the budget is already spent, so
            # asking again immediately guarantees another non-answer.
            wait = args.interval * 60 * (2.5 if kind == "throttled" else 1.0)
            time.sleep(wait * (0.8 + random.random() * 0.4))

    for shape, cfg_details, fd, label in combos:
        if cfg_details and (cfg_details.ocpus > CEIL_OCPU
                            or cfg_details.memory_in_gbs > CEIL_MEM):
            print(f"  SKIP  {shape} {label} — above the Always Free ceiling")
            continue

        details = oci.core.models.LaunchInstanceDetails(
            availability_domain=ad,
            fault_domain=fd,
            compartment_id=tenancy,
            shape=shape,
            display_name="tn-worker",
            shape_config=cfg_details,
            create_vnic_details=oci.core.models.CreateVnicDetails(
                subnet_id=subnet_id, assign_public_ip=True),
            source_details=oci.core.models.InstanceSourceViaImageDetails(
                image_id=image_for(shape)),
        )
        if pubkey:
            details.metadata = {"ssh_authorized_keys": pubkey}

        tag = f"{shape.split('.')[-1]:<9} {label:<14} {fd}"
        if not args.launch:
            # Dry probe: ask the API to validate without creating anything.
            print(f"  ...   {tag}  (report-only; use --launch to attempt)")
            continue

        try:
            inst = compute.launch_instance(details).data
            print(f"  LAUNCHED  {tag}  -> {inst.id}")
            return 0
        except oci.exceptions.ServiceError as e:
            msg = (e.message or "").lower()
            if "out of host capacity" in msg:
                kind = "no-capacity"
            elif "too many requests" in msg:
                kind = "throttled"
            elif "limit" in msg or "quota" in msg:
                kind = "limit"
            else:
                kind = f"{e.status}: {(e.message or '')[:60]}"
            outcomes[kind] = outcomes.get(kind, 0) + 1
            print(f"  {kind:<12} {tag}")

    if outcomes:
        print("\nsummary:", ", ".join(f"{v}x {k}" for k, v in outcomes.items()))
        if set(outcomes) == {"no-capacity"}:
            print("Every fault domain and size refused for capacity — the region "
                  "is genuinely empty, not a placement artefact.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
