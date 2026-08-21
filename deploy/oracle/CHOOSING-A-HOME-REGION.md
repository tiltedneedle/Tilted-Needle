# Choosing a home region for a new Oracle tenancy

**This is the only decision that can change our A1 problem, and it is made
once.** Home region is selected at signup step 2 and — Oracle's words —
*"You can't change this after signing up."* Always Free compute is
home-region-only (*"You must create the Always Free compute instances in your
home region"*), so this choice permanently determines whether an account can
ever hold a free Ampere A1 instance.

Written 2026-08-21, after two of our tenancies came up empty.

## The one structural fact that matters

Capacity is a pool per availability domain. **Only five commercial regions
have three availability domains.** Every other region has exactly one.

| 3 availability domains | 1 availability domain |
|---|---|
| `eu-frankfurt-1`, `uk-london-1`, `us-ashburn-1`, `us-chicago-1`, `us-phoenix-1` | everything else |

Both regions we have measured as dead — `ap-singapore-1` and
`me-abudhabi-1` — are single-AD. One pool, and when it is empty there is
nowhere else to look. A three-AD region gives three independent pools, and
Oracle's own out-of-capacity guidance is to leave the fault domain unset so
the system can place you across them.

This is the input worth weighting most, because unlike a forum post it does
not go stale.

## The ranking

**Start with `us-phoenix-1`.**

Three availability domains, and it belongs to the group a 2026 write-up
singles out: *"In the US, Ashburn, Chicago, and Phoenix have extra resources
compared to others."* What separates it from the other two is demand rather
than supply — Ashburn is the default every guide names, so it absorbs most of
the free-tier farming, while Chicago has a first-hand 2026 report of scripts
running *three months* without success.

Then, in order:

1. **`uk-london-1`** — three ADs, and conspicuously absent from every
   "recommended region" list, which is exactly the arbitrage: same structural
   supply, far less competition. Against it: no evidence in either direction,
   and it is a smaller region than the US pair.
2. **`us-ashburn-1`** — the largest region with the most hardware. Against it:
   the most contested by a wide margin, and *"high-demand regions like US East
   show 'Out of host capacity'"*.
3. **`eu-frankfurt-1`** — three ADs and a major European region. Against it:
   heavily farmed, and see the warning below.

## Avoid

- **`ap-chuncheon-1`** — excluded from Always Free A1 by *policy*, not
  capacity. It can never work.
- **`us-chicago-1`** — three ADs, but the only first-hand 2026 datapoint we
  found is three months of scripted attempts with nothing to show.
- **Any single-AD region**, which is everything not in the table above. That
  includes Singapore, Abu Dhabi, Mumbai, Dubai and Tokyo. We have measured two
  of them empty across every shape and size.

## A claim to distrust, and why

A widely-repeated line says *"Frankfurt and Singapore typically provision
within minutes."* We measured `ap-singapore-1` directly on 2026-08-20:
`OUT_OF_HOST_CAPACITY` at 1/2, 1/4, 1/6, 2/12 and 4/24, across all three fault
domains, with E2.1.Micro out as well. Half that claim is demonstrably false,
which is reason enough to discount the other half.

The same applies to *"Pay As You Go gets you capacity priority."* Our
Singapore tenancy **is** Pay As You Go and is out. That experiment has already
been run here.

## First thirty minutes of a new account

1. **Ask before launching.** `python deploy/oracle/watch_regions.py` — the
   capacity report is free and sits outside the launch rate limit, so it
   answers the question without spending an attempt.
2. **Take the smallest shape that exists.** A1.Flex resizes in place
   (UpdateInstance plus a reboot), so 1 OCPU / 2 GB now beats 2 OCPU / 12 GB
   never. Our ladder already tries 1/2 and 1/4 before the sizes we actually
   want.
3. **Leave the fault domain unset**, per Oracle's own guidance — naming one
   samples one pool, leaving it unset samples all three. This is the entire
   reason a three-AD region is worth choosing.
4. **Create the budget alarm immediately**:
   `python deploy/oracle/budget.py --profile <new> --email …`. A new tenancy
   starts as a trial, but trials convert, and after that nothing refuses a
   billable request.
5. **Audit before and after**: `python deploy/oracle/audit.py`.

## Honest odds

No region can be *confirmed* to have capacity right now — capacity in a region
we are not subscribed to cannot even be queried (401), so nobody can check
before committing. Every community success report we found predates the
2026-06-15 halving by about three months, and that halving changed the shape
of demand.

So this is a bet on structure, not a verified answer: three pools instead of
one, in a region fewer people are farming. That is the best available
reasoning, and it is still a bet.
