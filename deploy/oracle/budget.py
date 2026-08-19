"""
The spend alarm. Create it once; it watches forever.

    python deploy/oracle/budget.py --plan
    python deploy/oracle/budget.py --email you@example.com

WHY THIS EXISTS, AND WHY IT IS NOT THE SAME AS audit.py

audit.py reads the tenancy's RESOURCES and reasons about which of them could
bill. That was sufficient while the account was a trial, because the trial
refused to provision anything chargeable -- the resource list and the bill
could not disagree.

Pay As You Go breaks that equivalence. Nothing now refuses; over-allowance
requests simply succeed and are charged. So there are two failure modes the
resource audit structurally cannot catch:

  - Something bills that we did not classify as billable. The audit encodes
    beliefs about Oracle's price list, and one of those beliefs was already
    wrong (it called a NAT gateway $33/month; OCI has no such SKU).
  - Something bills in a region, compartment or service the audit never
    enumerates.

A budget reads the actual charges. It is the only check here that cannot be
fooled by a wrong assumption about pricing, because it does not hold any.

WHAT IT DOES NOT DO -- and this matters more than what it does:

A BUDGET DOES NOT CAP SPENDING. Oracle has no hard stop; there is no setting
anywhere that makes a Pay As You Go account refuse to bill. This sends email
when money is being spent. Acting on that email is the control.

Hence the thresholds: 1% ACTUAL on a $1 budget fires at roughly one cent, so
the first charge of any size is audible rather than the hundredth. The
FORECAST rule fires on a trend before the money is spent, which is the only
warning that arrives early enough to stop something.
"""
import argparse
import sys

import oci

# One dollar, so every alert percentage is a small absolute number. The point
# is never to spend anything; a bigger budget would only make the thresholds
# quieter.
AMOUNT = 1
NAME = "tn-always-free-guard"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--email", help="where alerts go (required unless --plan)")
    ap.add_argument("--plan", action="store_true", help="show what would be created")
    args = ap.parse_args()

    cfg = oci.config.from_file()
    client = oci.budget.BudgetClient(cfg)
    tenancy = cfg["tenancy"]

    existing = [
        x for x in client.list_budgets(compartment_id=tenancy, target_type="ALL").data
        if x.display_name == NAME and x.lifecycle_state == "ACTIVE"
    ]

    rules = [
        {
            "name": "any-spend-at-all",
            "threshold": 1,          # 1% of $1 -- about one cent
            "type": "ACTUAL",
            "message": (
                "Tilted Needle: this tenancy has been charged. It is supposed to run "
                "entirely on Always Free, so any non-zero amount means something "
                "outside the allowance exists. Run: python deploy/oracle/audit.py"
            ),
        },
        {
            "name": "forecast-to-exceed",
            "threshold": 100,        # forecast to reach $1 this month
            "type": "FORECAST",
            "message": (
                "Tilted Needle: this tenancy is FORECAST to spend money this month. "
                "This fires before the charge lands. Run: python deploy/oracle/audit.py"
            ),
        },
    ]

    if args.plan:
        print(f"  budget  : {NAME}  ${AMOUNT}/month  on tenancy root")
        print(f"  existing: {len(existing)}")
        for r in rules:
            print(f"  rule    : {r['name']}  {r['threshold']}% {r['type']}")
        print("\n  plan only — nothing created")
        return 0

    if not args.email:
        print("--email is required (alerts have to go somewhere).", file=sys.stderr)
        return 2

    if existing:
        budget = existing[0]
        print(f"  budget exists: {budget.id}")
    else:
        budget = client.create_budget(
            oci.budget.models.CreateBudgetDetails(
                compartment_id=tenancy,
                target_type="COMPARTMENT",
                targets=[tenancy],          # the root: everything in the tenancy
                amount=AMOUNT,
                reset_period="MONTHLY",
                display_name=NAME,
                description=(
                    "This tenancy must cost nothing. Any charge is a defect. "
                    "See AGENTS.md, Oracle Cloud section."
                ),
            )
        ).data
        print(f"  budget created: {budget.id}")

    have = {r.display_name for r in client.list_alert_rules(budget_id=budget.id).data}
    for r in rules:
        if r["name"] in have:
            print(f"  rule exists: {r['name']}")
            continue
        client.create_alert_rule(
            budget_id=budget.id,
            create_alert_rule_details=oci.budget.models.CreateAlertRuleDetails(
                display_name=r["name"],
                threshold=r["threshold"],
                threshold_type="PERCENTAGE",
                type=r["type"],
                recipients=args.email,
                message=r["message"],
            ),
        )
        print(f"  rule created: {r['name']}  {r['threshold']}% {r['type']}")

    print("\n  NOTE: a budget alerts, it does not cap. Oracle has no hard spend stop.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
