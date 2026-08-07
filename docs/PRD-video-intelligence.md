# PRD — Video Intelligence (v2.0)

**Status:** design only. Nothing here is built.
**Depends on:** the unified performance surface (PRD-unified-performance v0.5, shipped).
**Cost envelope:** one paid item — the external LLM API. Everything else stays
inside permanently-free tiers: Vercel Hobby, Supabase Free, Oracle Cloud
**Always Free** (never the 30-day $300 trial).

> **HARD CONSTRAINT — no OAuth, ever.** The agency does not and will not hold
> owner access to client YouTube channels. Every feature in this document works
> from public data only. Nothing may be designed, staged, or "left ready" for a
> channel-owner API. v1.0 of this PRD was built around an OAuth tier; §2 records
> what that removal costs, because the honest accounting matters more than the
> feature list.

---

## 1. The thesis

The system already knows *what was made*, *who made it*, *how it performed*, and
*how that compares to the account's own baseline*. It does not know **what is
actually said in the video**.

That one addition — the transcript, joined to the performance model already in
place — is what turns a metrics dashboard into something that can answer the
question the agency is paid to answer:

> *Not "did this video do well" — but "what do the ones that work have in
> common, and what should the next script do differently."*

Two hundred videos of transcript sitting next to two hundred boost scores is a
corpus with an outcome variable attached. That is a genuinely rare asset, and no
part of it requires permission from anyone.

Replay data (§3) is a bonus layer on top, available for some videos, never
depended upon. Everything else in here earns its place against the thesis or is
cut — §11 lists what was cut and why.

---

## 2. What no-OAuth costs, stated plainly

Removing owner access is not a small trim. Recorded here so nobody later
mistakes an absent feature for an oversight:

| Lost | Consequence |
|---|---|
| **True audience retention** | We cannot know where viewers *left*. The replay map (§3) is a different, weaker measurement and is never presented as retention. |
| **Impressions and click-through rate** | We cannot separate *nobody clicked* from *everybody clicked and left*. Thumbnail and title effectiveness becomes unmeasurable — which is why §11 cuts thumbnail analysis rather than faking it. |
| **Traffic sources, demographics, subscriber attribution** | No answer to "where did this audience come from." |
| **Official caption download** | Transcripts come only from the public endpoint, which puts them on the fragile path (§3). |
| **A stable, in-terms data route** | Everything now depends on undocumented endpoints. Block tolerance stops being a nicety and becomes a core requirement (§10). |

**The strategic consequence:** the product's centre of gravity moves from
*retention analysis* to *transcript-corpus analysis*. That is a defensible place
to stand — the corpus is proprietary, the outcome variable already exists, and
no competitor dashboard has both. But the design must stop leaning on a curve it
will frequently not have.

---

## 3. What is actually obtainable, and how reliable it is

| Data | Route | Cost | Reliability |
|---|---|---|---|
| Video lists, metadata, duration, stats | **Official API v3** — uploads playlist | ~1 unit / 50 videos | Stable, in-terms |
| Comments | **Official API v3** — `commentThreads` | 1 unit / 100 | Stable, in-terms |
| Description-derived chapters | Already fetched with metadata | free | Stable |
| **Transcript** | Public `timedtext` endpoint | free | **Undocumented, blockable** |
| **Replay intensity ("most replayed")** | Public player response | free | **Undocumented, blockable, often absent** |

**3.1 — The official API already covers more than the research suggested.**
Listing a channel's videos costs 1 unit per page of 50 via the uploads playlist,
not 100 via `search.list`; this codebase already does the cheap thing, with the
reasoning at [youtube.ts:256](src/lib/providers/youtube.ts:256). Comments are 1
unit per 100. So metadata and comments need no scraping at all, stay inside
terms, and consume roughly 1% of the daily quota.

**3.2 — What "most replayed" actually measures, because getting this wrong
would put false advice in a client report.** The heat markers are ~100 buckets
of *relative replay intensity* across the video's duration. A peak means that
segment was **re-watched or scrubbed back to** more than others. It is **not**
audience retention, and a low region does **not** reliably mean people left
there — it means that stretch wasn't replayed.

The system therefore presents it as an **attention map**: *"these are the moments
your audience went back to."* That claim is true, useful, and defensible to a
client. "This is where you lost them" would be neither true nor defensible, and
is banned from the UI copy and from every prompt.

**3.3 — Replay data is frequently absent.** YouTube only publishes heat markers
for videos above a view threshold. For a typical agency library a large share
will have none. Absence is the normal case, designed for as such, and no feature
may depend on its presence.

**3.4 — The x-axis is percent of video**, not seconds — ~100 buckets spread
across the duration regardless of length. This makes videos of different lengths
directly comparable, which is what the small-multiples view in §8.3 relies on.

**3.5 — On terms of service, once and plainly.** The transcript and replay
endpoints sit outside YouTube's published terms, can change without notice, and
are blocked on IP reputation rather than on request volume. There is no version
of this feature set that avoids that, now that owner access is off the table.
The architecture's answer is to make the footprint genuinely tiny (§9: about
**two requests a day** in steady state), to cache permanently so nothing is ever
fetched twice, and to degrade to a manual paste rather than to a broken page.

---

## 4. Architecture — what runs where, and why

Four components. One costs money, and it is not infrastructure.

```
┌─ Vercel (Hobby, free) ──────────────────────────────────────┐
│  The Next.js app. Reads Supabase. Renders charts.           │
│  Writes JOB ROWS. Never calls YouTube. Never calls the LLM. │
└────────────────────────┬────────────────────────────────────┘
                         │
┌─ Supabase (Free) ──────▼────────────────────────────────────┐
│  The ONLY database. Transcripts, replay maps, analyses and  │
│  the job queue all live beside the data they describe.      │
└────────────────────────▲────────────────────────────────────┘
                         │  polls for jobs, writes results
┌─ Oracle Always Free ───┴────────────────────────────────────┐
│  The Intelligence Worker: scheduler, fetchers, LLM caller.  │
│  ZERO inbound ports. Outbound only. Fully stateless.        │
└────────────────────────┬────────────────────────────────────┘
                         │
                    External LLM API  ← the only paid line item
```

**4.1 — Why a separate machine.** Three hard constraints, not preference:
Vercel's IP ranges are among the most aggressively blocked by YouTube;
serverless functions time out long before a backfill finishes; and Hobby cron
fires once a day, which cannot pace a throttled queue. A machine whose IP we
control is now load-bearing, because the fragile path has no fallback above it.

**4.2 — The job queue is the API.** The worker exposes **no HTTP endpoint at
all**. It polls a Supabase table, does the work, writes results back. An admin
pressing "Fetch transcript" inserts a row. No inbound firewall rules, no public
service, no TLS certificates, no auth layer to get wrong, no attack surface.
Manual-trigger latency is one poll interval (30s), which is irrelevant for work
measured in hours.

**4.3 — One database, deliberately.** Oracle's Always Free tier includes two
Autonomous Databases. **We use neither.** The data is tiny (§9) and a second
store would mean two sources of truth, a sync path, and a class of bug that does
not currently exist.

**4.4 — The worker is stateless and disposable.** All state lives in Supabase.
The instance holds code and two secrets, nothing else. If Oracle reclaims it,
the region runs out of capacity, or the IP gets burned, the recovery is: run the
provisioning script on a new instance. **The provisioning script is committed to
the repo and is the only deployment artifact.** This turns every Oracle
reliability quirk from an incident into a chore.

**4.5 — Which Oracle shape.** The workload is a few dozen outbound HTTP calls a
day — I/O-bound, not compute-bound. It fits comfortably on an **always-free AMD
micro** (1 OCPU / 1 GB), which is reliably available. Take an **Ampere A1** if
capacity exists, but never design for it. §14 covers provisioning in detail.

**4.6 — Idle reclamation.** Oracle may stop Always Free compute judged idle over
a 7-day window, and a worker that sleeps 23 hours a day looks exactly like an
idle instance. The worker therefore runs a continuous light poll loop with a
heartbeat row rather than a cron that fires and exits — which also gives §10 its
liveness signal for free.

**4.7 — Secrets.** The LLM API key and the Supabase service key live **only** on
the Oracle box. Neither is ever added to Vercel's environment, so neither can
reach a client bundle or an edge function. The browser never sees a model call.

---

## 5. Features

Five. Each states the question it answers and what would be lost by cutting it.
They are ordered by how much they depend on the fragile path — the first three
work on data that is reliably obtainable.

### 5.1 Library search over what was actually said — the spine

**Question:** *Have we covered this before? What did we say about it? Which
videos mention this product, objection, or phrase?*

Postgres full-text search across every transcript, wired into the existing
`/content` search box so one control finds a video by title **or** by something
said inside it. Results show the matching line with its timestamp and link
straight to that moment.

No AI, no API cost, no embeddings — `tsvector` handles a few thousand
transcripts instantly. Highest value per unit of effort in this document, and it
works the moment a transcript exists.

**Cut it and** the transcripts are a database column nobody ever reads.

### 5.2 What works — the corpus analysis

**Question:** *What do our best-performing videos have in common, and what
should the next script do?*

The system computes, **in code**, the split between the top and bottom quartile
of a client's videos by the existing boost score, and derives from the
transcripts: opening structure (the first 15 seconds), length, question-vs-claim
openings, topic distribution, and where the call-to-action lands. The model then
receives that computed table and writes the read. Every figure in the prose
exists in the table; the model contributes sentences, never numbers.

**Sample-size guard:** suppressed entirely below 8 scored videos for that
client, and the sample size prints beside every claim. A pattern drawn from
three videos is astrology.

**Cut it and** the corpus has no outcome variable attached to it — which is the
only thing making it more valuable than a folder of subtitle files.

### 5.3 Comment themes and sentiment

**Question:** *What is the audience actually saying, without reading 400
comments?*

Comments arrive via the official API. The model clusters them into named themes
with counts, assigns an overall sentiment, and surfaces the negative cluster
separately — complaints are the actionable ones.

This finally fills `platform_posts.comment_sentiment`, a column that has existed
since the first content migration and has never once been written to.

Works on all three platforms wherever comment text is available, not just
YouTube.

### 5.4 The attention map (where replay data exists)

**Question:** *Which moments did the audience go back to, and what was said
there?*

The replay curve and the transcript render together on the video page, locked to
the same axis. Hovering the curve highlights the transcript line at that moment;
hovering a line marks its position on the curve. The system identifies the
strongest sustained peaks arithmetically; the model then describes what is being
said at each — *"the most replayed moment is 0:47–1:02, where the price
comparison is stated."*

Framed throughout as **replayed moments**, never as retention or drop-off
(§3.2). Absent for many videos, and says so.

### 5.5 The weekly client read

**Question:** *What do we tell the client on Monday, and what should the team
make next?*

Once a week per client, the system computes the range's movers, the boost
distribution by format and length, the §5.2 corpus findings, and the comment
themes. The model receives only that computed table and writes the read.

Lands as a fifth tab in `/reports`, dated, with its inputs viewable beneath.

---

## 6. Data model

Five new tables. All workspace-scoped with RLS matching the existing tables; the
worker connects with the service key and is exempt, as the sync runner already
is. **No OAuth token storage anywhere** — there is no column for it, by design.

```sql
-- 6.1 One transcript per post, segment timings preserved.
video_transcripts (
  id, workspace_id, platform_post_id → platform_posts,
  source          text,   -- 'public' | 'manual'
  language        text,
  is_generated    boolean,          -- auto-captions vs human-written
  full_text       text,             -- FTS + LLM input
  segments        jsonb,            -- [{start_ms, dur_ms, text}]
  search_vector   tsvector generated,
  fetched_at, created_at
)
-- unique (platform_post_id)
-- index gin (search_vector)

-- 6.2 Replay intensity. NOT retention -- the column name says so.
video_replay_map (
  id, workspace_id, platform_post_id → platform_posts,
  points          jsonb,  -- [{pct: 0.00..1.00, intensity: 0..1}]
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
  subject_type    text,   -- 'post' | 'client'
  subject_id      uuid,
  kind            text,   -- 'attention_map' | 'comment_themes' | 'corpus' | 'weekly_read'
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
  kind            text,   -- 'transcript' | 'replay' | 'comments' | 'analyse' | 'weekly_read'
  subject_id      uuid,
  status          text,   -- 'pending' | 'running' | 'done' | 'failed' | 'unavailable'
  attempts        int,
  not_before      timestamptz,      -- backoff and jitter scheduling
  last_error      text,
  priority        int,
  created_at, updated_at
)
-- index (status, not_before) where status = 'pending'
```

`platform_posts.external_id` already holds the YouTube video id
([youtube.ts:340](src/lib/providers/youtube.ts:340)), so every fetcher's join
key exists today. No change to the sync pipeline.

---

## 7. The AI layer

**7.1 — Provider-agnostic by contract.** One adapter: base URL, API key, model
name, all from environment. Targets an OpenAI-compatible chat-completions shape,
which every major provider speaks. Changing provider is a config change.

**7.2 — The model narrates; it never computes.** Every prompt receives a
pre-computed table and is instructed to write only about what is in it. No
prompt asks the model to calculate a percentage, rank a list, or decide what
counts as a peak. This is the entire anti-hallucination strategy and it is not
negotiable: a client report that quietly invents a number is worse than no
report.

**7.3 — Structured output.** Every analysis returns JSON against a fixed schema
(claims, evidence, confidence, sample size). The UI renders fields. A response
failing validation is retried once, then marked failed — never rendered raw.

**7.4 — Paid once per input.** `input_digest` hashes the exact inputs. Same
transcript + same metrics + same prompt version = the stored result, no call.

**7.5 — A hard monthly budget.** A configured token ceiling per calendar month.
At 80% the admin panel warns; at 100% the worker queues instead of calling.
Since the LLM is the only cost in the platform, it is the only thing that can
produce a surprise bill — so it gets a hard stop, not a warning.

**7.6 — Vocabulary is constrained by prompt.** Every prompt touching replay data
is given the §3.2 framing and forbidden the words *retention*, *drop-off*, and
*audience left*. Getting this wrong would put a false claim in front of a paying
client.

**7.7 — Every claim is attributable.** Each rendered claim carries its sample
size and links to the videos behind it.

---

## 8. Interface and visualisation

No new top-level pages. The system already has the right surfaces.

### 8.1 Content list (`/content`)

The existing search box also searches transcripts; matches show the line and its
timestamp. A small transcript indicator per row (present / none / pasted), since
knowing what the corpus covers is itself operationally useful.

### 8.2 Video page (`/content/[id]`) — transcript, and the attention map when it exists

**The transcript panel is the primary addition** and renders whenever a
transcript exists, independent of replay data. Timestamped lines, searchable
within the page, each linking to that moment in the embedded player.

**The attention curve, when present.** Single series, so an **area chart**: x =
percent of video, y = replay intensity. One accent hue at low fill opacity, 2px
line, recessive grid, crosshair and tooltip on hover reading *"38% through ·
0:47 · replayed heavily."* No legend — the title names the single series. The
panel header states what it is in words: **"Most-replayed moments — a relative
attention signal, not audience retention."**

**Never a second y-axis.** Replay intensity is never overlaid with views,
engagement, or anything else on a shared plot. The dual-axis chart is the most
common way to make a chart lie and is banned here outright.

**The transcript carries the heat.** Each line's left edge takes a **sequential
single-hue tint** — light to dark, more-is-darker, never a rainbow — for
intensity at that moment. This is where a heat encoding earns its place: against
the words, where it is actionable, rather than as a decorative band repeating
what the curve already said. Hovering either side highlights the other.

**Peak markers** on the curve with tinted bands on the transcript, the model's
sentences inline beneath.

**Absence is stated, not hidden.** *"No replay data — YouTube only publishes it
for videos above a view threshold."* Silence reads as a bug; a sentence reads as
a system that knows what it knows.

### 8.3 Client page

Small multiples of the client's recent attention curves at sparkline scale, on a
shared y-scale within the set so shape comparison is honest — the percent-of-video
x-axis (§3.4) is what makes videos of different lengths comparable at all. Plus
the §5.2 corpus card.

### 8.4 Reports — a fifth tab, "Insights"

The weekly read per client, dated, computed inputs expandable beneath the prose.
Same range control as the other four tabs.

### 8.5 Data panel (`/data`)

Queue depth by kind, worker heartbeat age, last successful fetch per source,
block-detection state with cooldown remaining, month-to-date token spend against
budget, transcript coverage (how many videos have one), and per-video manual
retry. Everything needed to judge whether the machine is healthy, on one screen.

**Manual transcript paste** lives here and on the video page. With no official
caption route, this is a real feature and not a fallback afterthought: a
30-second paste permanently fixes any video the fetcher cannot reach, and the
pasted transcript feeds every other feature identically.

### 8.6 House rules that still apply

Per-platform metrics are never summed. Text wears ink tokens, never series
colour. Entrance-only motion, flattened under reduced-motion. Both themes
designed, not flipped. Nearly every chart here is single-series or emphasis, so
almost no new categorical hues are introduced; any that are run through the
palette validator before shipping.

---

## 9. Capacity and cost

**Request footprint — the number that decides whether blocking is a real risk.**
Transcripts are fetched **once and never again** (captions do not change). Replay
maps are fetched **once, when the video is ~28 days old** and its numbers have
matured, then only on manual request. At ~30 new videos a month that is **about
60 fragile requests a month — two a day**, paced with jitter across the day.
That is a genuinely tiny footprint. It is not a guarantee (§3.5), but it is the
difference between a system that looks like a person and one that looks like a
scraper.

**Storage.** A 10-minute transcript is ~8–10 KB; a replay map is under 2 KB. The
existing 202-video library is **≈2 MB**. With comments and five years of growth
it stays well under 100 MB against Supabase's 500 MB free allowance. No pruning
policy is needed.

**Quota.** Metadata ~1 unit per 50 videos, comments 1 unit per 100 — roughly 1%
of the 10,000-unit daily allowance.

**Compute and egress.** A few dozen HTTP calls a day; megabytes a month against
a 10 TB allowance.

**LLM — the only cost.** Per new video: one attention-map narration where replay
data exists (~3–4k in, ~600 out) and one comment analysis (~2–3k in, ~400 out).
Per client per week: one read (~4–6k in, ~800 out), plus a monthly corpus
analysis per client (~8–12k in, ~1k out). At 30 new videos and 10 clients:
**roughly 300–400k input and 60k output tokens a month** — a small monthly figure
at current rates for a mid-tier model, and bounded absolutely by §7.5.

**Backfill** of the existing 202 videos is a one-off of roughly 1M input tokens
and ~400 fragile requests, spread across weeks by the same throttle.

---

## 10. Failure modes

Now that the fragile path has no tier above it, this section is load-bearing.

| Failure | Behaviour |
|---|---|
| Captions disabled on a video | Marked `unavailable`, retried twice with long backoff, then left alone permanently. The video page offers manual paste. |
| Replay data not published | Marked `unavailable` — the normal case, not an error. Retried once at 90 days in case the video crossed the threshold. |
| Our IP gets blocked | Detected by response signature → fragile fetchers pause for a cooldown; official-API work, AI analysis and the whole app continue. `/data` shows the state and resume time. Auto-resumes. Escalation path in §10.1. |
| Endpoint changes shape | Parse failure is a *failed job with the payload logged*, not a crash. Queue keeps draining; `/data` surfaces the pattern. |
| Transcript library API changes | Version-pinned, with the call surface verified at install (§12 P3). |
| LLM API down or over budget | Analyses queue; UI shows the last analysis with its date. Nothing renders blank. |
| Oracle instance reclaimed or lost | The app is unaffected — it only reads Supabase. Heartbeat age in `/data` makes the stall visible in minutes; recovery is re-running the provisioning script (§4.4). |
| Worker dies mid-job | Jobs are leased with a timeout; expired leases return to `pending`. Every fetcher is idempotent. |

**10.1 — If the IP is burned for good.** Three escalations, in order: rotate the
instance's ephemeral public IP (free on Oracle, may or may not land in a cleaner
range); fall back to manual paste for the affected videos, which keeps every
downstream feature working; or route the fragile fetchers through a cheap
rotating proxy — the only line item that would ever push this system past "LLM
is the sole cost," and explicitly a last resort, not a default.

**Manual effort in steady state: none.** New videos enrich themselves within a
day. The only human action that ever exists is pasting a transcript for a video
whose captions are disabled — and even that is optional; everything else about
the video still works.

---

## 11. Deliberately not built

Discipline is the feature. Each was considered and cut.

- **Anything requiring channel-owner access** — hard constraint. Not staged, not
  scaffolded, not left half-wired.
- **Thumbnail or title effectiveness analysis** — without click-through rate
  there is no outcome variable to correlate against, so any finding would be a
  guess dressed as analysis. This is a direct casualty of no-OAuth and is listed
  here rather than shipped hollow.
- **Social cross-link extraction** — the research proposed scraping a channel's
  linked handles. The `accounts` table already holds every client's handle on
  every platform. This would scrape data we have. **Zero value.**
- **Competitor and trend tracking at scale** — a different product, and by far
  the most block-prone use of the fragile path we now fully depend on. Named
  future phase, not smuggled in.
- **TikTok and Instagram transcripts** — no comparable endpoint; would need
  media download plus paid speech-to-text, adding cost, storage and fragility.
  **However**, comment analysis and the weekly read cover all three platforms
  from day one using the text those platforms do expose. Only §5.1, §5.2 and
  §5.4 are YouTube-only, and the UI says so.
- **Semantic search / embeddings** — full-text search answers the real question
  at zero cost. Revisit only if FTS demonstrably misses results; pgvector makes
  it a later addition, not a rewrite.
- **A second database on Oracle** — see §4.3.
- **Synchronous "analyse now"** — would put long calls on Vercel and make cost
  unpredictable. Everything queues.

---

## 12. Implementation prompts

Staged; each ships independently and leaves the system working. **Verification
bar for every stage:** tsc clean · lint 0 errors · build passes · all unit
suites · RLS suite extended for new tables · every new surface proven with an
authenticated render probe before it is called done.

**P1 — Schema and queue.** The five tables from §6, RLS policies, `ingest_jobs`
with leasing and backoff, and the enqueue helper the app calls. No worker yet;
jobs accumulate harmlessly.

**P2 — The worker skeleton.** The Oracle service: poll loop, heartbeat, lease
handling, jitter throttle, block detection with cooldown, structured logging,
and the **committed provisioning script** (§4.4). First real job kind is
`comments`, because it runs on the official API — proving the whole pipeline
end to end without touching anything fragile.

**P3 — Transcripts.** The public fetcher behind the same queue. Version-pin the
library and **verify its call surface against the installed version** — its API
changed shape across major versions, and code written against the older
static-method form will not run. Manual paste UI ships in the same stage, so a
failed fetch always has a human path.

**P4 — Search.** Transcript FTS wired into `/content` search, with timestamped
result lines. No AI. This must be valuable with the model switched off — if it
is not, the corpus is not worth what it costs to gather.

**P5 — The replay map.** Fetcher at 28-day maturity, the §8.2 chart, the tinted
transcript strip, peak detection, cross-highlighting, and the empty state that
explains absence. Still no AI.

**P6 — The AI layer.** Adapter, prompt versioning, schema-validated structured
output, `input_digest` caching, budget ceiling and enforcement, and the §7.6
vocabulary constraints. Comment themes and attention-map narration first — both
per-video and cacheable.

**P7 — Insights.** Corpus analysis with its sample-size guard, the weekly client
read, the fifth Reports tab, the client-page cards, and the weekly schedule.

**P8 — Backfill and hardening.** Throttled backfill across weeks, the full
`/data` operations panel, and failure-mode tests: simulated block, endpoint
shape change, budget exhaustion, worker death mid-job.

---

## 13. Open questions

1. **Which LLM provider and model?** The adapter is provider-agnostic, but §9's
   budget and the prompt tuning assume a mid-tier model.
2. **Should the weekly read be emailed?** It is designed as an in-app tab
   because the platform has no email capability today. Adding one (Resend's free
   tier fits) is small, separate work — but it is what turns "automated client
   reports" from *available* into *delivered*.
3. **Does the client see any of this?** `/portal` exists for client users.
   Exposing a curated read there is cheap, but it changes who the writing is for
   and should be a deliberate decision.
4. **Is manual paste acceptable as the standing fallback?** If the team will not
   paste transcripts for videos with captions disabled, those videos simply stay
   outside the corpus — which is fine, but the coverage number in `/data` should
   then be read as a permanent ceiling rather than a backlog.

---

## 14. Oracle provisioning notes

Operational detail that determines whether this stays free. Verify current
allowances at signup — Oracle revises them.

**14.1 — The home region is permanent and cannot be changed.** Always Free
resources exist only there. **Choose Singapore (`ap-singapore-1`)** to sit beside
the rest of the stack (Supabase and Vercel are both Singapore), which keeps the
worker's database round-trips local.

**14.2 — Signing up needs a card for identity verification.** A small temporary
authorisation, typically refunded. It is not a charge, and it surprises people.

**14.3 — The account starts on a 30-day trial with credits, then converts.**
This is the one that matters for the cost constraint. To land purely on Always
Free: **only ever provision shapes the console explicitly labels "Always Free
Eligible."** Anything else is trial-funded and gets reclaimed at conversion. Do
not upgrade to Pay As You Go — upgrading is what makes ARM capacity reliably
available, and also what makes overspending possible.

**14.4 — Take the AMD micro; treat ARM as a bonus.** `VM.Standard.E2.1.Micro`
(1 OCPU, 1 GB) is reliably available and is sized correctly for this workload
(§4.5). Ampere A1 capacity requests frequently fail with "out of host capacity"
on free accounts, sometimes for weeks. Do not let the project wait on it.

**14.5 — Save the SSH private key at instance creation.** It is offered once. A
lost key means rebuilding the instance — cheap here, since the worker is
stateless (§4.4), but avoidable.

**14.6 — No inbound ports are needed beyond SSH.** The design (§4.2) polls
outward and serves nothing, so the default security list needs no changes at
all. Worth knowing that Oracle's images also carry local firewall rules on top
of the cloud security list — a classic source of "I opened the port and it still
doesn't work." It never bites us, because we open nothing.

**14.7 — Guard against idle reclamation** (§4.6): the continuous poll loop
handles it. A once-daily cron would not.

**14.8 — Keep swap on the micro.** 1 GB is workable for a poller but leaves no
headroom; a small swap file is free insurance.

**14.9 — Treat the instance as cattle.** Provisioning script in the repo,
secrets injected at deploy, `systemd` unit with `Restart=always`, unattended
security upgrades. Nothing on that box is ever the only copy of anything.
