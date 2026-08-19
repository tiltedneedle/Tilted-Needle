"""
Ask Oracle whether a shape fits, without trying to launch it.

CreateComputeCapacityReport answers "is there room for this shape, this size,
in this AD (optionally this fault domain)?" It creates nothing, costs nothing,
and -- the part that matters -- does not spend the launch_instance rate
budget.

WHY THIS REPLACES LAUNCH-ATTEMPT PROBING

Every capacity question in this project used to be asked by attempting a real
launch, because that was the only way to get a true answer. Oracle rate-limits
launches to roughly one genuine reply per burst, so a nine-combination sweep
returned one fact and eight "Too many requests" -- the sweep converted real
checks into throttles, and probe_capacity.py's docstring says exactly that.

Measured against the live tenancy on 2026-08-19: six combinations (three sizes
x three fault domains plus the unset case) answered in a single burst, all
OUT_OF_HOST_CAPACITY, no throttling. The same six questions asked by launching
would have taken hours and mostly returned 429s.

So the pattern inverts. Poll the report as often as is useful; spend a launch
attempt only when the report says AVAILABLE. That is fewer launches, faster
landing, and no lottery.

WHAT IT DOES NOT DO

It is not a reservation. AVAILABLE means "there was room when asked", and
capacity in a single-AD region is taken within seconds, so a launch can still
fail after a positive report -- the launch remains the source of truth. It
also cannot tell you whether YOUR tenancy may have the shape: the Always Free
ceiling is enforced by provision.py, never inferred from here.
"""
import oci

A1_SHAPE = "VM.Standard.A1.Flex"


def shape_report(compute, tenancy: str, ad: str, ocpus: float, memory_gb: float,
                 fault_domain: str | None = None, shape: str = A1_SHAPE) -> str:
    """AVAILABLE / OUT_OF_HOST_CAPACITY / HARDWARE_NOT_SUPPORTED, or an error tag."""
    cfg_kwargs = {"fault_domain": fault_domain} if fault_domain else {}
    # A fixed shape (the micro) takes no shape config; a flex shape requires one.
    shape_config = (
        oci.core.models.CapacityReportInstanceShapeConfig(
            ocpus=float(ocpus), memory_in_gbs=float(memory_gb)
        )
        if ocpus
        else None
    )
    availability = oci.core.models.CreateCapacityReportShapeAvailabilityDetails(
        instance_shape=shape,
        **({"instance_shape_config": shape_config} if shape_config else {}),
        **cfg_kwargs,
    )
    try:
        resp = compute.create_compute_capacity_report(
            oci.core.models.CreateComputeCapacityReportDetails(
                compartment_id=tenancy,
                availability_domain=ad,
                shape_availabilities=[availability],
            )
        ).data
        return resp.shape_availabilities[0].availability_status or "UNKNOWN"
    except oci.exceptions.ServiceError as e:
        # Reported, never raised: a capacity probe that dies takes a watcher
        # with it, and "I could not ask" is a different fact from "no room".
        return f"ERROR({e.status})"


def any_capacity(compute, tenancy: str, ad: str, sizes, fault_domains=(None,)) -> tuple[bool, list[str]]:
    """
    True if ANY (size, fault domain) combination reports room.

    Fault domain defaults to unset, which is Oracle's own out-of-capacity
    guidance -- letting the system place the instance samples all three
    domains, where naming one samples exactly that one.
    """
    lines, found = [], False
    for ocpus, mem in sizes:
        for fd in fault_domains:
            status = shape_report(compute, tenancy, ad, ocpus, mem, fd)
            tag = f"{ocpus:g}/{mem:g}" + (f" {fd}" if fd else "")
            lines.append(f"{tag}={status}")
            if status == "AVAILABLE":
                found = True
    return found, lines
