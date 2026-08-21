<!-- Provenance: commissioned research, 2026-08-21/22. Seven agents across
     five angles (statistical confidence, retrieval/embeddings, content
     performance literature, coverage pipeline, trends and idea generation),
     plus an adversarial review of the confidence design specifically, since
     that is the part most able to look rigorous while being useless.
     921k tokens, ~100 minutes.

     Every number in section 1 was measured against the live workspace before
     the research began -- see docs/measured-baseline-2026-08-21.md -- and the
     bugs the research found in section 3 were each verified against live data
     before being written down. Two are already fixed; see the status block
     below. -->

# Status of this PRD

**Not yet built, except where noted.** This is the plan, not a record.

Already actioned, because the research surfaced them as verified bugs rather
than proposals:

- **The Shorts transcript bug is FIXED** (commit `c11c49e`). `RANK = { youtube:
  0, tiktok: 1 }` in `worker/jobs/transcript.mjs` had no `youtube_shorts` key,
  so all 174 Shorts -- 31% of the library, the largest platform by post count
  -- filtered to zero candidates and were marked terminally unavailable with a
  note about Instagram. Measured after the fix: youtube_shorts 0% -> 37%,
  total transcript coverage 20% -> 32%.
- **146 falsely-condemned transcript jobs requeued.** 72 Shorts killed by the
  above, 74 TikTok killed by a service outage recorded as a fact about the
  video. The 23 genuine "no caption track published" rows were left terminal.

Everything else below is unbuilt.

**One figure in this document is now known to be wrong.** Section 5.0 says to
measure sigma before trusting any threshold, and warns that above ~1.5 every
power figure here is optimistic. Measured: **sigma = 1.679** pooled, 1.655
within-client. The regenerated power table is in
`docs/measured-baseline-2026-08-21.md`, and it is materially worse: at a true
1.30x effect, pooled power is **0.284**, not the 0.645 assumed. The method
stays correctly calibrated (false-positive rate 0.049 against a nominal
0.05) but the engine can only reliably find effects of roughly **1.65x and
above**. Read every power claim below against that table, not the one in
§1.4.

---

# PRD — Content Intelligence Engine

**Tilted Needle · v1 · 2026-08-22**
Supersedes the analysis half of `docs/PRD-video-intelligence.md` §5.3–5.5. Everything else there stands.

---

## 1. THE PROBLEM

### 1.1 What the system holds today

| | measured 2026-08-21 |
|---|---|
| videos | 564 |
| platform posts | 564 — exactly one per video, nothing cross-posted |
| post_snapshots | 5,254; **median 3 per post**; 329 of 564 posts have ≥3 |
| clients (live) | 13 — largest 100 videos, median 39 |
| scored by the perf model | **350 of 564 (62%)** |
| transcripts | **115 of 564 (20%)** |
| comments | 2,093 rows over **34 of 564 posts (6%)** |
| AI output ever produced | 20 `comment_themes` rows, 1 `weekly_read` row |
| platforms | TikTok, Instagram, YouTube, YouTube Shorts |

Scored videos per client, measured, not estimated:

| client | scored |
|---|---|
| EuroEyes Deutschland | 68 |
| Tilted Needle Team | 60 |
| Ameerh Naran | 47 |
| Euro Eyes London (LEC) | 41 |
| The Jet Business | 36 |
| yusufnik8 | 32 |
| Tilted Needle | 29 |
| Entree Bakery and Cafe | 25 |
| Alex Evagora | 12 |
| four remaining clients | **0** |

**The median client has 29 scored videos, not 39.** Four of thirteen clients have no scored video at all. Every power calculation in this document uses 29, because `splitBy` filters to `bestIndex != null` at `clientEvidence.ts:148` and 38% of the library never reaches that filter.

Subgroup sizes are worse than the client sizes suggest: **16 of 54 measured subgroups have fewer than 10 members, and four have 0 or 1.** EuroEyes Deutschland has 1 weekend video against 63 weekday. Euro Eyes London has 0.

### 1.2 What the current engine does with that

`buildClientEvidence` builds up to ten splits, computes a ratio of medians for each, requires only `MIN_PER_SIDE = 3` on each side, and then — `clientEvidence.ts:319` — sorts by `Math.abs(b.ratio - 1) - Math.abs(a.ratio - 1)` and hands the top of that list to the model. Small groups produce the most extreme ratios, so the sort is a selector pointed at the weakest evidence in the set.

Three independent simulations of that exact procedure under a pure null — no association whatsoever between attribute and performance — agree closely:

| measured under a generative null | value |
|---|---|
| P(top finding reads as ≥1.5x or ≤0.67x) | **0.971 / 0.976 / 0.966** (three independent sims) |
| P(top finding reads as ≥2.0x or ≤0.50x) | 0.645 / 0.666 |
| median group size behind the winning finding | 5 |
| P(at least one split reaches raw p<0.05) | 0.387 |

So roughly every client report leads with a finding that would look identical if the data were noise. The real stored output —

> "Videos with titles containing a number have a median boost of 0.396x, compared to 0.674x for those without, based on 3 analyses."

— sits at the 22nd percentile of the pure-noise distribution. Reconstructed with a plausible heavy tail it carries a Mann-Whitney p of 0.53 and a Hodges-Lehmann 95% interval of **0.134x to 3.166x**. It contains no information, and it is rendered with the same visual weight as a finding resting on sixty videos.

Three faults compound: no usable floor, no multiple-comparison control, no interval. A fourth is structural — `CLIENT_READ_SCHEMA` (`clientEvidence.ts:384`) lets the **model** pick `confidence: low|medium|high`. Confidence is currently a language model's impression of a number, presented as a statistical property.

A fifth, separate and worse: `lengthHint` (`clientEvidence.ts:296-309`) ranks videos **by** `bestIndex`, takes the top quartile, and reports that group's median **length** against the rest. That is selection on the dependent variable. Simulated with length drawn completely independent of performance, n=39, 8,000 reps: the reported gap is ≥10 seconds **55% of the time**, with a 90th percentile of 27.7s. It carries no test, no interval and no effect size, and it is narrated straight into the prompt at line 357.

### 1.3 The honest ceiling

This has to be stated in the product, not just in the repo.

- **Martin, Hofman, Sharma, Anderson & Watts (WWW 2016)**, run with full platform data: best model R² = 0.48. **Content-only features: "negligibly low" — well below 0.05.** Basic user/account features alone: R² ≈ 0.20; user + past success: 0.42–0.48. "A single feature (past user success) performs almost as well as all features combined." Even with perfect information, simulated ceiling collapses from R² ≈ 0.93 to ≈ 0.60 with just 15% quality heterogeneity.
- `perfIndex = value / accountBaseline` **deliberately divides out** the account-history term. That is the correct question — we want to know what content works, not that big accounts get more views — but it means this engine operates in the residual, which the literature puts under 5% explained variance.
- **Papers claiming R² = 0.92–0.98 for virality all include early view counts as features.** Predicting final views from early views is autocorrelation, not explanation, and it tells nobody what to do before publishing. Those numbers are banned from this document and from the UI.
- **Wu, Rizoiu & Xie (ICWSM 2018, 5.3M videos): R² = 0.77 predicting watch *percentage* cold-start.** How much of a video people watch is quite predictable from content. How many people see it is not. This is the single strongest argument for eventually scoring on retention rather than views (§3, Lane H).
- **Tan, Lee & Pang (ACL 2014)**, wording isolated with same-author same-URL pairs: best model 66.5% pairwise accuracy, humans 61.3%, chance 50%. That is the realistic ceiling for "does this hook work" claims. Notably, **numbers and proper nouns did not improve propagation**, which is why "title contains a number" is demoted to a calibration canary in §5.

**What can honestly be claimed:** *"Among videos we have scored, those with X performed between A and B better than those without."* An association inside an observed library. **What cannot:** *"adding X will improve a video."* Nothing observational supports it. The one route to a causal claim is randomisation — alternate a title format across consecutive posts on one account; at Cliff's δ = 0.5 that needs ~30 per arm, ~20 weeks at 3 posts/week. Worth naming in the product because it is actually achievable; not in v1 scope.

### 1.4 The reframe this PRD is built on

Two independent analyses and one adversarial review converged on the same correction, and it is the central design decision here.

**The per-client split at n=29 cannot be answered. The workspace split at n=350 can.**

Measured power to detect a true effect, pooled across the 13 clients versus tested in the median client alone:

| true effect | pooled (N≈350–564) | single client (n≈29) |
|---|---|---|
| 1.22x | 0.576 | 0.119 |
| 1.30x | 0.662 | 0.100 |
| 1.42x | 0.931 | 0.238 |
| 1.50x | 0.938 | 0.200 |
| 1.65x | 0.997 | 0.387 |
| 2.00x | 1.000 | 0.287 |

Pooled null false-positive rate is *lower* too: 0.030 vs 0.056.

And critically — simply making the per-client test rigorous does not produce a product. Simulated at the real client size with a correct gate + BH + a five-tier confidence table, **89.2% of rows read "cannot tell yet"** and only 2.2% reach "strong" even with real effects present. "Ruled out" requires a Cliff's δ CI width ≤0.5, which is unreachable below N≈100 — twelve of thirteen clients could never be told "we checked and it doesn't matter." That is not honesty, it is a report that says nothing.

So: **estimate each hypothesis once across the whole workspace, then locate each client inside that estimate by empirical-Bayes shrinkage.** perfIndex is already dimensionless and account-relative — that is precisely what makes cross-client pooling legitimate, and the existing code built the right normalisation and used it at the wrong level of aggregation.

Measured consequence at the row level: P(a client row reads as a big effect) under a null drops from **0.976 to 0.014**, rising to 0.123 at a true 1.42x and 0.275 at 1.73x. Roughly 20:1 signal to noise on the printed number.

**The honest cost, which must appear in the UI and not be discovered later:** cross-client shrinkage damps genuinely client-specific effects. Measured — a true 1.73x effect present on **one** client only is surfaced 48.9% of the time under this design, versus 86.7% raw. The product must say what it does: *"we surface patterns that hold across your accounts."* That is the correct trade at n=29, because a client-specific effect at n=29 is indistinguishable from the noise that currently produces a confident headline 97% of the time.

---

## 2. NON-GOALS

1. **No causal claims.** "Associated with", never "causes", never "will improve". Enforced in the prompt and in the renderer.
2. **No prediction of views.** No model that outputs an expected view count for an unpublished video. The ceiling in §1.3 makes it dishonest.
3. **No best-time-to-post recommender.** Posting time is a 10–20% effect. Measured power to detect a true 1.2x: 2.0% at n=39, 2.7% at n=100, 6.0% at n=300. It cannot produce a legitimate positive at any size this system will ever have. It survives only as a calibration canary (§5.4).
4. **No per-client discovery of new hypotheses.** The hypothesis list is a versioned constant. Ad-hoc splits make any multiple-comparison control a lie, because the denominator becomes unknown.
5. **No summing views across platforms.** A TikTok view and a YouTube view are different events. Cardinal rule, already enforced in `scoring.ts`; benchmarking is where it would most easily be violated.
6. **No changepoint detection, no seasonality claims, no per-topic trend lines.** At n=29 a changepoint detector always finds a changepoint and its location is arbitrary.
7. **No competitor tracking.** Competitor posts have no account baseline in this system, so `perfIndex` cannot be computed for them, and comparing raw view counts is the thing this codebase correctly refuses to do.
8. **No Pinecone, no second datastore, no fine-tuning, no self-hosted embedding model on the worker.** See §8.
9. **No new Oracle footprint.** No second instance, no shape change, no block volume change. Per `AGENTS.md`, the LLM API remains the only meaningful recurring bill.
10. **No CTA advice presented as a finding.** Nothing in this system measures clicks, follows or conversion. Generated CTAs are labelled craft convention.
11. **No comment-derived variable is ever a hypothesis.** Comment counts, tag rates and question rates are *consequences* of distribution, measured on the same post whose performance is being scored. They are diagnostics and editorial input, never split variables. Treating them as predictors would be circular in the same way `lengthHint` is.
12. **The model never chooses confidence, never computes a figure, never invents a citation.** Existing house rule (`llm.ts:227`), extended to cover the one field it does not yet cover.

---

## 3. PHASE 1 — COVERAGE

Transcripts 20% → target **≥90%**. Comments 6% of all posts / 11% of addressable → target **≥90% of addressable**.

**The coverage gap is mostly three bugs, not three vendors.** Do the free work first; measure; then spend about $17.

### 3.1 What is actually missing, and why

**Comments: the denominator is wrong.** From the latest snapshot's comment count per post: **265 of 564 posts (47%) have literally zero comments.** Addressable universe is **299 posts**, of which 34 are done. So current coverage is 11%, not 6%, and the remaining work is 265 posts holding **~29,985 comments**. Distribution:

| platform | posts | zero-comment | with comments | comments |
|---|---|---|---|---|
| TikTok | 144 | 62 | 82 | 23,637 |
| Instagram | 166 | 54 | 112 | 5,721 |
| YouTube Shorts | 174 | 108 | 66 | 2,983 |
| YouTube | 80 | 41 | 39 | 2,536 |

TikTok is 26% of posts and **79% of all uncollected comment mass** (288/post vs ~45 for YouTube-like).

**Transcripts: 146 of the 169 terminal `unavailable` rows (86%) are false.**

- **72 YouTube Shorts** condemned by a hardcoded map. `worker/jobs/transcript.mjs:159`:
  ```js
  const RANK = { youtube: 0, tiktok: 1 };
  ...
  .filter((p) => p.platform in RANK)
  ```
  `youtube_shorts` is not a key. Every Shorts-only item filters to zero candidates and falls into the line-165 branch returning `unavailable` with the note *"no platform on this item publishes captions (instagram has none)"* — a note about Instagram, on a YouTube video. 174 of 564 videos are Shorts and **exactly 0 have transcripts**, while long-form YouTube sits at 80%. `platforms.mjs` exists precisely because *"Five separate `slug === 'youtube'` checks were what stood between Shorts and silently getting no transcripts."* `RANK` is the sixth site. The file already calls `isYouTubeLike` correctly at lines 182 and 225 — the post never survives the filter to reach them.
- **74 TikTok videos** written off because the yt-dlp box was down. Line 225 returns `unavailable` with *"the extraction service is unavailable and there is no direct route"* whenever `viaDiscoverBox` returns null — i.e. a transport failure recorded as a fact about the video. This is the identical bug the same file guards against 80 lines lower (287-311), where an empty timedtext body is deliberately **thrown** because *"16 videos were settled terminally with this note during a drain where the yt-dlp service was returning 401."* The guard was added to the YouTube branch and not to this one. TikTok demonstrably publishes captions here: 51 TikTok items already have transcripts by this route.
- Only **23** rows ("no caption track published") are genuine.

`unavailable` is terminal — `enqueue.mjs settled()` excludes it forever and `worker/requeue.mjs` explicitly refuses to touch it. So none of the 146 can be recovered by any existing code path.

**The comments enqueuer re-picks the same 25 items forever.** `planComments` sorts by `(newestByItem.get(a) ?? 0) - (newestByItem.get(b) ?? 0)` and slices 25. `newestByItem` is only populated for items that already have comments, so everything unfetched evaluates to `0`, the comparator returns 0 for all of them, `Array.prototype.sort` is stable, and the same first 25 win every run. Live evidence: **1,171 comments jobs over 195 distinct subjects, max 48 jobs on one subject, 17 repeat subjects that have never stored a single comment, and 369 of 564 items never queued once.** Same class as the ig_caption credit-burning loop and the 1000-row analysis starvation — fixed twice elsewhere, still live here.

### 3.2 The rule that would have prevented all 146

> **A handler may write a terminal verdict only when it actually reached the platform and the platform answered.** A transport failure — box down, 401, 429, timeout, misconfiguration — throws. Throwing retries; retrying costs nothing; writing a lie costs a video forever.

Applies to `transcript.mjs:165` and `:225`. The file already implements exactly this reasoning at 287-311.

### 3.3 Where a verdict lives: `enrichment_state`

Today four distinct states collapse into `ingest_jobs.status='unavailable'` plus a free-text `last_error` that is **overwritten on every retry**, and downstream readers see only the absence of a `video_transcripts` row — identical for "music-only clip" and "not fetched yet". `buildClientEvidence` therefore has no denominator.

One new table, and only handlers that reached the platform may write to it (§9.1). No row = never attempted, or attempted and failed at transport. That is the whole distinction, and it is deliberately *not* duplicated onto `video_transcripts` — duplicated constants have already failed once in this project.

States: `ok`, `no_speech` (ASR ran, quality gate rejected), `no_captions_published`, `platform_unsupported` (a statement about *our* capability, so it carries `recheck_after`), `none_exist` (comments: the post genuinely has zero).

`method_version` is what re-opens a verdict. `no_captions_published` at `method_version=1` (captions only) is re-opened by ASR shipping as `method_version=2` — a backfill, not a migration.

### 3.4 The lanes

**Lane A — free, code only. 174 Shorts + 74 TikTok videos.**
Add `youtube_shorts: 0` to `RANK` (use `isYouTubeLike`, do not add a seventh string check). Convert lines 165 and 225 to throws when the box is configured. Add `worker/requeue.mjs --reopen-note=<pattern>` to re-open `unavailable` rows whose note matches a known-bad set, since nothing else can. Requeue the 146.

**Lane B — free. Typed state.** Migration for `enrichment_state`; handlers write it; `buildClientEvidence` reads it for its denominator sentence.

**Lane C — free. Comments enqueuer.** Add a deterministic tiebreaker (`item.id`) after the freshness comparator, and exclude posts whose latest snapshot reports `comments = 0` — writing `none_exist` for them instead. Requeue the 151 Instagram `comments:unavailable` rows, which date from the era when the planner passed post ids instead of content-item ids.

**Lane D — free. Queue metering.** `ingest_jobs.priority` exists (default 100) and `claim_ingest_jobs` orders by `(priority, not_before)`, but **nothing ever sets it** — every live row is 100, so ordering collapses to FIFO and a 260-row backfill would block every incremental job for its entire duration. Set three bands at insert: **10** incremental (video discovered in the last 7 days), **100** staleness refresh, **500** backfill. Then move pacing off the cron: a per-kind token bucket in `worker/index.mjs` (`RATE_TRANSCRIPT_PER_HOUR=80`), releasing a claimed-but-not-due job back to pending with `not_before = nextAllowedAt` and `attempts - 1` — exactly the pattern `isCoolingDown` already implements at lines 115-126. Set `BATCH=1` for rate-limited kinds; `BATCH=5` currently fires five 429-risking requests back to back. With this in place the enqueuer can insert the whole backfill at once and drop the per-run `CAP`.

**Lane E — ~$5 one-time. Residential proxy for captions.**
Measured, not estimated: instrumenting `yt-dlp 2026.07.04`'s `urlopen` and summing response bytes for a captions-only extraction gives **1,429 KB per video** (watch page 1,292,624 B = 90%, innertube player 72,786 B, caption file 8–33 KB). `player_skip=webpage` returns zero caption tracks; `tv_simply` is worse at 3,510 KB. So the caption backfill — 260 videos — is **372 MB = 0.36 GB**. At DataImpulse $1/GB that is **$0.36**; Decodo ~$1.45; Bright Data ~$2.90. Most providers have a $5 minimum, which covers years. The reason proxies looked expensive is the mental model "proxy = downloading video"; a caption fetch is 1.4 MB. `deploy/tiktok-discover/server.py` has no proxy option — add `opts['proxy'] = os.environ.get('YTDLP_PROXY')`, ~3 lines.

Rate limit, also measured: **HTTP 429 after ~10 timedtext requests in ~2 minutes** from a residential IP. The mechanism matters — that measurement used `subtitleslangs=['en.*']`, which matched `en`, `en-orig` and auto-translated variants and issued 4+ calls for one video. `server.py` does **not** set `subtitleslangs`; `_pick_track` selects exactly one track and fetches one URL, so the deployed box is already correct at 3 requests/video. **Any future change that adds a language glob silently quadruples the request rate into the 429.** Without a proxy, pace at 1 video / 45s ±50% jitter ≈ 80/hour; 260 videos = 3.25 hours. With a rotating proxy the constraint disappears.

**Lane F — $0.27, or free. ASR for everything captions cannot reach.**
Instagram is 166 videos (29% of the library), 0 transcripts, no caption route in any tool — but the audio exists and the box already extracts Instagram media successfully. Minutes still lacking a transcript, from `content_items.length_seconds` (423 of 564 populated; overall median 51s, mean 172.7s): Instagram ~139, Shorts 147, YouTube 48, TikTok ~73 → **~406 minutes = 6.8 hours**.

| provider | rate | cost for 406 min |
|---|---|---|
| Groq `whisper-large-v3-turbo` | $0.04/audio-hour | **$0.27** — and the free tier allows 28,800 audio-seconds/day, so the whole backfill fits in one free day |
| OpenAI `gpt-4o-mini-transcribe` | $0.003/min | $1.22 |
| Deepgram Nova-3 | $0.0043/min | $1.75, inside their $200 credit |

Pipeline: yt-dlp pulls the MP4 (Instagram has no separate audio stream; ~3–6 MB per 50s reel, ~830 MB total ingress, free on Oracle, disk flat if each file is deleted after use) → ffmpeg downmix to 16 kHz mono MP3 at ~32 kbps (~200 KB, which also keeps long-form YouTube under OpenAI's 25 MB limit) → one ASR call. ~22s per video end to end; 166 Instagram clips ≈ 1 hour of worker time. ffmpeg is already on PATH.

**The ASR quality gate is not optional.** Whisper was trained on YouTube subtitle pairs where silence-plus-music is captioned with end-card text, so on non-speech audio it emits *"Thank you for watching!"*, *"Please subscribe"*, or loops one phrase. Local Whisper exposes `no_speech_threshold`; **the cloud APIs do not**, so the mitigation must be client-side. For this corpus that is worse than no transcript: a music-only b-roll clip acquires a fake script, enters the `search_vector` index, and is fed to the model as if it were what the video said — a coverage fix becoming a new source of fabricated evidence inside the exact analysis we are trying to make trustworthy.

Gate, before any write: (a) output must exceed 15 words; (b) reject against a blocklist of known hallucination phrases; (c) reject if any segment repeats more than 3 times; (d) optionally run VAD first and skip clips with no voiced frames. A rejected result writes `enrichment_state = 'no_speech'` with the raw output in `note` for audit — **never** into `full_text`.

**Lane G — $11.58 one-time. TikTok comments.**
The worker deliberately excludes TikTok (`comments.mjs:45`: yt-dlp *"returns zero comments even on a post with 169 of them"*) and so does `planComments`, so these 23,637 comments have never been touched. Apify `memo23/tiktok-comments-scraper` is $0.49/1,000 results → **$11.58**. Apify is already wired in (`APIFY_TOKEN`, `clockworks~tiktok-scraper` in `src/lib/providers/tiktok.ts`), so this is a new actor on existing plumbing. **Cheaper option: cap at the top 100 comments per post → 8,200 comments → $4.02**, and lose almost nothing, because theme analysis already caps at `MAX_COMMENTS = 300` and saturates well below 100. Ship the cap; lift it only if a client-level question needs it.

Instagram comments are free — `fetchViaBox` works and 3 posts already prove it. YouTube quota is a non-issue: `commentThreads.list` is 1 unit per 100 comments, the remaining 74 YouTube-like videos need ~95 units of a 10,000/day allowance (**0.95%**), and steady state is ~15 units/day. Build no quota machinery.

**Lane H — free, human, high value. Owner CSV exports.**
Every signal the platforms say they rank on is invisible publicly. Instagram (Mosseri, official): *"how likely you are to reshare a reel, watch a reel all the way through..."* — reshare first, watch-through second. YouTube Help 16559650: Appeal / Engagement / Satisfaction, with the initial seconds flagged for Shorts. TikTok newsroom: completion outweighs weak signals. Of watch time, completion, retention curve, viewed-vs-swiped, sends and saves, **zero are publicly obtainable on Instagram and YouTube**. This system scores on views, the downstream consequence with the largest random component.

The plumbing already exists and is unused: `post_analytics` carries `avg_viewed_pct`, `ctr`, `retention_30s/60s`, `retention_curve`, `source='manual'`, and `src/lib/studioImport.ts` is a robust CSV parser. What is missing is files. Ask each client for: YouTube Studio → Advanced mode → Export current view; TikTok Studio (desktop) → Analytics → Download data; Meta Business Suite → Insights → Content → Export Data. Expect schema drift and treat the column mapper as maintained code.

This is Phase 1 scope only insofar as *asking* is free. The engine gains a second outcome variable in §5.7 when coverage allows.

### 3.5 Throughput and calendar

| stage | machine time |
|---|---|
| YouTube-like comments (74 videos, ~95 quota units) | 2 min |
| TikTok + Instagram comments (Apify, URL-list runs) | 2–4 runs, minutes each |
| Caption transcripts (260 videos @ 80/hr, no proxy) | 3.25 h |
| ASR (~216 clips @ ~22s) | ~1.3 h |
| **total** | **~5 h** |

The binding resource on 1 OCPU / 1 GB is neither CPU nor RAM — every stage is I/O-bound and single-file — it is politeness pacing on the YouTube path.

- **Day 1:** Lanes A–D ship. Transcript coverage moves 115 → **~340 of 564 (60%)** at zero cost.
- **Day 2:** caption backfill drains (Lane E).
- **Day 3:** ASR closes Instagram and the residue → **~95%**; comment lanes drain.

Steady state at ~40 new videos/month: ~18 caption fetches, ~10 ASR clips, ~10 comment fetches. Worker idle >99% of the time.

**Exit criteria for Phase 1:** transcripts ≥ 90% of videos *or* every remaining video carries an `enrichment_state` row explaining why; comments ≥ 90% of the 299 addressable posts *or* an `enrichment_state` row; `ingest_jobs` has zero `unavailable` rows whose note mentions a transport failure.

---

## 4. PHASE 2 — FEATURE EXTRACTION

### 4.1 The rules

1. **Outcome-blind.** No feature may be defined, thresholded, tuned or selected using `perfIndex`. This is enforced by construction: the feature extractor never reads a score. Violating it is what makes `lengthHint` circular, and discovering features on the same data you then test them on is the garden of forking paths with extra steps.
2. **Deterministic features are recomputed, never cached as truth.** Tier 1 is pure arithmetic over transcript + metadata; a full recompute of 564 videos is milliseconds, so a threshold change is a re-run, not a migration.
3. **Model-extracted features are cached on `(content_item_id, prompt_version, input_digest)`** and cost tokens exactly once.
4. **Comment features are diagnostics.** They inform editorial direction and never enter the hypothesis family (§2.11).

### 4.2 Tier 1 — computed, zero tokens

Over `video_transcripts.segments` (`[{start_ms, dur_ms, text}]`, already stored) and `content_items` / `platform_posts` metadata.

| feature | definition |
|---|---|
| `hook_text_15s` | concatenation of segments with `start_ms < 15000` (~35–45 words) |
| `hook_word_count` | words in `hook_text_15s`. **Do not embed a 0–3s window** — 7–8 words is below the length where an embedding carries stable meaning. Keep 0–3s as a display string only. |
| `hook_has_question` | `?` present, or `QUESTION_OPEN` regex (question marks are unreliable in ASR output, so match the words too — existing logic, keep) |
| `hook_is_greeting` | `GREETING_OPEN` regex |
| `hook_second_person_rate` | second-person pronouns per 100 words in the hook |
| `hook_imperative_open` | first token is an imperative verb, small lexicon |
| `hook_numeral` | digit present in `hook_text_15s` |
| `words_per_second` | overall, and separately over the first 3s |
| `time_to_first_content_noun_ms` | measurable form of "slow open" |
| `question_density` | questions per 100 words, whole transcript |
| `numeral_density` | digits per 100 words |
| `type_token_ratio`, `flesch_kincaid` | lexical variety, reading level |
| `cta_present`, `cta_first_ms` | small lexicon |
| `loop_marker` | phrase recurring at both start and end (loop-bait; TikTok counts replays) |
| `title_length`, `title_has_question`, `title_has_numeral` | from `content_items.title` |
| `length_seconds` | existing column |
| `posted_hour`, `posted_weekday` | via `zoneOffsetMs` in the operating zone — **not** a fixed offset. The existing `dubaiHour` bug moved videos across the very boundary the finding was about. |
| `transcript_status` | from `enrichment_state`, so a null is never read as "said nothing" |

### 4.3 Tier 2 — one cached model call per video

564 calls on `gpt-4o-mini`, ~400 tokens in / ~60 out → **~$0.06 for the whole corpus**. Uses the existing schema-validated `llm.ts` adapter and its digest cache.

| field | why |
|---|---|
| `format` | `talking_head \| listicle \| demo \| skit \| voiceover_broll \| interview \| text_on_screen`. Likely the highest-variance content feature and the system extracts nothing like it today. |
| `hook_descriptor` | `{opening_move, subject_frame, addressee, promise}` — **topic-stripped by construction.** This is the single most important item in Phase 2 and the least obvious. A raw hook embedding encodes **topic, not style**: *"What's the best CRM in 2026?"* and *"What's the best espresso grinder?"* are the same hook style and land far apart; *"Here's the best CRM in 2026"* and *"What's the best CRM in 2026?"* are different styles and land almost identically. Clustering raw hooks discovers topics you already know and misses styles, which are the one thing a team can change before the next shoot. |
| `promise_stated`, `promise_paid_off_ms` | the operationalisable core of "hook", far more so than "contains a question mark" |
| `emotional_arc` | three `(valence, arousal)` points. **Berger & Milkman (JMR 2012): arousal is what travels, not valence** — awe/anger/anxiety spread, sadness suppresses. Store both, test arousal. |
| `claim_type` | `how_to \| opinion \| story \| reveal \| reaction` |
| `topic`, `entities` | cross-checkable against `content_items.topic_labels` (YouTube's own labels), a source that is not the model |

### 4.4 Tier 3 — comment diagnostics, computed

Deterministic counters per post, no model call. Filter comments under ~3 tokens first ("first", "W", a bare emoji) — plausibly 20–30% of a 30k corpus, and they will otherwise form a large meaningless cluster that swallows any density-based grouping.

| counter | why it earns its place |
|---|---|
| `mention_count` | comments containing `@`. **Instagram names resharing as its top-ranked prediction and sends are invisible publicly.** A viewer tagging a friend is the publicly visible cousin of a DM send. Validate against sends when CSV exports land; if it tracks, it retroactively scores the ~530 posts that will never have exports. |
| `question_rate` | unmet information demand → the next video's topic, chosen by the audience rather than guessed |
| `confusion_markers` | "wait what", "i don't get", "what happened at", "rewatched" — diagnostic of a failed hook, and genuinely ambiguous, since confusion drives rewatches which platforms reward. Measure rather than assume. |
| `intent_markers` | "where can I buy", "link?", "how much" — the metric an agency can put in front of a client |
| `median_length`, `reply_ratio` | a threaded argument is a different signal from 200 fire emojis |

`COMMENT_THEMES_SCHEMA` gains a required `kind` enum — `question \| objection \| praise \| confusion \| request \| tag \| spam` — so themes are typed by function, not only by topic and valence. Counting stays exactly where it is: the model returns ids, `tallyThemes` counts them, hallucinated ids are dropped and reported.

### 4.5 Schema

```sql
-- Tier 1: deterministic. Recomputable from scratch at any time; stored only so
-- the engine reads one table instead of re-parsing 564 transcripts per run.
create table video_features (
  content_item_id        uuid primary key references content_items on delete cascade,
  workspace_id           uuid not null references workspaces on delete cascade,
  extractor_version      integer not null,   -- bump = full recompute, no migration
  hook_text_15s          text,
  hook_word_count        integer,
  hook_has_question      boolean,
  hook_is_greeting       boolean,
  hook_second_person_rate numeric,
  hook_imperative_open   boolean,
  hook_numeral           boolean,
  words_per_second       numeric,
  words_per_second_3s    numeric,
  time_to_first_noun_ms  integer,
  question_density       numeric,
  numeral_density        numeric,
  type_token_ratio       numeric,
  flesch_kincaid         numeric,
  cta_present            boolean,
  cta_first_ms           integer,
  loop_marker            boolean,
  title_length           integer,
  title_has_question     boolean,
  title_has_numeral      boolean,
  -- Null here means UNOBSERVED, never "absent". Every transcript-derived
  -- hypothesis drops these rows rather than counting them on the negative side.
  transcript_present     boolean not null,
  computed_at            timestamptz not null default now()
);

-- Tier 2: model-extracted. Separate table because it costs tokens, carries a
-- prompt_version, and must not be wiped by a Tier 1 recompute.
create table video_descriptors (
  content_item_id   uuid primary key references content_items on delete cascade,
  workspace_id      uuid not null references workspaces on delete cascade,
  prompt_version    integer not null,
  model             text not null,
  input_digest      text not null,
  format            text,      -- talking_head | listicle | demo | skit | ...
  hook_descriptor   jsonb not null,   -- {opening_move, subject_frame, addressee, promise}
  hook_descriptor_text text,          -- rendered form; this is what gets embedded
  promise_stated    boolean,
  promise_paid_off_ms integer,
  emotional_arc     jsonb,     -- [{at:'start'|'mid'|'end', valence, arousal}]
  claim_type        text,
  topic             text,
  entities          text[],
  created_at        timestamptz not null default now(),
  unique (content_item_id, prompt_version, input_digest)
);

-- Tier 3: comment diagnostics. Computed, never model-derived, never a hypothesis.
create table post_comment_metrics (
  platform_post_id  uuid primary key references platform_posts on delete cascade,
  workspace_id      uuid not null references workspaces on delete cascade,
  extractor_version integer not null,
  analysed_count    integer not null,   -- after the <3-token filter
  filtered_count    integer not null,
  mention_count     integer not null,
  question_count    integer not null,
  confusion_count   integer not null,
  intent_count      integer not null,
  median_length     integer,
  reply_ratio       numeric,
  computed_at       timestamptz not null default now()
);
```

RLS mirrors `video_transcripts` (client-scoped read through `content_items`, staff write). The worker's service key bypasses it as everywhere else.

---

## 5. PHASE 3 — THE CONFIDENCE ENGINE

One dependency-free module, `src/lib/analysis/inference.ts`, ~180 lines of pure functions, tested through the existing `npm run test:evidence` harness. It deletes more existing code than it adds.

### 5.0 Step zero: measure σ

Every threshold below depends on **σ = SD of ln(perfIndex)** across the 350 scored posts, and it has never been measured — the simulations assumed 0.8–1.2. Measure it, per client and pooled, and store it in `analysis_runs`. If pooled σ exceeds ~1.5, every power figure in this document is optimistic and the required-N table must be regenerated from the harness (§12.2).

### 5.1 The unit of observation

One row per **scored platform post**, not per video: `{client_id, platform, content_item_id, x = ln(perf_index), features…}`.

Today 564 videos = 564 posts so this is identical to the current `bestIndex`. It matters the moment cross-posting begins: `EvidenceVideo.bestIndex` is `max` across a video's posts (`clientEvidence.ts:29`), and max-of-k is upward-biased by ~0.56σ at k=2. If cross-posting correlates with the attribute being tested — teams cross-post their best-planned videos, which also have the most considered titles — that is a manufactured confound. **Switch to per-post rows with platform as a stratum before cross-posting begins, not after.**

### 5.2 The hypothesis registry

A versioned constant in `src/lib/analysis/hypotheses.ts`, mirrored into a `hypotheses` table on first use so old findings stay resolvable. Each entry: `{id, version_added, kind: 'binary'|'rank', requires: 'metadata'|'transcript'|'descriptor', direction_expected, is_canary, definition_fn}`.

Registry v1 (m ≈ 16 when transcripts are complete):

**Binary, metadata:** `h_title_question`, `h_title_numeral`†, `h_posted_weekend`†, `h_posted_before_noon`†
**Binary, transcript:** `h_hook_question`, `h_hook_greeting`, `h_hook_second_person`, `h_hook_numeral`, `h_hook_imperative`, `h_cta_present`, `h_loop_marker`
**Binary, descriptor:** `h_format_talking_head`, `h_format_listicle`, `h_format_demo`, `h_promise_stated` (k-way format is expanded one-vs-rest, each its own family member)
**Rank (Spearman):** `r_length_seconds`, `r_hook_word_count`, `r_title_length`, `r_time_to_first_noun`, `r_hook_arousal`

† canary — see §5.4.

**Rank hypotheses replace median splits for continuous covariates**, and this is a free power win, not a nicety. MacCallum, Zhang, Preacher & Rucker (*Psychological Methods* 2002): dichotomising a continuous variable *"is rarely defensible and often will yield misleading results."* Measured at the same underlying effect: median-split power 0.34 vs rank-correlation power 0.51 at n=39; **0.73 vs 0.91 at n=100.** Genuinely binary attributes stay as splits — dichotomisation is only a sin when the underlying variable is continuous. Never run both forms of the same covariate; that is double-counting into the family.

### 5.3 The method

**Layer 1 — per client, per hypothesis.**

Binary hypothesis h, client c, over that client's scored posts where the feature is *observed* (transcript-derived hypotheses drop untranscribed posts entirely — a video with no transcript has not "failed to ask a question", it is unobserved):

```
n1 = |with|, n0 = |without|
require n1 >= 3 and n0 >= 3, else client c does not contribute to h
y_hc = mean(x | with) - mean(x | without)        // log of the geometric-mean ratio
s²_c = pooled within-client variance of x over ALL that client's scored posts
v_hc = s²_c * (1/n1 + 1/n0)
```

`y` is a difference of **log means** — the geometric mean, not the median. For log-normal data both estimate the same quantity, but measured over 20,000 reps the median carries **~1.57x the variance** (n=39: 0.0426 vs 0.0269; asymptotic π/2 = 1.571), i.e. it discards ~36% of the information — about 14 videos' worth at n=39, when n is the entire problem. The codebase's fear of means is well-founded but aimed at the wrong estimator: on 38 normal posts plus one 500x outlier, arithmetic mean = 14.48x (the documented "66.9x baseline" disaster), **geometric mean = 1.284x, median = 1.205x**. ln(500)=6.2 contributes as 6.2, not 500.

**Inference on the geometric mean; display the median.** They agree closely, and where they diverge sharply that divergence is itself a signal the group is too skewed to summarise — flag and suppress.

Rank hypothesis: Spearman ρ_hc between the covariate and x within client c; Fisher-z transform z = atanh(ρ), v = 1/(n−3).

**Layer 2 — pool across clients by DerSimonian–Laird.**

```
w_c   = 1 / v_hc
mu0   = Σ w_c·y_c / Σ w_c
Q     = Σ w_c·(y_c − mu0)²
C     = Σ w_c − Σ w_c² / Σ w_c
tau²  = max(0, (Q − (k−1)) / C)          k = contributing clients
w*_c  = 1 / (v_hc + tau²)
mu_h  = Σ w*_c·y_c / Σ w*_c
se_h  = sqrt(1 / Σ w*_c)
I²    = max(0, (Q − (k−1)) / Q)
```

Ten lines. No MCMC, no sampler, no dependency. **This is DL used correctly** — combining k noisy estimates *of the same quantity*, which is exactly what "does this technique work, measured on 13 clients" is. Pointing DL at splits-*within* a client instead would treat "published at a weekend" and "title contains a number" as exchangeable draws from one distribution, which is a category error that can only subtract information.

Verified against 6,000 reps at real group sizes: **when nothing real is going on, DL returns tau²=0 in 56% of runs**, B collapses to 1, and every client reports the pooled mean. The engine says "no difference" by construction rather than by a hand-tuned rule. That property is the reason to use it, and it only exists at this level.

**Layer 3 — p-value by blocked permutation, not by a z-test.**

Permute the hypothesis label within each `(client, platform)` block; recompute `mu_h`; B = 5,000 reps.

```
p_h = (1 + #{ |mu*| >= |mu_h| }) / (1 + B)
```

Why permutation rather than `mu/se`: it is exact under the null of no within-block association, makes no distributional assumption, handles wildly unequal n, and — because the blocks are `(client, platform)` — it kills the two confounds that actually matter here by construction:

- **Platform is a proxy for format.** "Published before noon" may just be "is a Reel"; "longer than median" may just be "is YouTube long-form" (Shorts are length-capped, TikTok is not). We have exactly one post per video, so platform is a clean stratifier. Additionally compute the effect *within* each platform and flag any hypothesis whose direction reverses between platforms — a finding that exists only in the pooled data is Simpson's paradox waiting to be printed.
- **Client-level baseline differences.** Permuting within client means clients with different baselines are never compared directly.

**Seed the permutation RNG from the run's input digest.** A jittering p-value silently busts the `ai_analyses` cache and re-buys every narration.

**Dropped deliberately:** the proposed Spearman `|ρ|>0.3` time-confound guard. The claim was that `accountBaseline` (median of the prior ≤10 mature values, `scoring.ts:101`) induces negative serial dependence that contaminates time-correlated splits. Running the actual algorithm on IID log-normal raw views measures **lag-1 autocorrelation of ln(index) = +0.0086** (positive, not negative), lag-2 +0.0007, variance inflation 14%, and exact Mann-Whitney false-positive rate **0.046 for random splits and 0.019 for an early-vs-late-half split** — at or *below* nominal. The rolling baseline **adapts to trend, so it is the mitigation for time confounding, not the source of it.** The guard is machinery for a problem that measures at approximately zero. Store the rank correlation between the feature and posting order in the finding record for audit; do not act on it.

**Layer 4 — Benjamini–Hochberg at q = 0.10, once, workspace-wide.**

Sort p-values ascending; reject the largest i where `p(i) ≤ (i/m)·q`. m = the number of hypotheses that actually ran this run (≥3 contributing clients), stored in `analysis_runs`.

Why BH and not Bonferroni: Bonferroni controls the probability of *any* false finding, which is right when one false positive is catastrophic. Here a false positive means a marketer puts numbers in titles for a month. The right target is "of the findings I show, what fraction are junk" — that is FDR, and q=0.10 is a sentence you can put in the UI: *of the patterns we surface, expect about one in ten to be spurious.* Bonferroni's flat threshold is also nearly unreachable at these n and would admit only literal perfect separations from small groups, which are outlier artifacts. q=0.10 rather than q=0.20 because BH's guarantee is not airtight for correlated two-sided tests, which is precisely our structure — take the margin.

**Family definition matters as much as the procedure.** m is workspace-wide because the estimate is workspace-wide. Correcting per client segment and calling it done is a documented way to inflate real FDR — one marketing team's per-channel correction ran at ~0.14 against a nominal 0.05.

**Layer 5 — the client row is an empirical-Bayes posterior, and this is the number that gets printed.**

```
B_hc     = v_hc / (v_hc + tau²_h)
theta_hc = B_hc · mu_h + (1 − B_hc) · y_hc
displayed multiplier = exp(theta_hc)
```

Implemented by reusing `shrink()` at `scoring.ts:158` with **n = tau²_h and k = v_hc**, which reduces algebraically to exactly the above. Same function, data-driven k instead of the hardcoded `SHRINKAGE_K = 5`.

This is the layer that does the work. Decomposing the null headline rate at the real client size: current code **0.976** → raise the floor to n≥8 **0.788** → add shrinkage of the reported ratio **0.331** → add the cross-client prior **0.014**. **Shrinkage does roughly three times the work of the sample floor, and the entire testing apparatus contributes ~0 to the remembered number.** BH decides *whether* a row appears; only shrinkage changes *what it says* — and the code's own comment at `clientEvidence.ts:141` already knows that *"printing it with a caveat is not good enough because the number is what gets remembered."*

On the real reported finding (client grand mean ln = −0.5108, σ²=1.0): with-number n=3 → B=0.769 → posterior 0.545x (raw 0.396x); without n=36 → B=0.217 → posterior 0.657x. **The reported 0.588x becomes 0.830x.** A "41% penalty for numbers in titles" becomes a 17% lean. That is the honest number and it is what should be printed.

### 5.4 Gates and thresholds

| constant | value | why |
|---|---|---|
| `MIN_SIDE_POOL` | 3 | below this a client contributes nothing to the pooled estimate |
| `MIN_SIDE_ROW` | 8 | below this the client gets no row of its own. n=3 admits **no 95% median interval at all** (widest possible interval covers 75.0%); n=6 is the mathematical floor but its interval is the entire observed range; 8 is the practical floor. |
| `MIN_CLIENTS` | 3 | a hypothesis with fewer contributing clients does not run and is not in the family |
| `Q` | 0.10 | BH |
| `PERMUTATIONS` | 5,000 | seeded from the input digest |
| `ACT_BAND` | outside [0.87, 1.15] | below this the client's own posterior is not distinguishable from the pooled effect in any way worth a sentence |
| `MIXED_THRESHOLD` | 0.20 | if >20% of contributing clients have a posterior whose sign disagrees with `mu_h`, the pooled effect may not be stated as advice |
| `SKEW_SUPPRESS` | geometric mean and median differ by >2x | the group is too skewed to summarise; suppress |

**The heterogeneity gate is not optional.** A pooled average can be actively harmful advice. Measured: pooled 1.3x with τ=0.35 → real client effects span 0.83x–2.04x and **22% of clients are hurt by following it**; τ=0.70 → 0.53x–3.19x and **35% hurt**. Heterogeneity also erodes power: at a true 1.5x, pooled power falls from 0.938 (τ=0) to 0.762 (τ=0.35) to 0.688 (τ=0.7). When τ is large relative to μ, the pooled mean is the wrong estimand and the correct output is per-client posteriors with no headline.

Also dropped: **the Noether MDE gate.** At the real client size, `mdeDelta ≤ 0.80` reduces algebraically to `min-side ≥ 6` — a constant wearing a formula. Measured null headline rate with that gate and nothing else: **0.889.** It stops almost nothing. `MIN_SIDE_ROW = 8` is the same thing, honestly labelled.

### 5.5 States — three, not five

Computed in code, supplied to the model **as data**, and the model may not alter them.

| state | rule | words the marketer reads |
|---|---|---|
| **Worth acting on** | BH-significant, hypothesis not `mixed`, client has n1≥8 and n0≥8, and `exp(theta_hc)` outside the ACT band | "Titles with a number: **1.3x for this client** (24 of your scored videos), in line with the 1.25x we see across all 13 accounts." |
| **Holds across your accounts** | BH-significant, but this client is inside the band or under the row floor | "Openings that speak to the viewer do better across the agency (1.28x over 350 videos). Your library is consistent with that; we don't have enough of your videos to tell you apart from it." |
| **Nothing we can measure** | everything else | **One closing line for the whole report**, never a per-row wall of hedges. |

The five-tier design was measured and rejected: at the real client size with real effects present, `unresolved = 0.892, strong = 0.022, consistent = 0.058, ruled_out = 0.000`. "Ruled out" needs N≈100 and would fire for one of thirteen clients. Per-row "unresolved" would be 95% of rows. That is the failed product this PRD exists to avoid.

**Schema change.** `CLIENT_READ_SCHEMA` (`clientEvidence.ts:373-389`):

```ts
// was: confidence: { type: "string", enum: ["low","medium","high"] }
state: { type: "string", enum: ["acting", "holds", "none"] }
```

and `CLIENT_READ_PROMPT` gains: *"Each row carries a state and its exact wording. Use that wording. Never upgrade, downgrade, or invent a state."* This single change is what converts confidence from decoration into a measured property.

### 5.6 When there is not enough data — and there usually will not be

The engine must be able to say so, in a way that reads as a finding rather than a malfunction.

**Report-level fallbacks, in order:**

1. **Client has zero scored videos** (4 of 13 today): *"None of Alex Evagora's 18 videos have enough performance history to score — scoring needs 3 prior readings on the account, and the median post here has 3 snapshots total. Nothing can be said yet."*
2. **Client scored but under `MIN_LIBRARY`:** *"12 scored videos. We need about 25 before your own library can be distinguished from the agency pattern."*
3. **No hypothesis survived BH this run:** *"We tested 16 patterns across all 13 accounts this month and none cleared the bar. That is a real answer, not a failure — at 350 scored videos we can see effects of about 1.4x and larger. Anything smaller is below what this library can resolve."*
4. **Hypothesis is `mixed`:** *"Longer videos help some of your accounts and hurt others, by more than the average difference itself. We are not going to give you one number for it."*
5. **Every report, always, carries its denominator:** *"Based on 29 of your 61 videos that carry a score; 24 of those have a transcript, 6 are music-only, 3 are not fetched yet."* Read straight from `enrichment_state`. `"based on 39 of your 61 videos"` is materially different from `"based on your videos"`, and the survivorship is real — scoring needs 3 prior mature posts, so **every account's first three posts are invisible** and a client who opened a new channel has that entire era missing.

**Every "not enough" carries a roadmap.** The required-N figure comes from the simulation harness (§12.2), not a closed form — the closed forms assume balance and normality this data does not have. *"At the size of the difference we're seeing, this would need about 120 scored videos to settle. You have 29, and you're adding about 4 a month."* That converts a non-finding into a plan.

### 5.7 Second outcome variable (conditional on Lane H)

The engine takes `outcome` as a parameter. `perf_index` (views-relative) is v1. When a client has ≥40 posts with `post_analytics.avg_viewed_pct`, a parallel family runs on `completion_index` — and per Wu et al., that is the outcome with R²≈0.77 rather than <0.05, so it is where real findings will live.

One mandatory correction before duration is allowed near that model: **average watch percentage is mechanically tied to duration.** Define relative engagement as the percentile rank of a video's watch percentage among videos of *similar duration*, not the raw percentage, or duration will dominate everything.

### 5.8 What gets deleted

- `lengthHint` (`clientEvidence.ts:296-309`) and its narration at line 357. Circular. The length **rank** hypothesis asks the same question testably.
- The sort at line 319. Replaced by: state, then `|theta_hc|`.
- `MIN_PER_SIDE = 3`.
- The model-chosen `confidence` enum.
- `Split.ratio` / `Split.peak` as the payload handed to the prompt.

**And not built:** exact Mann-Whitney U by DP, Cliff's delta and its 1993 asymmetric CI, order-statistic median CIs, Hodges–Lehmann intervals, the bootstrap (measured to under-cover at these n regardless of resample count: nominal 95% delivers 0.912–0.933 at n=8–13, and more resamples do not fix it), Benjamini–Yekutieli, per-client BH, and the five-tier table. None of them changes the printed number.

**Copy rules, enforced in the renderer and unit-tested:**

- Never render an interval spanning 1.0 numerically. *"did somewhere between 7x worse and 3x better"* is worse than silence — a marketer reads "7x worse", remembers it, and acts on it.
- Never print a ratio without its n in the same sentence.
- One sentence per finding, carrying the shrunk multiplier, the n, and the workspace comparison.

---

## 6. PHASE 4 — TRENDS AND PATTERNS, STORED PER CLIENT

Two distinct things get called "a trend". Both are covered; they are stored separately.

### 6.1 Persistent findings

A finding is not a fact about this week. It is a claim with a lifecycle.

```sql
create table analysis_runs (
  id                  uuid primary key default uuid_generate_v4(),
  workspace_id        uuid not null references workspaces on delete cascade,
  registry_version    integer not null,     -- which hypothesis list ran
  outcome             text not null,        -- 'perf_index' | 'completion_index'
  m_tested            integer not null,     -- the BH family size, recorded not inferred
  q                   numeric not null,
  permutations        integer not null,
  seed                text not null,        -- derived from input_digest; makes the run reproducible
  sigma2_pooled       numeric not null,     -- §5.0
  scored_posts        integer not null,
  clients_contributing integer not null,
  started_at          timestamptz not null default now(),
  finished_at         timestamptz
);

create table workspace_effects (
  id             uuid primary key default uuid_generate_v4(),
  run_id         uuid not null references analysis_runs on delete cascade,
  hypothesis_id  text not null,
  k_clients      integer not null,
  mu             numeric not null,          -- log scale
  se             numeric not null,
  tau2           numeric not null,
  i2             numeric not null,
  p_perm         numeric not null,
  q_bh           numeric not null,
  significant    boolean not null,
  is_mixed       boolean not null,          -- >20% sign disagreement
  platform_reversal boolean not null,       -- Simpson flag
  unique (run_id, hypothesis_id)
);

create table client_findings (
  id               uuid primary key default uuid_generate_v4(),
  workspace_id     uuid not null references workspaces on delete cascade,
  client_id        uuid not null references clients on delete cascade,
  hypothesis_id    text not null,
  -- Lifecycle, not a snapshot. A finding is shown until it is RETRACTED.
  status           text not null default 'active'
    check (status in ('active','retracted','superseded','stale')),
  state            text not null check (state in ('acting','holds','none')),
  first_seen_run   uuid not null references analysis_runs,
  last_seen_run    uuid not null references analysis_runs,
  retracted_run    uuid references analysis_runs,
  retracted_reason text,
  -- the printed number and everything needed to audit it
  y_raw            numeric not null,        -- unshrunk log effect for this client
  v                numeric not null,
  shrink_b         numeric not null,
  theta            numeric not null,        -- shrunk log effect: what is printed
  multiplier       numeric not null,        -- exp(theta)
  n_with           integer not null,
  n_without        integer not null,
  order_rho        numeric,                 -- feature vs posting order, audit only
  created_at       timestamptz not null default now(),
  unique (client_id, hypothesis_id, first_seen_run)
);
```

**How a finding is detected:** it is the output of §5.3 — nothing else creates one.

**How it is refreshed — and this is the largest omission the original design had.** `WEEKLY_READ_DAYS = 7` (`enqueue.mjs:328`) is a pure time gate with no data-change check, so every client's hypotheses are re-tested 52 times a year on a library gaining ~1 scored video a week. Measured under a pure null with BH applied per report exactly as designed: P(a given client is shown ≥1 false finding) = 0.105 after 1 run, 0.293 after 13, **0.471 after 52**, carrying a false finding in a mean of 6.7 separate weeks. Across 13 clients over a year: **0.9998.** "Set the family to whatever the reader sees at once" does not survive contact with a marketer who accumulates memory across weeks and watches findings appear, vanish and contradict themselves.

**Replace the time gate with a data gate:** re-run a client when its scored-post count has grown ≥20% since `last_seen_run`, or 90 days have passed. At ~1 scored video/week from 29 that is **~6 runs/year instead of 52** — cutting P(≥1 false finding/client/year) from 0.471 toward ~0.15, and LLM spend by ~8x.

**How a stale trend expires:**
- Hypothesis loses BH significance in a run where the client contributed → `retracted`, with `retracted_reason` and the run id, **and the retraction is narrated**: *"We reported that longer videos helped in June. With 15 more videos it no longer holds."* That is the honest handling of repeated looks and it reads as a feature, not a hedge.
- Client's own posterior crosses out of the ACT band → `superseded` by a new row with `state='holds'`.
- Not recomputed in 180 days (client went quiet) → `stale`, hidden from the report, kept for audit.

### 6.2 Trajectory over time

Legitimate methods exist; the sampling rate defeats most of them. 29 scored videos over 1–2 years is under one a week, and half the corpus has barely enough snapshots for a single score.

- **Mann–Kendall:** right nonparametric choice in principle, but power at this n for realistic drift is very low, and it assumes serial independence that content performance does not have.
- **CUSUM:** methodologically wrong here, not merely underpowered. It needs a well-estimated in-control mean, and `accountBaseline` is a rolling 10-post median that **moves** — a CUSUM over perfIndex would be partly detecting changes in its own reference.
- **Changepoint detection (PELT, BOCPD):** always finds a changepoint; at n=29 its location is arbitrary. Excluded by §2.6.

**What ships:** one pre-registered before/after comparison per client. Split the client's scored history at its midpoint, permute the half-label, report the difference in log means with its permutation p. One comparison, not a scan, so it needs no multiplicity correction and it will honestly say "no detectable change" most of the time. Stored as a `client_findings` row with `hypothesis_id = 'trajectory_half_split'`.

**And a rolling-median chart, labelled descriptive.** It is legitimate as display and illegitimate as inference. The model is forbidden from narrating a turn in it — this is the single easiest place for confident-sounding filler to re-enter after the splits are fixed, and the ban goes in `CLIENT_READ_PROMPT` explicitly.

---

## 7. PHASE 5 — IDEAS AND SCRIPTS, WITH EVIDENCE GROUNDING

### 7.1 Provenance is a validator, not a prompt

`llm.ts` already implements the right foundation: `HOUSE_RULES` forbids computing figures, `evidenceToPrompt` hands over a table the model cannot influence, `validate()` rejects off-schema output with one retry then a hard failure. Extend it with mechanical citation checking, in code, before anything reaches a screen:

1. Every cited id exists in the candidate set supplied in the prompt → catches invented provenance.
2. Every quoted figure matches the supplied row for that id, to 3 decimal places → catches invented numbers.
3. At least one citation per idea, else the idea is **dropped**, not shown with a caveat.

Rule 2 matters more than it looks. The failure mode is **deceptive grounding**: a response passes every citation check while presenting evidence about entity Y as evidence about queried entity X — every claim sourced from a real row, about the wrong thing. LLMs are specifically weak at precise comparison and value extraction from context, which is exactly the operation an idea generator performs on an evidence table.

Counters (`dropped_uncited`, `dropped_bad_figure`, `dropped_unknown_id`) are stored on the generation, mirroring `tallyThemes().problems[]`.

### 7.2 Gates

- **No idea may cite a `none`-state finding.** A client with zero `acting`/`holds` findings gets ideas explicitly labelled **craft convention, not evidence from your library** — and the label is a schema field, not prose.
- **Script generation requires ≥3 transcribed top-quartile videos for that client.** Few-shot voice matching from the client's own transcripts is the right method at this data volume — fine-tuning would cost more and breach the budget rule for a benchmark gain that does not exist at 115 (soon ~530) transcripts. But below ~3 exemplars it degrades into generic short-form voice, which is precisely the failure being avoided. Below the gate: generate structure only, and say so. Mirrors the discipline already in `MIN_POSTS_TO_RANK` and `MIN_LIBRARY`.
- **Defensible script inputs, all from this system's own data:** hook drawn from the client's own top-performing openings with the video id cited; length targeted to the client's own best-quartile median (not an industry number); platform-specific duration from `platformFit`.
- **Not defensible, and labelled as such:** CTA advice. Nothing here measures conversion.

### 7.3 The feedback loop

Design it now, because it is unbuildable retrospectively — you cannot recover which ideas were offered and declined once they are gone.

```sql
create table idea_suggestions (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references workspaces on delete cascade,
  client_id       uuid not null references clients on delete cascade,
  run_id          uuid references analysis_runs,      -- the evidence state it was born from
  prompt_version  integer not null,
  model           text not null,
  kind            text not null check (kind in ('idea','script')),
  body            jsonb not null,
  -- [{type:'finding'|'video', id, figure}] — every entry verified in code
  evidence_refs   jsonb not null,
  evidence_basis  text not null check (evidence_basis in ('measured','craft')),
  dropped_counts  jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create table idea_outcomes (
  id                uuid primary key default uuid_generate_v4(),
  suggestion_id     uuid not null references idea_suggestions on delete cascade,
  -- The NOT-adopted set is the part teams skip and the part that carries the
  -- information. Without it you measure human selection, not idea quality.
  disposition       text not null check (disposition in ('adopted','declined','expired')),
  declined_reason   text,
  content_item_id   uuid references content_items on delete set null,
  perf_index_at_maturity numeric,
  decided_at        timestamptz not null default now()
);
```

**Honest volume arithmetic, stated up front:** ~40 videos/client/year. If a third come from generated ideas, that is ~13 adopted ideas per client per year. At σ≥1.0, detecting even a 1.5x difference between idea-derived and baseline videos needs far more than that. **Per-client evaluation is a multi-year proposition and must not be promised.** Pooled across 13 clients the same comparison reaches corpus scale and becomes answerable in months — evaluation, like the analysis, is a population-level question here.

**The cheapest useful signal is available immediately: adoption rate.** If a strategist declines 90% of generated ideas, that is a verdict, it needs no statistics, and it arrives within weeks.

---

## 8. RETRIEVAL LAYER — DECIDED

**pgvector, in the Supabase database already running. Not Pinecone. Not "nothing".**

### 8.1 Why not Pinecone

Pinecone Starter is technically sufficient — 2 GB, 5 indexes, 100 namespaces, 2M write units and 1M read units/month; ~54k vectors is ~356k WU to load and ~10 RU/query. Quota is not the blocker; architecture is.

1. **RLS.** Every table here is workspace-scoped with RLS and the worker's service key is a deliberate exemption. Pinecone has no RLS. Putting transcript and comment text there means re-implementing workspace isolation in a second system with a different security model — a real regression for a product whose discipline is that its numbers are checkable.
2. **Every query wanted is a JOIN.** Not one is pure similarity: it is always "semantically nearest **AND** same client **AND** scored **AND** platform = X **AND** last 90 days". In pgvector that is one statement. With Pinecone it is metadata-filter → return ids → round-trip to Postgres → re-filter → discover you over-fetched because you could not pre-filter on a column Pinecone does not have.
3. **A second independent pause clock.** Supabase free pauses after 7 days of no DB activity (already covered — the worker polls continuously). Pinecone Starter indexes pause after ~3 weeks of inactivity. A new silent-failure mode for a workload that fits in 76 MB of a database already running.

Pinecone is right at ~5M+ vectors, or with a latency SLA. This is three orders of magnitude away.

### 8.2 Why not "nothing"

Before Phase 1, "nothing" was correct: ~8.8 transcripts per client, and vector search over 9 documents is strictly worse than passing all 9. **After Phase 1 the corpus is ~530 transcripts and ~30k comments**, and one job becomes genuinely unbuildable in SQL — merging comment themes. `commentThemes.ts` labels themes per post, so the 20 stored `comment_themes` rows across 34 posts are 20 independently-invented vocabularies. "how much is it", "pricing?", "what's the cost" share zero lexical overlap; `tsvector` and `pg_trgm` cannot merge them, and no client-level statement about what an audience asks is derivable today even though the underlying comments plainly support one.

### 8.3 The configuration

- **`text-embedding-3-small` with the API `dimensions: 512` parameter, stored as `halfvec(512)`.** Storage is the binding constraint, not cost: `vector(n)` costs 4n+8 bytes, `halfvec(n)` costs 2n+8. Native 1536-dim = 332 MB before indexes, plus HNSW → 650 MB+, against a **500 MB free tier**. `halfvec(512)` = 56 MB; with chunk text and btrees, ~76 MB, about 23% of the tier including current data. Use the **API parameter, not client-side truncation** — the API re-normalizes; a client-side slice leaves unnormalized vectors and silently wrong cosine distances. Secondary benefit: 1,032 B sits inline, under the ~2 KB TOAST threshold, so no `SET STORAGE PLAIN` workaround and no extra heap fetch per row on sequential scans.
- **No ANN index. Ship a plain btree on `(workspace_id, kind)` and nothing else.** Exact scan of 54k halfvec(512) rows is 30–50 ms unfiltered and sub-millisecond once `WHERE client_id` applies, which is every real query. This sidesteps pgvector's known filtered-HNSW weak spot, but the stronger argument is statistical: nearest-neighbour sets feed matched-control comparisons, and **an approximate neighbour set injects an unquantified ~5% selection error into a number we are about to print a confidence state next to.** This codebase's whole discipline — `commentThemes.ts` counting ids itself, `clientEvidence.ts` returning null rather than a weak number — is that numbers are checkable.
- `create extension if not exists vector;` — not yet enabled; migrations only create `uuid-ossp` and `pg_trgm`. Available on all Supabase plans including free.
- **Store `model` and `dimensions` as columns.** A full re-embed costs about five cents, so re-embedding must be a backfill job, not a migration.

### 8.4 What it is used for — three jobs, and no others

1. **Comment theme merging.** Embed the ~20 (later few hundred) theme *labels*, agglomerate at a tight cosine threshold, let the model name each merged group. Counts aggregate across posts because `tallyThemes` already returns verified comment ids, so a merged theme's count is the union of verified id sets — the "system does the counting" guarantee survives intact. **Build this first: ~200 vectors, a fraction of a cent, no backfill needed, and it turns 20 orphan rows into the first client-level audience statement the system can make.**
2. **Hook archetype discovery**, over `video_descriptors.hook_descriptor_text` (topic-stripped by construction, §4.3) concatenated with the computed structural features. **Fit ONE taxonomy across all videos; assign per client.** At n=29 HDBSCAN returns two clusters and a noise pile and k-means is seed-unstable at any parameter setting. Fitting globally means the archetype definition rests on 564 videos and never re-estimates per client, every client shares a vocabulary, and cross-client comparison becomes possible. **Algorithm: agglomerative, average-linkage on cosine, fixed cut** — 159k pairwise distances is instant, it is fully deterministic (so a client's archetype does not change because a seed moved), and the dendrogram allows re-cutting without refitting. HDBSCAN would need UMAP first, and umap-learn drags numba/llvmlite onto a 1 GB box.
   **Stability check, free:** bootstrap-resample the corpus 20 times, refit, take each cluster's mean Jaccard overlap with its nearest match; drop clusters below 0.6 and report the number alongside the archetype.
   **The circularity constraint goes in the code, not the docs:** the clusterer never reads `perfIndex`. Discovering clusters and then testing them on the same data is the forking-paths problem with a larger search space — worse than the current hand-written regexes, not better.
   New archetypes enter the hypothesis registry as **v2**, one-vs-rest, and go into the same BH family. Adding hypotheses makes multiplicity worse, not better; do not add them until the correction machinery exists to hold them.
3. **Novelty scoring for the brief generator:** `min(cosine distance)` to the existing corpus. A continuous number that keyword overlap cannot produce.

**What embeddings do not buy: any statistical power.** Embedding a video does not create a new outcome observation. That has to be said plainly, because it is the easiest thing here to oversell.

### 8.5 Hybrid search — the search box only

`video_transcripts.search_vector tsvector` with a GIN index already exists (`20260808140000_free_enrichment.sql:44-47`), and `pg_trgm` is installed. Add the dense side and fuse with Reciprocal Rank Fusion (`Σ 1/(60+rank)`), ~15 lines of SQL, one CTE per retriever. It matters for *this* product specifically because a marketing agency searches for proper nouns — client names, SKUs, campaign names, a competitor's handle — which is exactly where dense embeddings are weakest; and lexical fails on "videos where we talked about being nervous on camera". RRF consumes ranks, not scores, so no calibration between `ts_rank_cd` and cosine is needed. (Postgres has no native BM25; `ts_rank_cd` is not BM25, and real BM25 needs ParadeDB's `pg_search`, which is not installable on Supabase. Inside RRF this does not matter.)

**Hybrid search is irrelevant to the confidence engine.** Clustering, archetype assignment and matched controls are not ranking problems. Do not let "hybrid search" become a work item on that side of the system.

---

## 9. DATA MODEL

Every new table, and why it exists.

### 9.1 `enrichment_state` — the only place a verdict lives

```sql
create table enrichment_state (
  subject_type    text not null check (subject_type in ('content_item','platform_post')),
  subject_id      uuid not null,
  kind            text not null check (kind in ('transcript','comments')),
  workspace_id    uuid not null references workspaces on delete cascade,
  state           text not null check (state in
    ('ok','no_speech','no_captions_published','platform_unsupported','none_exist')),
  method          text,             -- 'captions' | 'asr' | 'api' | 'apify' | 'box'
  method_version  integer not null default 1,
  note            text,             -- for no_speech: the rejected ASR output, for audit
  decided_at      timestamptz not null default now(),
  recheck_after   timestamptz,      -- set for platform_unsupported (~90 days)
  primary key (subject_type, subject_id, kind)
);
```

**Why:** today "no transcript" is indistinguishable from "not fetched yet", and four distinct states collapse into `ingest_jobs.status='unavailable'` plus a `last_error` that every retry overwrites. This gives `buildClientEvidence` a real denominator and decouples the verdict from the queue, so `requeue` can never destroy it. **Only a handler that reached the platform and got an answer may write here.** No row = never attempted, or attempted and failed at transport. That single rule is what would have prevented all 146 false write-offs. `method_version` is what re-opens a verdict when a new route ships — a backfill, not a migration.

### 9.2 `video_features`, `video_descriptors`, `post_comment_metrics`

Defined in §4.5. Separated because one is deterministic and free to recompute, one costs tokens and carries a `prompt_version`, and one is diagnostics that must never reach the hypothesis family.

### 9.3 `hypotheses` — the registry mirror

```sql
create table hypotheses (
  id              text primary key,          -- 'h_hook_question'
  registry_version integer not null,
  kind            text not null check (kind in ('binary','rank')),
  requires        text not null check (requires in ('metadata','transcript','descriptor')),
  label           text not null,             -- the exact words shown to a user
  is_canary       boolean not null default false,
  retired_at      timestamptz
);
```

**Why:** the list must be pre-registered and versioned, or any multiple-comparison correction is a lie because the denominator is unknown. Mirrored into the DB so `client_findings` can reference an id whose definition is still resolvable after the code moves on.

### 9.4 `analysis_runs`, `workspace_effects`, `client_findings`

Defined in §6.1. `analysis_runs` exists so the BH family size, the seed, σ² and the outcome variable are **recorded, not inferred** — an audit of any printed number must be able to reconstruct the run. `workspace_effects` is the pooled estimate, one row per hypothesis per run. `client_findings` is the lifecycle: a claim, not a snapshot, with retraction as a first-class state.

### 9.5 `content_embeddings`

```sql
create extension if not exists vector;

create table content_embeddings (
  id               uuid primary key default uuid_generate_v4(),
  workspace_id     uuid not null references workspaces on delete cascade,
  subject_type     text not null check (subject_type in
                     ('content_item','post_comment','comment_theme')),
  subject_id       uuid not null,
  kind             text not null check (kind in
                     ('hook_descriptor','whole_transcript','comment','theme_label')),
  start_ms         integer,
  text             text not null,
  model            text not null,
  dimensions       integer not null,
  embedding        halfvec(512) not null,
  created_at       timestamptz not null default now(),
  unique (subject_type, subject_id, kind, coalesce(start_ms, -1), model)
);
create index content_embeddings_scope on content_embeddings (workspace_id, kind);
```

**Why:** one table rather than three, because the queries differ only by `kind`. `model` and `dimensions` are columns so a re-embed is a backfill. The unique key makes the embed job idempotent — running twice must not double a cluster's weight, matching the discipline in `transcript.mjs`. **No ANN index** (§8.3).

### 9.6 `hook_archetypes`, `video_archetype_assignment`

```sql
create table hook_archetypes (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references workspaces on delete cascade,
  taxonomy_version integer not null,
  label           text not null,              -- model-named from 10 medoids
  medoid_item_ids uuid[] not null,
  stability       numeric not null,           -- bootstrap Jaccard; <0.6 not shipped
  n_members       integer not null,
  created_at      timestamptz not null default now()
);

create table video_archetype_assignment (
  content_item_id uuid not null references content_items on delete cascade,
  archetype_id    uuid not null references hook_archetypes on delete cascade,
  taxonomy_version integer not null,
  distance        numeric not null,
  primary key (content_item_id, taxonomy_version)
);
```

**Why:** the taxonomy is fitted once, globally, outcome-blind, and versioned; assignment is per video. `stability` is stored beside the label so a shaky archetype is visibly shaky rather than silently equal to a solid one.

### 9.7 `client_comment_themes`

```sql
create table client_comment_themes (
  id            uuid primary key default uuid_generate_v4(),
  workspace_id  uuid not null references workspaces on delete cascade,
  client_id     uuid not null references clients on delete cascade,
  label         text not null,
  kind          text not null check (kind in
                  ('question','objection','praise','confusion','request','tag','spam')),
  -- Union of verified comment ids from the per-post themes that merged here.
  comment_ids   uuid[] not null,
  comment_count integer not null,     -- = cardinality(comment_ids), computed
  post_count    integer not null,
  merged_from   uuid[] not null,      -- the ai_analyses rows that fed this
  created_at    timestamptz not null default now()
);
```

**Why:** the 20 orphan per-post themes cannot be summed today. Storing the id union preserves the "system does the counting" guarantee through the merge.

### 9.8 `idea_suggestions`, `idea_outcomes`

Defined in §7.3. The declined set is the load-bearing half.

### 9.9 RLS

All new tables follow the existing patterns: content-scoped tables (`video_features`, `video_descriptors`, `content_embeddings`) inherit `can_read_client` through `content_items`; analysis output (`analysis_runs`, `workspace_effects`, `client_findings`, `idea_*`) follows `ai_analyses` — **staff only, never client users, even about their own content**, because it routinely compares them to other clients and that comparison is the agency's. Worker uses the service key throughout.

---

## 10. COST

### 10.1 One-time

| item | arithmetic | cost |
|---|---|---|
| Lanes A–D (bug fixes, schema, queue) | code only | **$0** |
| TikTok comments, capped 100/post | 8,200 × $0.49/1k | **$4.02** |
| TikTok comments, uncapped | 23,637 × $0.49/1k | ($11.58) |
| Instagram comments | existing yt-dlp box | **$0** |
| YouTube comments | ~95 quota units of 10,000/day | **$0** |
| Residential proxy | 0.36 GB @ $1/GB = $0.36, $5 minimum purchase | **$5.00** |
| ASR backfill | 406 min = 6.77 audio-hours @ $0.04/hr (Groq) | **$0.27** (free inside Groq's 8 h/day free tier) |
| Hook descriptors + format | 564 × (400 in + 60 out), gpt-4o-mini @ $0.15/$0.60 per 1M | **$0.05** |
| Embeddings, full corpus | ~2.4M tokens @ $0.02/1M (3-small) | **$0.05** |
| **Total** | | **≈ $9.40** (≈ $17 uncapped) |

The difference between the cheap embedding model and the expensive one across the entire backfill is 26 cents, so cost is not a decision axis for that choice — storage is (§8.3). Re-embedding the whole corpus after a change of mind costs another nickel.

**Explicitly not spent:** no second database, no Pinecone, no self-hosted model on the worker. Self-hosting bge-small to save five cents would add ONNX binaries, a tokenizer and 200+ MB resident to the one machine that must stay up, competing for the only OCPU with `ingest_jobs`, and would burn 30–60 minutes of full CPU the queue needs. That is a reliability tax paid in the wrong currency. Embeddings **are** the LLM API bill, which `AGENTS.md` already permits.

### 10.2 Recurring, at ~40 new videos/month, 13 clients

| item | arithmetic | monthly |
|---|---|---|
| TikTok comments | ~10 new TikTok posts × 100 capped × $0.49/1k | **$0.49** |
| ASR | ~10 clips × ~50s | **$0.05** |
| Proxy | ~18 caption fetches × 1.43 MB = 26 MB | **$0.11** |
| Embeddings | ~200k tokens | **$0.004** |
| Hook descriptors | 40 × 460 tokens, gpt-4o-mini | **$0.004** |
| Comment themes | ~10 posts/month, existing job | **~$0.05** |
| Client reads | **6.5 runs/month** (data gate, §6.1), ~3,160 tokens each | **~$0.05** |
| YouTube quota | ~15 units/day of 10,000 | **$0** |
| **Total** | | **≈ $0.75/month** |

The data gate is the biggest single lever: **52 reads/client/year → ~6**, cutting narration spend ~8x while simultaneously cutting the annual false-finding rate. Suppressing under-powered rows shrinks the evidence table further, and moving `confidence` from a model judgement to a computed field means the cached-analysis digest changes only when the statistics change.

**Recommended change:** move narration from `gpt-4o` to `gpt-4o-mini`. The model's entire job is turning a computed table into sentences under `HOUSE_RULES`; it is forbidden from computing anything. Keep `gpt-4o` for hook descriptors if quality demands it. The provider-neutral adapter makes this a config change.

`DEFAULT_LLM_MONTHLY_TOKEN_LIMIT = 2,000,000` stays. Projected usage is ~10% of it, which is the correct relationship between a ceiling and a budget.

**Oracle footprint: unchanged.** No new instance, no shape change, no volume change, no capacity reservation. Run `python deploy/oracle/audit.py` before and after any deployment touching the worker host.

---

## 11. BUILD ORDER

Each step ships independently and has a check that proves it.

**0. Baseline snapshot.** Record current counts, `enrichment_state`-equivalent tallies, and **σ = SD of ln(perfIndex)** pooled and per client. Commit as `docs/measured-baseline-<date>.md`.
*Proves it:* the file exists and σ is a number, not an assumption. Every later threshold cites it.

**1. Transcript handler correctness.** Add `youtube_shorts` to `RANK` via `isYouTubeLike`; convert `transcript.mjs:165` and `:225` to throws when a box is configured; add `worker/requeue.mjs --reopen-note=<pattern>`; requeue the 146.
*Proves it:* the 72 Shorts jobs leave `unavailable`; transcript count rises from 115 toward ~340; zero `unavailable` rows remain whose note mentions the extraction service.

**2. `enrichment_state` migration + handler writes.**
*Proves it:* every video without a transcript either has a state row or an in-flight job — asserted by a query in the test suite. `buildClientEvidence` prints a denominator sentence.

**3. Comments enqueuer fix.** Deterministic tiebreaker; `comments = 0` exclusion writing `none_exist`; requeue the 151 Instagram rows.
*Proves it:* distinct comment-job subjects rises past 195 toward 299; max jobs-per-subject drops from 48 to ~2; the 369 never-queued items begin to drain.

**4. Queue metering.** Priority bands (10/100/500) set at insert; per-kind token bucket in `worker/index.mjs`; `BATCH=1` for rate-limited kinds; drop per-run `CAP`.
*Proves it:* insert a 260-row backfill, then create one incremental job; the incremental job is claimed first. Transcript claims never exceed `RATE_TRANSCRIPT_PER_HOUR` over a one-hour window in the logs.

**5. Proxy support.** `YTDLP_PROXY` in `deploy/tiktok-discover/server.py`.
*Proves it:* a 100-video caption drain completes with zero 429s. Assert `subtitleslangs` is still unset — a regression test on the config, because a language glob quadruples the request rate silently.

**6. ASR lane + hallucination gate.** yt-dlp → ffmpeg 16 kHz mono → Groq; gate before write.
*Proves it:* Instagram transcripts appear where there were 0. Feed the gate a known music-only clip and a known speech clip: the first writes `no_speech` with the raw output in `note`, the second writes a transcript. Assert the blocklist catches "Thanks for watching".

**7. TikTok comments lane (Apify, 100/post cap).**
*Proves it:* 82 TikTok posts move from 0 comments to non-zero; spend matches the arithmetic within 10%.

**8. Tier 1 features + hypothesis registry.**
*Proves it:* `video_features` covers every content item with a transcript; running the extractor twice produces byte-identical rows; `hypotheses` mirrors the code constant, and a test asserts no registry entry references `perfIndex`.

**9. `inference.ts` + the simulation harness.** DL pooling, blocked permutation, BH, shrinkage, the three-state mapper. Harness first, module second.
*Proves it:* §12.1 and §12.2 both pass. This step ships nothing user-visible and is the most important step in the document.

**10. Rewire `buildClientEvidence`.** Delete `lengthHint`, the `|ratio-1|` sort, `MIN_PER_SIDE=3`; swap the `confidence` enum for `state`; add the denominator sentence and the copy rules.
*Proves it:* `npm run test:evidence` passes with new cases; the renderer test rejects any interval spanning 1.0; a golden-file test shows the reconstructed "0.396x based on 3" input now produces **no finding**, not a softened one.

**11. Persistence + refresh gate + retraction.** `analysis_runs`, `workspace_effects`, `client_findings`; `WEEKLY_READ_DAYS` replaced by the 20%-growth-or-90-days gate.
*Proves it:* simulate 20% growth for one client → exactly that client re-runs. Force a hypothesis to lose significance → the finding flips to `retracted` and the narration mentions it. Assert the weekly planner no longer fires 13 clients a week.

**12. pgvector + comment theme merging.**
*Proves it:* the 20 orphan themes merge into client-level rows whose `comment_count` equals `cardinality(comment_ids)`, and every id resolves to a real `post_comments` row.

**13. Tier 2 descriptors + hook archetype taxonomy (registry v2).**
*Proves it:* archetypes ship only with bootstrap Jaccard ≥ 0.6; the clusterer has no code path that reads a score (asserted by a grep test in CI, the same way `test:selects` guards select shapes); the null harness re-passes at the larger m.

**14. Ideas + provenance validator + outcome logging.**
*Proves it:* feed the generator a fabricated citation → the idea is dropped and counted. A generated idea's every cited figure matches the supplied row to 3dp. Declines are recorded.

**15. Script generation, gated on transcript count.**
*Proves it:* a client with 2 transcribed top performers gets structure-only output with the gate stated; a client with 8 gets voice-matched output citing video ids.

Steps 1–7 are Phase 1 and can run in three days. Steps 8–11 are the engine. 12–15 are additive and each can slip without breaking anything before it.

---

## 12. HOW WE KNOW IT WORKS

The distinguishing test of this system is not "does it produce findings" — the current one produces findings 97% of the time from noise. It is **"does it stop producing them when there is nothing there."**

### 12.1 The null harness — the primary regression test

`scripts/engine-null-test.mjs`. Take the real feature matrix, **shuffle the outcome column** (destroying every real association while preserving every marginal, every group size, every client imbalance and every platform mix), run the entire engine end to end, and record whether any client row reaches `acting`.

| pipeline | measured P(≥1 big-effect headline under the null) |
|---|---|
| current code, m=10 | **0.971** |
| current code, m=6 | 0.917 |
| + min-side ≥ 8 only | 0.788 |
| + MDE gate only | 0.889 |
| + DL shrinkage of the reported ratio | 0.331 |
| **+ cross-client prior (this design)** | **0.014** |

**Pass condition: ≤ 0.05 over 1,000 shuffles.** Fail the build above it. This single test is the deliverable that the whole PRD exists to make possible, and it is why step 9 ships the harness before the module.

### 12.2 The power/roadmap harness

Same harness with an injected effect. Produces the required-N table the UI quotes, so "you have 29 of the ~120 videos needed to settle this" is a measured number rather than a closed form assuming balance and normality this data does not have.

Regenerate whenever σ, client sizes or the registry change. Targets to reproduce at build time: pooled detection 0.576 at 1.22x, 0.931 at 1.42x, 0.997 at 1.65x, with null 0.030.

### 12.3 Canary hypotheses

Three registry entries flagged `is_canary`, each expected near null on independent grounds: `h_posted_weekend` and `h_posted_before_noon` (posting time is a 1.1–1.2x effect, below the pooled MDE at any size this system will reach) and `h_title_numeral` (Tan et al. 2014 found numbers did **not** improve propagation, despite authors preferring them).

They stay in the family and their long-run firing rate is tracked in a dashboard tile. **If the canaries fire materially more often than q, the engine is miscalibrated** — and unlike every other check, this one runs on live data continuously and needs no simulation.

### 12.4 Retraction rate as a false-positive proxy

A finding retracted within two refreshes was probably never real. Track `retracted_within_2 / first_seen` per quarter. **Alert above 20%**; at q=0.10 with real effects present it should sit well under that. This is the mechanism that would have caught "n=3" without anyone reasoning about power, and it turns the accumulating corpus into a validation set rather than just more data.

### 12.5 Grounding checks

- `dropped_uncited`, `dropped_bad_figure`, `dropped_unknown_id` stored per generation and surfaced, exactly as `tallyThemes().problems[]` already is. A model claiming a figure that is not in the table must be visible, not silently corrected.
- Golden test: a prompt whose evidence table contains 1.28x, with a model reply saying 1.3x → **rejected**, not rounded.
- Golden test: a reply citing a real video id but attaching another video's figure → **rejected** (deceptive grounding).

### 12.6 Determinism and cache integrity

- Two runs on identical inputs produce identical `mu`, `p_perm` and `theta` to full precision — the permutation RNG is seeded from the input digest. A jittering statistic silently busts the `ai_analyses` cache and re-buys every narration.
- `digestOf` remains stable across key reordering (already tested in `test:llm`); extend the test to the new evidence payload.

### 12.7 Renderer contracts, unit-tested

- No finding may render an interval spanning 1.0 numerically.
- No ratio may render without its n in the same sentence.
- Every report renders a denominator sentence sourced from `enrichment_state`.
- The `state` field in a validated model response must equal the `state` supplied in the evidence table. A mismatch is a hard failure, not a warning — this is the whole point of taking confidence away from the model.

### 12.8 Confound tripwires

- **Simpson flag:** per-platform effects computed alongside the pooled one; direction reversal sets `platform_reversal` and suppresses the headline.
- **Cross-posting tripwire:** assert `count(platform_posts) == count(content_items)` where a video is scored. The day that stops holding, `bestIndex = max` becomes upward-biased by ~0.56σ at k=2, and the per-post migration in §5.1 becomes mandatory. Fail the test loudly rather than discovering it in a report.
- **Enriched-subset selection:** before any transcript-based finding is reported, compare the perfIndex distribution of transcribed vs untranscribed videos and record the difference on the run. Transcript coverage was never random — plausibly the videos that got enough attention to be worth enriching — so if the distributions differ, the finding says so. Phase 1 largely closes this, and the check is how we prove it closed.

### 12.9 The cheap human check

Ten findings, presented blind without their state, to a strategist who guesses "real or noise". Not a gate, but it is the only test that measures whether the sentences are *usable*, which is the failure mode all the statistics in the world will not catch. Benchmark it honestly: Tan et al.'s humans hit 61.3% on wording pairs against a 66.5% model ceiling. If a strategist cannot beat chance on our output, the copy is wrong even when the numbers are right.