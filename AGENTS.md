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
