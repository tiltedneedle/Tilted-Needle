# PRD — Completion & Autonomy (v2.0)

**Rewritten 2026-08-11.** v1.0 was written a day earlier and the work it
described as missing has largely happened since; keeping it would mean the
status document contradicting the database. As before: every figure here was
measured immediately before writing, and anything unverified says so.

**The one-line status:** the software is finished and verified across eight
audit dimensions; the pipeline runs itself; the single remaining gap is a
transcript host for *new* videos, which is blocked on Oracle inventory that
has been measured absent — not on design, code, or configuration.

---

## 1. Measured state (2026-08-11)

### 1.1 Corpus

| | Posts | `posted_at_ts` | Transcripts | Comments |
|---|---|---|---|---|
| YouTube | 12 | 12/12 | 11 | ✅ |
| TikTok | 78 | 78/78 | 51 | none exposed |
| Instagram | 145 | 145/145 | n/a — no captions exist | ✅ |
| **Total** | **235** | **235/235 — 100%** | **63** · 331,969 chars | **1,000** |

- Descriptions: **192/235** (the remainder are posts whose platforms expose no
  caption/description text; Instagram no-caption cases are recorded in
  `ingest_jobs` so no run ever pays to rediscover them).
- **Transcripts: 0 open.** Of the 90 items that *can* have one (YouTube +
  TikTok), 63 are stored and all 27 remainders carry a recorded reason. 100%
  accounted for — the difference between a finished backfill and an abandoned
  one, invisible in a coverage percentage.
- **The AI layer has run**: 4 `comment_themes` analyses stored, quota-paced.

### 1.2 Autonomy

| Piece | Cadence | Host | State |
|---|---|---|---|
| Metrics sync + discovery | daily 06:00 | Vercel cron | ✅ live |
| Pipeline (comments, analyse, weekly read) | every 6 h | GitHub Actions | ✅ live, secrets configured, runs green |
| Oracle capacity hunt | every 30 min | GitHub Actions | ✅ live, self-deploys on success |
| Transcripts for NEW videos | on demand | **none** | ⛔ blocked on Oracle inventory |

The kind filter is enforced **in the claim** (`claim_ingest_jobs(p_kinds)`), so
the Actions runner can never lease a transcript job it cannot perform. That
this needed saying is §3.1.

### 1.3 Audit — eight of eight dimensions verified

| Dimension | Method | Result |
|---|---|---|
| RLS tenancy | live suite | 120/120 |
| Data integrity | independent recomputation, live | 13/13 |
| UI correctness | authenticated render probe | 18/18 pages |
| Security | built client bundle + tracked-files scan | clean |
| Performance | direct pass | 1 defect found → fixed |
| Error handling | adversarially-verified subagents | 2 defects found → fixed |
| Dead code | direct pass | clean (2 candidates, both disproved) |
| UI polish | direct pass | clean |

A deeper subagent re-run of the dimensions that originally hit session limits
is in flight; its confirmed findings get fixed like the previous ones.

---

## 2. What remains, and who owns it

| Item | Blocker | Owner |
|---|---|---|
| Transcript host for new videos | Oracle Always Free capacity: measured absent across 3 fault domains × 3 sizes; datacenter IPs proven refused across 7 strategies | **Oracle inventory** (hunt is autonomous; likeliest window ~Aug 18 when over-limit instances are reclaimed) |
| Remaining Instagram enrichment | ~117 Apify credits; 25 were authorised and exactly 25 spent | **User** — spend decision |
| Client analytics import (CTR / retention) | needs a client to send a Studio export | **User / client relations** |

Nothing else is open. Existing transcripts are safe in the database and every
downstream feature (search, hooks, AI) works on them regardless of the host
question, which affects **new** videos only.

---

## 3. Defects found and fixed this session — and the lesson

Six, all silent, all confirmed against live systems before and after the fix:

1. **`p_kinds` failed open** — the worker parsed `--kinds`, logged it, never
   sent it. The scheduled runner could claim transcript jobs, fail them from a
   datacenter IP, and settle them terminally with a *false* "no caption
   tracks" verdict. One video was condemned; requeued, it returned 796
   segments.
2. **Vision payload in `last_error`** — a column the worker overwrites on
   every retry. One 429 would have destroyed the path and orphaned the
   screenshot. `ingest_jobs.payload` now exists.
3. **TikTok posts arrived with no timestamp** — `posted_at` is a date column,
   so the hour was destroyed on write, permanently. The snowflake decode now
   runs in the provider at discovery.
4. **A migration recorded itself as applied while its DDL never ran** — the
   push died between the ledger insert and the ALTER. "Applying…" without
   "Finished" means the record may exist without the change.
5. **Channel dashboard silently capped at 1000 posts** — PostgREST's unpaged
   limit; correct-looking until the library grows, then quietly wrong.
6. **Instagram backfill was a credit-burning loop** — posts with no caption
   stayed eligible forever; every run paid to rediscover the same silence.
   No-caption verdicts are now settled in `ingest_jobs`.

**§3.1 The lesson, earned three separate times:** a script that prints success
is not evidence. Three scripted edits this session reported "wired" while
their patterns silently failed to match. Every fix above was verified against
the artifact — the file, the RPC, the built bundle, the live row — never
against the message that claimed it.

---

## 4. Standing constraints (unchanged, re-verified)

1. **Oracle: Always Free only, forever.** The ceiling is **2 OCPU / 12 GB**
   since Oracle halved it on 2026-06-15 *without announcement* — the old 4/24
   figure was enforced here for weeks and would have provisioned a billable
   instance had capacity ever appeared. `provision.py` refuses above the
   ceiling with exit 2, verified on both code paths.
2. No OAuth, ever — enforced by schema constraint, not convention.
3. Views are never summed across platforms; verified live by the
   display-calc suite.
4. The worker has zero inbound ports; the job queue is its API; the yt-dlp
   box binds loopback by default.
5. The repo is public: no env file tracked, no credential literals, service
   key absent from every client chunk — all verified against the built
   artifact.
6. Dubai (UTC+4) is the business timezone.

---

## 5. If Oracle never yields

The decision is the user's, recorded here with the trade-offs:

- **Wait** — costs nothing; the hunt self-deploys; new videos queue harmlessly
  (`transcript:pending` accumulating is the queue accurately describing work
  awaiting a host, not a fault).
- **Any other always-free VPS** with a residential-adjacent IP — the
  provisioning script and cloud-init are host-agnostic beyond the OCI calls;
  the box + worker install is `systemd` + venv + two secrets.
- **A machine the user keeps running** — a scheduled task draining
  `--kinds=transcript` hourly closes the gap with zero new infrastructure.

What is *not* acceptable under the standing constraints: paid shapes, paid
proxies as a default path, or any owner-credential route.
