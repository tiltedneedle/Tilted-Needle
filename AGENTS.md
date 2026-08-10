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

**The trap that makes this easy to get wrong.** The console and the limits API
report far more than the ceiling — this tenancy shows **41 A1 OCPUs and 277 GB**
because the 30-day trial quota is still in force. That headroom is not yours.
Anything above the ceiling is reclaimed or **billed** when the trial converts.
Never provision to what the quota says; provision to the table above.

**Rules:**

1. Only create shapes the console labels **"Always Free Eligible"**.
2. Never upgrade to Pay As You Go. Upgrading is what makes ARM capacity
   reliably available — and what makes an unexpected bill possible.
3. Never raise the ceiling constants in `deploy/oracle/provision.py`. The
   script refuses anything above 2 OCPU / 12 GB by design, with exit code 2.
   That refusal is a feature; do not "fix" it.
4. Never provision Autonomous Databases, Load Balancers, or anything else
   "because it is also free" — free tiers change, and the only resources this
   project needs are one compute instance and its boot volume.
5. Before and after any provisioning work, run the audit:

```bash
python deploy/oracle/audit.py
```

It fails loudly if anything in the tenancy sits outside Always Free.

**Capacity is not a reason to break this.** `ap-singapore-1` has a single
availability domain and A1 capacity is frequently exhausted. The answer is
`provision.py --watch`, which waits for capacity — never a paid shape, and
never a bigger one.
<!-- END:oracle-always-free -->
