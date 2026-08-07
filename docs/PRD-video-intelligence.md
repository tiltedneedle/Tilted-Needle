# PRD — Video Intelligence (v1.0)

**Status:** design only. Nothing here is built.
**Depends on:** the unified performance surface (PRD-unified-performance v0.5, shipped).
**Cost envelope:** one paid item — the external LLM API. Everything else stays
inside permanently-free tiers: Vercel Hobby, Supabase Free, Oracle Cloud
**Always Free** (never the 30-day $300 trial).

---

## 1. The thesis

The system already knows *what was made*, *who made it*, *how it performed*, and
*how that compares to the account's own baseline*. It does not know **what is
actually in the video**, or **where viewers left**.

Those two facts, joined, answer the question the agency is really paid to answer:

> *Not "did this video do well" — but "which twelve seconds lost the audience,
> what was being said there, and what should the next script do differently."*

No dashboard the client can buy does that, because it needs three things in one
place: the retention curve, the transcript aligned to it, and a performance
baseline to judge against. This system already has the third. This PRD adds the
first two, and puts a language model on top **strictly as a narrator of numbers
the system computed itself** — never as the thing doing the arithmetic.

Everything else in here earns its place against that thesis or is cut. §11 lists
what was cut and why.

---

## 2. Corrections to the research (these change the design)

The prior research is directionally right about scraping but wrong on three
points that materially change what gets built.

**2.1 — Listing a channel's videos does NOT cost 100 quota units.**
The claim that the official API "charges 100 units simply to index a channel's
video list" is only true for `search.list`. The correct path —
`channels.list` → uploads playlist → `playlistItems.list` — costs **1 unit per
page of 50**. This codebase already does exactly that, and
[youtube.ts:256](src/lib/providers/youtube.ts:256) already carries the comment
explaining why. **Consequence:** we build no scraper for bulk metadata. The
official API covers it for roughly 0.1% of the daily quota.

**2.2 — Comments are cheap too.** `commentThreads.list` is 1 unit per 100
comments. Fetching every comment on 30 new videos a month costs single-digit
quota units. **Consequence:** no scraper for comments either.

**2.3 — For channels the agency manages, there is a legitimate API that returns
*better* retention data than any scraper.** This is the important one. The
YouTube **Analytics API v2** returns, for channels you hold OAuth on:

- true audience retention (`elapsedVideoTimeRatio` × `audienceWatchRatio`) — the
  real curve, not a proxy
- `relativeRetentionPerformance` — how this video holds up against comparable
  YouTube videos of similar length
- average view duration and percentage, impressions and click-through rate,
  traffic sources, subscriber gains

It is free, quota-generous, stable, documented, and inside YouTube's terms. The
"most replayed" heat markers a scraper can pull are a *relative replay
intensity* proxy — a different, weaker measurement that YouTube only publishes
for videos above a view threshold.

**Consequence — the single most important design decision in this PRD:** the
scraper is the **fallback**, not the foundation. Every channel the agency can
get OAuth on jumps to a better data tier, permanently, at zero cost and zero
breakage risk.

**2.4 — Minor but affects the chart.** The heat markers are ~100 buckets spread
across the video's duration, not fixed 2.48-second intervals. The x-axis is
**percent of video**, not seconds. That is also exactly the shape the Analytics
API returns, which is why one chart component serves both sources.

---

## 3. The data ladder

Each video lands on the highest tier available to it. The tier is stored, shown
in the UI, and **never mixed** — a true retention curve and a replay-intensity
proxy are different measurements and are never plotted on the same axis or
compared to each other.

| Tier | Source | What we get | Reliability |
|---|---|---|---|
| **A — Managed** | YouTube Analytics API v2 (OAuth per channel) | True retention curve, relative retention performance, avg view %, impressions, CTR, traffic sources. Captions via `captions.download`. | Official, stable, in-terms |
| **B — Public** | `timedtext` transcript endpoint + InnerTube player response | Transcript, "most replayed" intensity (when published) | Undocumented, breaks without notice, IP-blockable |
| **C — Neither** | — | Metrics only, as today. Manual transcript paste allowed. | — |

**On Tier B and terms of service, plainly and once:** fetching those endpoints
is outside YouTube's published terms, the endpoints can change without notice,
and requests from datacenter IP ranges get blocked on reputation rather than on
volume — so "10–30 videos a week is safe" is likely but not guaranteed. The
architecture therefore treats Tier B as *expected to fail sometimes*: it
degrades to Tier C without taking anything else down, and it is the reason §4
isolates it on a machine that can be blocked without consequence. Tier A carries
none of this risk, which is why §12's first prompt is the OAuth connection.

---

## 4. Architecture — what runs where, and why

Four components. One of them costs money, and it is not infrastructure.

```
┌─ Vercel (Hobby, free) ──────────────────────────────────────┐
│  The Next.js app. Reads Supabase. Renders charts.           │
│  Writes JOB ROWS. Never calls YouTube. Never calls the LLM. │
└────────────────────────┬────────────────────────────────────┘
                         │
┌─ Supabase (Free) ──────▼────────────────────────────────────┐
│  The ONLY database. Transcripts, retention, analyses, and   │
│  the job queue all live beside the data they describe.      │
└────────────────────────▲────────────────────────────────────┘
                         │  polls for jobs, writes results
┌─ Oracle Always Free ───┴────────────────────────────────────┐
│  The Intelligence Worker: scheduler, fetchers, LLM caller.  │
│  ZERO inbound ports. Outbound only.                         │
└────────────────────────┬────────────────────────────────────┘
                         │
                    External LLM API  ← the only paid line item
```

**4.1 — Why a separate machine at all.** Three hard constraints, not preference:
Vercel's IP ranges are among the most aggressively blocked by YouTube; serverless
functions time out long before a backfill finishes; and Hobby cron is limited to
a daily tick, which cannot pace a throttled queue.

**4.2 — The job queue is the API.** The worker exposes **no HTTP endpoint at
all**. It polls a Supabase table for pending jobs, does the work, writes results
back. An admin pressing "Re-analyse" simply inserts a row. This means: no
inbound firewall rules, no public IP, no TLS certificates, no authentication
layer to get wrong, and no new attack surface anywhere. Latency for a manual
trigger is one poll interval (30s) — irrelevant for work measured in hours.

**4.3 — One database, deliberately.** Oracle's Always Free tier includes two
Autonomous Databases. **We use neither.** Transcripts and retention curves are
tiny (§9), and a second database would mean two sources of truth, a sync path,
and a class of bug that does not currently exist. Supabase stays the only store.

**4.4 — Which Oracle shape.** Prefer one **Ampere A1 ARM** instance (the Always
Free allowance is 4 OCPU / 24 GB across A1 instances). If A1 capacity is
unavailable in the region — a well-known and frequent Oracle condition — the
worker also fits comfortably on an **always-free AMD micro instance** (1 OCPU /
1 GB), because it is I/O-bound, not compute-bound. The workload is a few dozen
HTTP calls a day; it does not need 24 GB. Design for the micro, enjoy the A1.

**4.5 — Idle reclamation is a real risk.** Oracle may stop Always Free compute
instances judged idle over a 7-day window. A worker that sleeps 23 hours a day
looks exactly like an idle instance. Mitigation: the worker runs a continuous
lightweight loop (30s poll + a self-heartbeat row) rather than a cron that fires
once and exits. This also gives us the liveness signal in §10 for free.

**4.6 — Secrets.** The LLM API key and the Supabase service key live **only** on
the Oracle box. Neither is ever added to Vercel's environment, so neither can
reach a client bundle or an edge function. The browser never sees a model call.

**4.7 — Verify limits at signup.** Oracle revises Always Free allowances
periodically. The shapes above are correct as designed; confirm current figures
when the account is created, and note that only Always Free resources may be
provisioned — if the console offers trial-credit resources, decline them.

---

## 5. Features

Six. Each states the question it answers and what would be lost by cutting it.

### 5.1 Drop-off diagnosis — the flagship

**Question:** *Where exactly did we lose them, and what was on screen?*

The retention curve and the transcript render together on the video page,
locked to the same axis. Hovering the curve highlights the transcript line at
that moment; hovering a transcript line marks its position on the curve. The
system detects the sharpest sustained declines and labels them inline.

The AI layer then writes two or three sentences per marked drop, grounded in the
transcript at that timestamp — *"the steepest fall is 0:47–1:02, where the
script leaves the hook and starts on specification detail."* The model receives
the computed drop windows and the transcript; **it does not find the drops** —
the system does, arithmetically, so the finding is reproducible and the model
cannot invent one.

**Cut it and** the product is another metrics dashboard.

### 5.2 Hook performance

**Question:** *Which openings actually hold this client's audience?*

For every video, the first 15 seconds of transcript is stored alongside
retention at the 15-second mark (Tier A) or replay intensity over the opening
(Tier B). Across a client's library, the system computes retention-at-15s for
the top and bottom quartile by boost score, and the AI describes what the strong
openings have in common.

**Guard:** this claim is suppressed entirely below a sample of 8 scored videos
for that client, and the sample size is printed beside the claim whenever it is
shown. A pattern drawn from three videos is astrology.

### 5.3 Library search over what was actually said

**Question:** *Have we already covered this? What did we say about it?*

Postgres full-text search across every transcript, wired into the existing
`/content` search box so the same control finds a video by title **or** by
something said in it. Results show the matching line with its timestamp, linking
straight to that moment.

No AI, no API cost, no embeddings — `tsvector` handles a few thousand
transcripts instantly. This is the highest value-per-unit-effort item here.
(Semantic "find similar" via pgvector is deliberately deferred to §11.)

### 5.4 Comment themes and sentiment

**Question:** *What is the audience actually saying, without reading 400
comments?*

Comments arrive via the official API (1 unit per 100). The AI clusters them into
themes with counts, assigns an overall sentiment, and surfaces the negative
cluster separately — complaints are the actionable ones.

This fills `platform_posts.comment_sentiment`, a column that has existed since
the first content migration and has never once been written to.

### 5.5 What's working — the weekly client read

**Question:** *What should we tell the client on Monday, and what should the
team make next?*

Once a week, per client, the system computes — in code — the range's movers,
the boost distribution by format and length, retention averages, hook patterns,
and comment themes. The model receives **only that computed table** and writes
the read. Every number in the prose exists in the table; the model contributes
sentences, never figures.

Lands as a fifth tab in `/reports`, dated, with its inputs viewable.

### 5.6 Managed-channel depth (Tier A only)

**Question:** *Are we losing them before the video even starts?*

Where OAuth exists: impressions, click-through rate, traffic sources, and
relative retention performance. CTR against retention separates the two failure
modes that look identical from the outside — *nobody clicked* versus *everybody
clicked and left*. These are different problems with different fixes, and no
public data can tell them apart.

---

## 6. Data model

Five new tables, one new column. All workspace-scoped with RLS matching the
existing tables; the worker connects with the service key and is exempt, as the
sync runner already is.

```sql
-- 6.1 One transcript per post, with segment timings preserved.
video_transcripts (
  id, workspace_id, platform_post_id → platform_posts,
  source          text,   -- 'youtube_oauth' | 'youtube_public' | 'manual'
  language        text,
  is_generated    boolean,          -- auto-captions vs human
  full_text       text,             -- for FTS and LLM input
  segments        jsonb,            -- [{start_ms, dur_ms, text}]
  search_vector   tsvector generated,
  fetched_at, created_at
)
-- unique (platform_post_id) — one current transcript per post
-- index gin (search_vector)

-- 6.2 Retention/replay, 100 normalised buckets, tier recorded.
video_retention (
  id, workspace_id, platform_post_id → platform_posts,
  tier            text,   -- 'analytics_api' (true) | 'heatmap' (proxy)
  points          jsonb,  -- [{pct: 0.00..1.00, value: 0..1}]
  avg_view_pct    numeric,          -- Tier A only
  relative_perf   text,              -- Tier A only
  captured_at, created_at
)

-- 6.3 Comments, stored raw enough to re-analyse without refetching.
post_comments (
  id, workspace_id, platform_post_id, external_id,
  author, text, like_count, published_at, fetched_at
)

-- 6.4 Every AI output, versioned by prompt so a prompt change re-runs cleanly.
ai_analyses (
  id, workspace_id,
  subject_type    text,   -- 'post' | 'client' | 'video_drop'
  subject_id      uuid,
  kind            text,   -- 'drop_diagnosis' | 'comment_themes' | 'weekly_read' | 'hooks'
  prompt_version  int,
  model           text,
  input_digest    text,             -- hash of the exact inputs
  output          jsonb,            -- structured, never free prose alone
  input_tokens, output_tokens,
  created_at
)
-- unique (subject_type, subject_id, kind, prompt_version, input_digest)
--   ⇒ identical inputs are never paid for twice

-- 6.5 The queue. This table IS the worker's API.
ingest_jobs (
  id, workspace_id,
  kind            text,   -- 'transcript' | 'retention' | 'comments' | 'analyse' | 'weekly_read'
  subject_id      uuid,
  status          text,   -- 'pending' | 'running' | 'done' | 'failed' | 'skipped'
  attempts        int,
  not_before      timestamptz,      -- backoff / jitter scheduling
  last_error      text,
  priority        int,
  created_at, updated_at
)
-- index (status, not_before) where status = 'pending'

-- 6.6 One column on the existing table.
alter table accounts add column oauth_refresh_token text;  -- Tier A, encrypted at rest
```

`platform_posts.external_id` already holds the YouTube video id
([youtube.ts:340](src/lib/providers/youtube.ts:340)), so the join key for every
fetcher exists today. No change to the sync pipeline.

---

## 7. The AI layer

**7.1 — Provider-agnostic by contract.** One adapter: base URL, API key, model
name, all from environment. Targets an OpenAI-compatible chat-completions shape,
which every major provider (including Anthropic, via its compatibility surface)
speaks. Swapping providers is a config change, not a code change.

**7.2 — The model narrates; it never computes.** Every prompt receives a
pre-computed table of figures and is instructed to write only about what is in
it. No prompt ever asks the model to calculate a percentage, rank a list, or
decide what counts as a drop. This is the entire anti-hallucination strategy and
it is not negotiable: a marketing report that quietly invents a number is worse
than no report.

**7.3 — Structured output.** Every analysis returns JSON against a fixed schema
(claims, evidence, confidence, sample size), stored in `ai_analyses.output`. The
UI renders fields. A response that fails schema validation is retried once, then
marked failed — never rendered as raw text.

**7.4 — Paid once per input.** `input_digest` hashes the exact inputs. Same
transcript + same metrics + same prompt version = the stored result, no call.
Re-analysis happens when inputs change materially, when `prompt_version` is
bumped, or when an admin asks.

**7.5 — A hard monthly budget.** A configured token ceiling per calendar month.
At 80% the admin panel warns; at 100% the worker stops making calls and queues
instead. Since the LLM is the only cost in the entire platform, it is the only
thing that can produce a surprise bill — so it is the one thing with a hard stop.

**7.6 — Every claim is attributable.** Each rendered claim carries its sample
size and links to the videos behind it. A number with no path back to its source
does not ship.

---

## 8. Interface and visualisation

No new top-level pages. The system already has the right surfaces.

### 8.1 Video page (`/content/[id]`) — the retention + transcript panel

**The curve.** Single series, so an **area chart**, x = percent of video, y =
retention or replay intensity. One accent hue, filled at low opacity, 2px line,
recessive grid. Crosshair and tooltip on hover, reading *"38% through · 0:47 ·
62% still watching."* No legend — the title names the single series.

**Comparison, when it exists.** The client's median curve renders behind it in
the de-emphasis gray — **emphasis form**: this video in accent, context in gray.
Same unit, same axis. Never a second y-axis; the dual-axis chart is the most
common way to make a chart lie, and it is banned outright here.

**Never across tiers.** A Tier A curve and a Tier B curve are never drawn
together or compared. The panel header states the source in words: *"True
audience retention, from YouTube Analytics"* or *"Most-replayed intensity —
a relative proxy, not retention."*

**The transcript.** A scrolling list of timestamped lines beside the chart, each
line's left edge carrying a **sequential single-hue tint** for intensity at that
moment — light to dark, more-is-darker, never a rainbow. This is where the
"heatmap" earns its place: as a heat *strip against the words*, which is
actionable, rather than as a decorative band under a chart that repeats what the
curve already said. Hovering either side highlights the other.

**Drop markers.** Computed declines get a marker on the curve and a tinted band
on the transcript, with the AI's sentences inline beneath.

**Absent data is stated, not hidden.** "No retention data — this video hasn't
passed YouTube's threshold for published replay data." Silence reads as a bug.

### 8.2 Content list (`/content`)

The existing search box also searches transcripts; matches show the line and
timestamp. One new optional column, Tier A only: average view %. No other
change — the list is already dense.

### 8.3 Client page

Small multiples: the retention curves of the client's recent videos at sparkline
scale, same y-scale within the set, so the shape comparison is honest. Plus the
current "what's working" card.

### 8.4 Reports — a fifth tab, "Insights"

The weekly read per client, dated, with its computed inputs expandable beneath
the prose. Same range control as the other four tabs.

### 8.5 Data panel (`/data`)

Queue depth by kind, worker heartbeat age, last successful fetch per source,
block-detection state with cooldown remaining, month-to-date token spend against
budget, and per-video manual retry. Everything the operator needs to know
whether the machine is healthy, on one screen.

### 8.6 House rules that still apply

Per-platform metrics are never summed. Text wears ink tokens, never series
colour. Entrance-only motion, flattened under reduced-motion. Both themes are
designed, not flipped. Any new categorical palette runs through the validator
before it ships — though note that nearly every chart here is single-series or
emphasis, so almost no new categorical hues are introduced.

---

## 9. Capacity and cost

**Storage.** A 10-minute video's transcript is roughly 8–10 KB; a retention
curve is under 2 KB. The existing 202-video library is **≈2 MB**. At 30 new
videos a month, adding comments, that is well under 100 MB over five years —
against Supabase's 500 MB free allowance. Storage is a non-issue and no pruning
policy is needed.

**Quota.** Video lists and metadata: ~1 unit per 50 videos. Comments: 1 unit per
100. Analytics API: separate, generous quota. Total daily consumption stays
around 1% of the 10,000-unit allowance.

**Compute.** A few dozen outbound HTTP calls per day, paced deliberately.
Idle-adjacent on the smallest always-free shape.

**Egress.** Megabytes per month against a 10 TB allowance.

**LLM — the only cost.** Per new video: one drop diagnosis (~3–4k in, ~600 out)
and one comment analysis (~2–3k in, ~400 out). Per client per week: one read
(~4–6k in, ~800 out). At 30 new videos and 10 clients that is **roughly 250k–350k
input and 50k output tokens a month** — a small monthly figure at current rates
for a mid-tier model, and bounded absolutely by the §7.5 ceiling regardless.

The backfill of the existing 202 videos is a one-off of roughly 1M input tokens,
spread over days by the same throttle.

---

## 10. Failure modes

Designed for, not discovered later.

| Failure | Behaviour |
|---|---|
| Captions disabled on a video | Marked `unavailable`, retried twice with long backoff, then left alone. Never retried forever. |
| Public endpoint blocks our IP | Detected by response signature → Tier B fetchers pause for a cooldown, everything else continues, `/data` shows the state and the resume time. Auto-resumes. |
| Public endpoint changes shape | Parse failure is a *failed job with the payload logged*, not a crash. One alert, queue keeps draining. |
| OAuth token expired | Account flagged in `/data` with a reconnect action; that channel drops to Tier B until fixed. |
| LLM API down or over budget | Analyses stay queued; UI shows the last analysis with its date. Nothing renders as blank. |
| Oracle instance reclaimed or down | The app is unaffected — it only reads Supabase. Heartbeat age in `/data` makes the stall visible within minutes. |
| Worker dies mid-job | Jobs are leased with a timeout; an expired lease returns to `pending`. Every fetcher is idempotent. |

**Manual effort in steady state: none.** New videos are enriched within a day.
The only human actions that exist are the one-time OAuth connection per channel,
and pressing "retry" if something is stuck — which is optional, since the queue
retries itself.

---

## 11. Deliberately not built

Discipline is the feature. Each of these was considered and cut.

- **Social cross-link extraction** — the research proposed scraping a channel's
  linked Instagram/TikTok handles. The `accounts` table already holds every
  client's handle on every platform, entered by the team. This would scrape data
  we already have. **Zero value.**
- **Competitor and trend tracking at scale** — a different product
  (competitive intelligence), and by far the most block-prone use. Deferred as a
  named future phase, not smuggled in.
- **TikTok and Instagram transcripts** — no comparable endpoint exists; it would
  require downloading media and paying for speech-to-text, adding storage,
  cost, and fragility. **However**, the AI layer reads whatever text those
  platforms *do* have — captions, hashtags — so comment analysis and the weekly
  read cover all three platforms from day one. Only §5.1's drop diagnosis is
  YouTube-only, and it says so.
- **Semantic search / embeddings** — full-text search (§5.3) answers the real
  question at zero cost. Revisit only if FTS is demonstrably missing results;
  pgvector on Supabase makes it a later addition, not a rewrite.
- **A second database on Oracle** — see §4.3.
- **Auto-generated chapters** — the transcript already gives timestamped
  sections; a separate chapter feature is decoration.
- **Synchronous "analyse now" in the UI** — would push long calls onto Vercel
  and make cost unpredictable. Everything queues.

---

## 12. Implementation prompts

Staged. Each ships independently and leaves the system working. **Verification
bar for every stage:** tsc clean · lint 0 errors · build passes · all unit
suites · RLS suite extended for new tables · every new page proven with an
authenticated render probe before it is called done.

**P1 — Tier A connection.** OAuth per YouTube account, refresh tokens stored
encrypted, `/data` connect + status UI, Analytics API client with retention,
avg view %, impressions and CTR. Nothing scraped. Deliver value before touching
anything fragile.

**P2 — Schema and queue.** The five tables and one column from §6, RLS
policies, `ingest_jobs` with leasing and backoff, and a job-enqueue helper the
app calls. No worker yet; jobs simply accumulate.

**P3 — The worker.** The Oracle service: poll loop, heartbeat, lease handling,
Tier A fetchers, throttle with jitter, block detection with cooldown, structured
logging. Deployment runbook committed to `docs/`. At this stage Tier A channels
fully enrich themselves.

**P4 — Tier B fetchers.** Public transcript and heat-marker fetchers behind the
same queue, strictly as fallback for videos with no Tier A source, isolated so
their failure is contained. Version-pin the transcript library and verify its
call surface against the installed version — the API changed shape in its 1.x
line, and code written against the older static-method form will not run.

**P5 — Retention + transcript UI.** The §8.1 panel: area chart, aligned
transcript, tinted heat strip, drop markers, source labelling, tier separation,
empty states. Transcript FTS wired into `/content` search. No AI yet — this must
be valuable with the model switched off.

**P6 — The AI layer.** Adapter, prompt versioning, structured output with schema
validation, `input_digest` caching, budget ceiling and enforcement. Drop
diagnosis and comment themes first, since both are per-video and cacheable.

**P7 — Insights.** Hook analysis with its sample-size guard, the weekly client
read, the fifth Reports tab, and the client-page cards. The scheduled weekly job.

**P8 — Backfill and hardening.** Throttled backfill of the existing library
across days, the full `/data` operations panel, failure-mode tests (simulated
block, expired token, budget exhaustion, worker death mid-job), and the
end-to-end authenticated probe.

---

## 13. Open questions

1. **Which client channels can the agency get OAuth on?** This is the single
   highest-leverage answer in the document — every channel that can jump to
   Tier A gets better data permanently, with no scraping risk. Worth asking the
   clients directly.
2. **Which LLM provider and model?** The adapter is provider-agnostic, but the
   budget in §9 and the prompt tuning both assume a mid-tier model. Cheapest
   sensible default until told otherwise.
3. **Should the weekly read be emailed?** It is designed as an in-app tab
   because there is no email capability anywhere in the platform today. Adding
   one (Resend's free tier fits) is a small, separate piece of work — but it is
   what turns "automated client reports" from *available* into *delivered*.
4. **Does the client see any of this?** The `/portal` surface exists for client
   users. Exposing a curated read there is plausible and cheap, but it changes
   the audience for the writing and should be a deliberate decision.
