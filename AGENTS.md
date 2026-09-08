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
# Oracle Cloud: retired. Do not provision anything there.

This project no longer uses Oracle Cloud, and the provisioning toolkit that
used to live in `deploy/oracle/` has been removed along with the
`oracle-capacity` workflow that hunted for Always Free capacity every thirty
minutes.

**Why it went.** The box was only ever wanted for one thing: the `transcript`
and `transcript_asr` kinds, which run through yt-dlp and are refused from
datacenter ranges. An Oracle instance is a datacenter range, so it could never
actually do the job it was provisioned for -- measured, it completed zero
yt-dlp transcripts in its entire life. Everything else it ran (`comments`,
`analyse`, `describe`, `vision_extract`, `weekly_read`) is IP-agnostic and
already runs in GitHub Actions. Transcription is now Apify's job, which fetches
on the vendor's own infrastructure and therefore needs no host of ours at all.

**The tenancy still exists, and this is the part that matters.** It converted
to Pay As You Go on 2026-08-19 and **cannot be downgraded** -- Oracle offers no
path back. On the old trial, anything past the free allowance was refused. Now
the same request succeeds and is billed, silently, with no hard stop anywhere.
The guards that used to catch that were in `deploy/oracle/`, and they are gone.

So the rule is now simpler and stricter than the ceilings it replaces:

> **Provision nothing in the `tiltedneedletools` tenancy.** Not a compute
> instance, not a volume, not "just to test", not because a shape is labelled
> Always Free. There is no longer anything in this repo that would notice.

The one guard that survives is outside this repo and does not depend on it
guessing Oracle's price list: a budget alarm on the tenancy root
(`tn-always-free-guard`, $1/month) that emails on the first cent charged. **A
budget alerts; it does not cap.**

If Oracle is ever genuinely needed again, recover the deleted tooling from git
history rather than writing it fresh -- it encodes several expensive lessons,
including that the console reports far more headroom than the Always Free
ceiling and that capacity reservations bill from creation whether or not
anything runs in them:

```bash
git show b83d73e:deploy/oracle/audit.py   # last commit that still had it
```
