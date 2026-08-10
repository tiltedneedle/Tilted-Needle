# PRD — Completion & Autonomy (v1.0)

**Written 2026-08-10.** Every figure here was measured against the live
database and the live Oracle tenancy immediately before writing. Nothing in
this document is recalled or assumed — where something is unverified it says
so.

**The one-line status:** the machinery is built and correct; the *data* is
half-collected and *nothing runs on a schedule*. The project is not blocked on
design. It is blocked on a host.

---

## 1. What is actually true right now

### 1.1 Corpus (measured)

| | Posts | Transcripts | Comments | `posted_at_ts` | `has_captions` |
|---|---|---|---|---|---|
| YouTube | 11 | **11/11** | **957** | 11/11 | 11/11 |
| TikTok | 78 | **32/78** | 0 (none exposed) | **0/78** | 0/78 |
| Instagram | 145 | n/a (no caption tracks) | **43** | **3/145** | n/a |
| **Total** | **234** | **43** · 285,990 chars | **1,000** | **14/234** | — |

- `ai_analyses`: **0 rows — the AI layer has never run.**
- `post_analytics`: **2 rows**, both manual test entries. No client export imported.
- `video_replay_map`: 0 rows, correctly — retired on evidence (§4.4).
- `ingest_jobs`: 3 rows, all `done`.

### 1.2 Shipped and verified

| Capability | State | Evidence |
|---|---|---|
| OAuth fully removed | ✅ | 10/10 schema checks; `source='oauth'` rejected by DB |
| Always Free ceiling enforced | ✅ | `provision.py` exits 2 above 4 OCPU/24 GB, both code paths |
| Lifecycle (rising/evergreen/spike…) | ✅ | `lib/lifecycle.ts`, read-time — see §4.1 |
| Ingest schema + job queue | ✅ | `ingest_jobs` with leasing, backoff, block cooldown |
| Worker + 6 job handlers | ✅ | `worker/` — transcript, comments, analyse, weeklyRead, visionExtract |
| Transcripts (YouTube + TikTok) | ✅ | via the yt-dlp box; PoToken defeated |
| Comments (YouTube + Instagram) | ✅ | official API + Apify |
| Vision extraction (screenshot→draft→confirm) | ✅ | built, never used in anger |
| Hook analysis | ✅ | built |
| Pipeline health panel | ✅ | `/data` |
| Free enrichment code | ✅ | code correct; **backfill not run** (§2.1) |

### 1.3 Oracle tenancy (measured this session)

Tenancy `tiltedneedletools`, `ap-singapore-1`, **one** availability domain,
zero instances, MFA on. A1 quota shows 41 OCPU / 277 GB — **trial quota, a
trap; Always Free is 4/24** and the script refuses more.

**Capacity: not obtainable.** Two watch runs. The first made 147 attempts in
12 h and only 61 got a real answer — the rest were `Too many requests`, i.e.
Oracle throttling the account, which means retrying faster buys *fewer* real
checks. Pacing is now adaptive (10–20 min normally; 30 min→2 h backoff when
throttled). Current run: still nothing.

---

## 2. What is left

### 2.1 Data gaps — the corpus is half-collected

| Gap | Size | Blocker |
|---|---|---|
| TikTok transcripts | 46 of 78 missing | Pacing only — needs unattended runs |
| TikTok `posted_at_ts` / captions flag | 78 of 78 missing | Backfill never run |
| Instagram `posted_at_ts` | 142 of 145 missing | Backfill never run |
| Instagram comments | ~102 of 145 posts | Apify pacing + budget |
| Descriptions | 221 of 234 missing | Backfill never run |

None of these are hard problems. **All of them are "nothing runs on a
schedule" problems.**

### 2.2 Capability gaps

| Gap | Blocker | Owner |
|---|---|---|
| **Nothing runs autonomously** | No host for the worker | §3 — solvable now |
| AI layer never executed | No LLM API key configured | **User** |
| Client analytics import unused | No client export received | **User** |
| yt-dlp box runs locally only | No host | §3 |
| Oracle instance | No capacity | Watcher running |

### 2.3 Not started

- Corpus analysis / brief generator (needs the AI layer to run at all)
- Weekly client read on a schedule (handler exists; scheduler does not)
- Backfill orchestration across weeks

---

## 3. The autonomy plan — and why it no longer waits for Oracle

**The finding that changes the plan: this repo is PUBLIC, so GitHub Actions
minutes are unlimited and free.** That is a real scheduler, already
authenticated to this repo, at zero cost.

The insight that makes it usable: **the jobs are not equally IP-sensitive.**

| Class | Jobs | Needs a clean IP? | Can run on Actions |
|---|---|---|---|
| **A — safe** | comments (official API), enrichment, AI analysis, weekly read, lifecycle | No | **Yes** |
| **B — fragile** | transcripts (yt-dlp), any scraped path | Yes — datacenter IPs get refused | No |

So autonomy splits in two, and **Class A can be autonomous today**:

1. **GitHub Actions** runs the worker on a schedule for Class A. Secrets live
   in Actions secrets. This delivers scheduled comments, enrichment,
   AI analysis and weekly reads *without Oracle*.
2. **Oracle**, when capacity lands, hosts the yt-dlp box and Class B, plus
   takes over Class A if preferred.
3. Until then Class B runs attended — a command a human starts.

**Trade-off, stated plainly:** putting the Supabase service key in GitHub
Actions secrets adds a third place it lives (worker, Vercel absent, now
Actions). Encrypted at rest, never printed in logs, and the workflow file is
public but the secret is not. Acceptable; recorded so it is a decision rather
than an accident.

---

## 4. Design decisions that already deviate from earlier PRDs

Recorded so no future session "fixes" them back.

**4.1 Lifecycle is computed at read time, not materialised.** PRD-video-
intelligence §6.3 specified a `post_lifecycle` table. It was built as
`lib/lifecycle.ts` instead, deriving from `post_snapshots` on read. No table
exists and none should — a materialised copy would go stale between syncs for
no gain at this data size.

**4.2 The replay/attention map is retired.** Zero videos in this workspace
publish "most replayed" data. The feature was removed rather than shipped as
a permanently empty panel.

**4.3 `has_captions` does not gate transcript fetching.** The API field counts
manually uploaded tracks only. All 11 YouTube videos report `false` while
carrying full auto-generated tracks. Gating on it would skip the entire
library.

**4.4 Transcripts route through the yt-dlp box first.** YouTube's timedtext
endpoint requires a proof-of-origin token and answers plain requests with
HTTP 200 and an empty body. The direct path is kept only as a fallback.

---

## 5. Constraints — the standing rules

**Cost**
1. **Oracle: Always Free only, forever.** 4 OCPU / 24 GB A1 ceiling, enforced
   in `provision.py` (exit 2). Never provision to the quota the console shows.
   Never upgrade to Pay As You Go.
2. Supabase free: 500 MB. Current corpus ~2 MB — not a concern.
3. Vercel Hobby: **1 of 2 crons already used** by the sync.
4. The LLM API is the only intended paid line item, with a hard monthly token
   ceiling before it can surprise anyone.

**Architecture**
5. **No OAuth, ever.** Enforced by schema constraint, not convention.
6. Owner-only metrics arrive by client-supplied export → `post_analytics`.
7. The worker has **zero inbound ports**; the job queue is its API.
8. All state in Supabase; the worker is disposable.
9. The model narrates numbers the system computed. It never computes them.

**Data honesty**
10. **Never sum views across platforms.** Per-platform chips, always.
11. Replay data ≠ retention. The words *retention*/*drop-off* are banned from
    replay-sourced copy.
12. Auto-generated transcripts are flagged `is_generated`.
13. Dubai (UTC+4) is the business timezone.

**Operational**
14. Never enter passwords into browser forms; headless API sign-in only.
15. Never commit credentials — **the repo is public**.
16. Git: SSH via `github-tn`; never HTTPS remotes; never set local user.name.

---

## 6. Execution order

**C1 — Scheduled autonomy on GitHub Actions.** Workflow running the worker for
Class A jobs on a cron, secrets configured, an enqueue step that finds work
itself. *Accepts when:* a scheduled run completes with no human involvement
and `/data` shows its heartbeat.

**C2 — Backfill the enrichment gaps.** TikTok and Instagram `posted_at_ts`,
descriptions, captions flag. Paced, resumable. *Accepts when:* coverage is
>95% per platform or the remainder is explained.

**C3 — Finish the transcript corpus.** The remaining 46 TikTok videos, paced
across runs. *Accepts when:* every TikTok post has a transcript or a recorded
reason.

**C4 — Instagram comment backfill.** Paced against the Apify budget.

**C5 — Turn the AI layer on.** Needs the key. Then comment themes and hook
analysis across the corpus, cached by `input_digest`, under the token ceiling.

**C6 — Weekly read on a schedule.** Monday morning Dubai, per client.

**C7 — Oracle cutover.** When capacity lands: provision, deploy the yt-dlp box
and the worker, move Class B off attended runs.

**C8 — Client export loop.** Import a real Studio/Insights export end to end;
prove the click-vs-stay panel with real numbers.

---

## 7. Open questions for the user

1. **The LLM API key** — C5 is fully built and cannot run without it. This is
   the single largest capability sitting idle.
2. **Will a client send an export?** Decides whether Tier 3 (CTR, true
   retention, click-vs-stay) ever exists.
3. **Is a GitHub Actions runner acceptable** as the interim host, given §3's
   secret-placement trade-off?
4. **If Oracle never yields capacity**, is a different always-free host
   acceptable for the yt-dlp box, or is waiting fine?
