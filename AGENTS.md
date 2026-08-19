<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:git-push-rules -->
# Git push rules for this machine

This desktop has three GitHub accounts. Auth is SSH-only, via host aliases in `~/.ssh/config`. NEVER use an `https://github.com/...` remote — all HTTPS remotes collide on a single Windows Credential Manager entry and will fail with "Permission denied to \<wrong-account\>" (403) or hang on a password prompt that cannot be answered in a non-interactive shell.

The three aliases, and which account each authenticates as:

| Alias | Authenticates as |
|---|---|
| `github-latech` | `latechssolution-cmyk` |
| `github-izz` | `iZzIbRaHiM` |
| `github-tn` | `tiltedneedle` |

Pick the alias by the **owner in the repo URL**, not by the project name:

```
github.com/latechssolution-cmyk/X  ->  git@github-latech:latechssolution-cmyk/X.git
github.com/iZzIbRaHiM/X            ->  git@github-izz:iZzIbRaHiM/X.git
github.com/tiltedneedle/X          ->  git@github-tn:tiltedneedle/X.git
```

Cloning:

```bash
git clone git@github-latech:latechssolution-cmyk/REPO.git
```

If a push fails, FIRST check the remote:

```bash
git remote -v
```

If it starts with `https://`, that is the bug. Convert it:

```bash
git remote set-url origin git@<alias>:<owner>/<repo>.git
```

Then verify before retrying:

```bash
ssh -T git@<alias>      # must print "Hi <expected-account>!"
```

Commit identity is automatic — do NOT set `user.name`/`user.email` manually. A conditional include in `~/.gitconfig` authors anything under `C:/Users/HP/Downloads/JOB2/` as `tiltedneedle <tiltedneedletools@gmail.com>`, and everything else as `latechssolution-cmyk <latechssolution@gmail.com>`. Setting a local override will silently break this.

Never run `gh auth login`, never modify stored credentials, and never enter a password or token. If auth genuinely fails after the remote is confirmed correct, stop and report it — do not attempt workarounds.
<!-- END:git-push-rules -->

<!-- BEGIN:oracle-always-free -->
# Oracle Cloud: Always Free only. This is a hard rule.

The tenancy `tiltedneedletools` (`ap-singapore-1`) exists to run this project
at **zero cost, permanently**. Nothing may be provisioned that is not Always
Free eligible — not temporarily, not "just to test", not "we'll delete it
after". The whole point of the platform is that the only recurring bill is the
LLM API.

**The ceilings, which are the whole rule:**

| Resource | Always Free ceiling |
|---|---|
| Ampere A1 compute | **2 OCPU and 12 GB RAM in total**, across all A1 instances |
| AMD compute | 2 × `VM.Standard.E2.1.Micro` (1 OCPU / 1 GB each) |
| Block storage | 200 GB total, 2 volumes |
| Outbound transfer | 10 TB / month |

The formal limit is **1,500 OCPU-hours and 9,000 GB-hours per month** — the
2 OCPU / 12 GB above is that run continuously, with about 12 OCPU-hours of
slack in a 31-day month. Two instances overlapping for a day can therefore
exceed the monthly allowance while never breaching the point-in-time shape
check. Halved from 4 OCPU / 24 GB on **2026-06-15**.

**The trap that makes this easy to get wrong.** The console and the limits API
report far more than the ceiling — this tenancy showed **41 A1 OCPUs and
277 GB** under trial quota. That headroom was never yours.

**And the trap changed shape on 2026-08-19, when this tenancy converted to Pay
As You Go.** On the trial, anything past the allowance was refused or
reclaimed: the account could not really overspend. Now the same request
succeeds and is **billed**, silently, with no hard stop. Oracle charges
nothing for Always Free resources on a paid account — but nothing prevents
provisioning past them either. Every guard in `deploy/oracle/` stopped being a
belt-and-braces duplicate of Oracle's own refusal and became the only thing
between this project and an invoice.

**Rules:**

1. Only create shapes the console labels **"Always Free Eligible"**.
2. The account is already Pay As You Go and **cannot be downgraded** — Oracle
   offers no path back. So the old rule ("never upgrade") is spent; the rule
   now is that overage bills silently and only our own guards stop it.
3. Never raise the ceiling constants. They live in **three** files —
   `provision.py`, `audit.py` and `probe_capacity.py` — and that duplication
   has already failed once: the audit sat at 4 OCPU / 24 GB, double the real
   ceiling, while the other two were correct. Change all three or none.
4. Never provision Autonomous Databases, Load Balancers, or anything else
   "because it is also free" — free tiers change, and the only resources this
   project needs are one compute instance and its boot volume.
5. **Never create a compute capacity reservation.** It looks like the
   PAY-AS-YOU-GO-native answer to Singapore's chronic "out of host capacity",
   and it bills from creation at ~85% of on-demand whether or not anything
   runs in it. `audit.py` looks for one.
6. Keep block volumes at **Balanced (10 VPU/GB)**. Performance is billed
   separately from capacity, so a faster volume costs money while still
   sitting inside the 200 GB allowance.
7. Stay in the home region. The 200 GB is home-region-only; a volume in
   another subscribed region bills from the first GB.
8. There is a **budget alarm** on the tenancy root (`tn-always-free-guard`,
   $1/month) that emails on the first cent charged and on any forecast to
   spend. It is the only guard that does not depend on this repo guessing
   Oracle's price list correctly — every other check infers billability from
   the resource list, and one of those inferences was already wrong once.
   Recreate with `python deploy/oracle/budget.py --email …`. **A budget
   alerts; it does not cap.** Oracle offers no hard spend stop anywhere.
9. Before and after any provisioning work, run the audit:

```bash
python deploy/oracle/audit.py
```

It fails loudly if anything in the tenancy sits outside Always Free.

**Capacity is not a reason to break this.** `ap-singapore-1` has a single
availability domain and A1 capacity is frequently exhausted — still true on
Pay As You Go, which buys queue priority, not inventory. Verified 2026-08-19:
every size and every fault domain reported `OUT_OF_HOST_CAPACITY`.

The answer is `provision.py --watch` — never a paid shape, never a bigger one,
never a reservation. It now asks `CreateComputeCapacityReport` first, which
answers the capacity question for free and outside the launch rate limit, and
only spends a launch attempt when the report says there is room.
<!-- END:oracle-always-free -->
