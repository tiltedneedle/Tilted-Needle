# PRD — Video Intelligence (v4.0)

**Status:** design complete. Nothing is built. The Oracle tenancy is live and
verified (§14) — provisioning is the next action, not a research question.
**Depends on:** the unified performance surface (PRD-unified-performance v0.5, shipped).
**Cost envelope:** one paid item — the external LLM API. Everything else stays
inside permanently-free tiers: Vercel Hobby, Supabase Free, Oracle Cloud
**Always Free** (never the 30-day $300 trial).

> **HARD CONSTRAINT — no OAuth, ever.** The agency does not and will not hold
> owner credentials for client channels. No feature may depend on a
> channel-owner API. This is not merely a design rule: **the codebase currently
> contains a working OAuth surface**, and §0 removes it. Nothing may be left
> scaffolded, dormant, or "ready for later."

---

## 0. First: delete the OAuth that already exists

An audit for this revision found live OAuth machinery in the shipped product.
Leaving it in place while claiming the constraint would be a lie in the
codebase, and every dormant credential path is a security surface nobody is
watching.

| What exists today | Disposition |
|---|---|
| `src/app/api/oauth/[provider]/{connect,callback,disconnect}/route.ts` (283 lines) | **Delete** |
| `src/lib/connectors.ts` — `YOUTUBE_CLIENT_ID/SECRET`, `META_*`, `TIKTOK_*` | **Delete**; purge the vars from every environment |
| `oauth_connections` table + Supabase Vault secret references | **Drop** by migration; revoke any tokens still stored |
| `platforms.oauth_configured` column | **Drop** |
| `/accounts` connect / disconnect UI, `?oauth_connected`, `?oauth_error` states | **Remove**; `connection_mode` collapses to manual-vs-api-key |
| `post_analytics.source = 'oauth'` | Retain the **column**, retire the **value**; a check constraint permits `'manual' \| 'import' \| 'vision'` only |

**`post_analytics` itself stays — it is the single most valuable table in this
document (§2).** Only the OAuth route into it dies.

---

## 1. The thesis

The system knows *what was made*, *who made it*, *how it performed*, and *how
that compares to the account's own baseline*. Three things it does not know:

1. **What is actually said in the video** — the transcript.
2. **How each video behaved over its lifetime** — which is already sitting in
   `post_snapshots`, unread.
3. **What the platforms tell the owner but not the public** — which the client
   can simply hand over (§2).

Joined to the performance model already in place, those turn a metrics dashboard
into something that answers the question the agency is actually paid to answer:

> *Not "did this video do well" — but "what do the ones that work have in
> common, which platform suits which content, what is still earning six months
> later, and what should the next brief say."*

Two hundred transcripts beside two hundred boost scores is a proprietary corpus
with an outcome variable already attached. Nothing about it needs anyone's
permission.

---

## 2. Recovering what OAuth would have given us

The direct answer to *"can we get the lost features another way?"* — **yes, most
of them, and the schema was built for it before this PRD existed.**

`post_analytics` (migration `20260728160000`) already carries `impressions`,
`ctr`, `avg_watch_seconds`, `retention_30s`, `retention_60s`, **`retention_curve
jsonb`**, **`traffic_sources jsonb`**, and `subscribers_gained` — with a `source`
column whose original comment reads: *"'manual' lets a client's own Studio export
unlock scoring today, without waiting on Phase 6 credentials."* A manual entry
form is already wired into `ContentDetail`.

The insight the original author had, and which the no-OAuth constraint now makes
central: **the client owns this data and can give it to you.** A person
downloading a report is not an OAuth integration.

### 2.1 Three routes in, none of them OAuth

**Route A — CSV import (best).** YouTube Studio's Advanced Mode exports per-video
tables as CSV: views, **impressions**, **impressions click-through rate**,
average view duration, **average percentage viewed**, watch time, plus separate
traffic-source and geography reports. TikTok offers a comparable data download.
The client exports and sends; the agency drops the file into `/import`, which
already exists as a batch-import surface with `import_batches` behind it.

*Verify at implementation:* whether the per-video **retention curve** itself
exports cleanly. If it does not, the design loses nothing important — average
percentage viewed plus the 30s/60s markers already in the schema carry most of
the signal, and §5.10 degrades to those.

**Route B — screenshot extraction (for Instagram, and for lazy weeks).**
Instagram Insights has no clean CSV path, but it does have a screen the client
already screenshots. A vision-capable model reads the image and proposes the
numbers; **a human confirms every value before it is written.** This is the one
place OCR belongs in the product, and it is never trusted silently — extracted
values render in an editable form with the source image beside them.

**Route C — manual entry.** Already built. Stays as the floor.

All three write the same table with `source` recording which. Every downstream
feature reads the table, not the route.

### 2.2 What this recovers

| Thought lost in v2.0 | Recovered by |
|---|---|
| Impressions and click-through rate | Route A/B — **and with it the click-vs-stay diagnosis** (§5.8), the single most valuable thing OAuth offered |
| Average percentage viewed — real retention, summarised | Route A/B |
| Full retention curve | Route A where the export supports it; otherwise 30s/60s markers |
| Traffic sources | Route A |
| Thumbnail and title effectiveness | Recovered — CTR is the outcome variable that was missing, so §5.9 comes back off the cut list |
| Instagram reach, saves, shares | Route B — and `post_snapshots` already has idle `shares`, `saves`, `reach` columns waiting |

### 2.3 What stays genuinely gone

Anything requiring a live owner session that no export reproduces: real-time
data, subscriber identity, and per-video demographic breakdowns beyond what the
geography export gives. Accepted, and not worked around.

### 2.4 The honest catch

This converts a **technical** blocker into a **client-relations** one. The data
only exists if someone sends it. That is a problem the agency can actually
solve — and to make it solvable, §8.5 shows a per-client **data completeness**
indicator, so "chase EuroEyes for last month's export" is a visible task rather
than a thing nobody remembers.

Everything else in this document works whether or not a single client ever sends
a file.

---

## 3. The four data tiers, ordered by resilience

The product is deliberately structured so that **value degrades gracefully**. If
every fragile fetch fails forever and no client ever sends an export, Tiers 1
and 2 still deliver a materially better product than exists today.

| Tier | Source | Risk | Powers |
|---|---|---|---|
| **1** | Data **already in the database**, unread | None | Lifecycle, velocity, platform fit, metadata patterns, alerts |
| **2** | Official YouTube API v3 | None — stable, in-terms | Comments, themes, gaps, free enrichment |
| **3** | Client-supplied exports (§2) | Social, not technical | CTR, true retention, traffic sources |
| **4** | Public undocumented endpoints | Blockable, breakable | Transcripts, replay map |

**3.1 — The official API covers more than the research suggested.** Listing a
channel's videos costs 1 unit per 50 via the uploads playlist, not 100 via
`search.list`; this codebase already does the cheap thing, with the reasoning at
[youtube.ts:256](src/lib/providers/youtube.ts:256). Comments are 1 unit per 100.
Metadata and comments need no scraping, stay in terms, and use roughly 1% of the
daily quota.

**3.2 — Free enrichment we are not currently collecting.** All from calls the
sync already makes:

- **`contentDetails.caption`** — a boolean saying whether the video has captions
  *at all*. Checking it before queueing a transcript fetch avoids a wasted
  fragile request on every caption-less video. Directly reduces block exposure.
- **`topicDetails.topicCategories`** — YouTube's own topic labels, free, useful
  as a cross-check on model-derived topics.
- **`snippet.description`** — fetched today and **discarded**. It is free corpus
  text and the source of chapter timestamps.
- **Instagram caption text** — the provider fetches it and keeps only the first
  line as a title ([instagram.ts:76](src/lib/providers/instagram.ts:76)). The
  rest is thrown away. It is the only text those posts have.
- **Full publish timestamps** — the API returns an ISO datetime; `posted_at` is
  a `date`, truncating it. Keeping the time enables time-of-day analysis (§5.4).
  Cheap now, impossible to backfill later.
- *Verify:* whether `snippet.tags` is returned for third-party videos. If yes,
  free keyword signal; if not, nothing is lost.

**3.3 — What "most replayed" actually measures**, because getting this wrong
would put false advice in a client report. The heat markers are ~100 buckets of
*relative replay intensity*. A peak means that segment was **re-watched or
scrubbed back to**. It is **not** audience retention, and a trough does **not**
reliably mean people left. The system presents it as an **attention map** —
*"the moments your audience went back to"* — which is true, useful, and
defensible. "This is where you lost them" is banned from the UI copy and from
every prompt. Where a client export exists (Tier 3), that is the real retention
and is labelled as such; the two are never plotted together or compared.

**3.4 — Replay data is often absent.** YouTube publishes heat markers only above
a view threshold. Absence is the normal case and is designed for.

**3.5 — The x-axis is percent of video**, ~100 buckets across the duration
regardless of length — which is what makes videos of different lengths
comparable in §8.3.

**3.6 — On terms of service, once and plainly.** The transcript and replay
endpoints sit outside YouTube's published terms, can change without notice, and
are blocked on IP reputation rather than request volume. The architecture's
answer is a genuinely tiny footprint (§9: about **two requests a day**),
permanent caching so nothing is fetched twice, and degradation to manual paste
rather than to a broken page.

---

## 4. Architecture

```
┌─ Vercel (Hobby, free) ──────────────────────────────────────┐
│  The Next.js app. Reads Supabase. Renders charts.           │
│  Handles CSV/screenshot upload. Writes JOB ROWS.            │
│  Never calls YouTube. Never calls the LLM.                  │
└────────────────────────┬────────────────────────────────────┘
                         │
┌─ Supabase (Free) ──────▼────────────────────────────────────┐
│  The ONLY database. Transcripts, replay maps, analytics,    │
│  analyses and the job queue live beside the data they       │
│  describe.                                                  │
└────────────────────────▲────────────────────────────────────┘
                         │  polls for jobs, writes results
┌─ Oracle Always Free ───┴────────────────────────────────────┐
│  The Intelligence Worker: scheduler, fetchers, LLM caller.  │
│  ZERO inbound ports. Outbound only. Fully stateless.        │
└────────────────────────┬────────────────────────────────────┘
                         │
                    External LLM API  ← the only paid line item
```

**4.1 — Why a separate machine.** Vercel's IP ranges are among the most
aggressively blocked by YouTube; serverless functions time out long before a
backfill finishes; and Hobby cron fires once a day, which cannot pace a
throttled queue.

**4.2 — The job queue is the API.** The worker exposes **no HTTP endpoint**. It
polls a Supabase table, works, writes back. No inbound firewall rules, no public
service, no TLS certificates, no auth layer to get wrong, no attack surface.
Manual-trigger latency is one poll interval (30s).

**4.3 — One database, deliberately.** Oracle's Always Free tier includes two
Autonomous Databases. **We use neither.** The data is tiny (§9) and a second
store means two sources of truth and a class of bug that does not exist today.

**4.4 — The worker is stateless and disposable.** All state lives in Supabase;
the instance holds code and two secrets. If Oracle reclaims it, capacity
vanishes, or the IP is burned, recovery is running the provisioning script on a
new instance. **That script is committed to the repo and is the only deployment
artifact.** Every Oracle quirk becomes a chore rather than an incident.

**4.5 — Shape: take the A1.** Earlier revisions assumed Ampere capacity would be
unobtainable and designed for the AMD micro. **A live query against the tenancy
disproves that** (§14.4): `VM.Standard.A1.Flex` is offered in this region with
zero cores used. Provision **4 OCPU / 24 GB — the Always Free ceiling, not the
quota the console currently shows** (§14.5, which is a trap).

The workload does not need 24 GB. Two things might: the replay-map fetch may
require a headless browser if the player response proves unobtainable over plain
HTTP, and the one-off backfill goes faster with parallelism. On 1 GB, Chromium
is painful; on 24 GB it is a non-event. Taking the headroom costs nothing and
removes a design risk.

**The AMD micro (1 OCPU / 1 GB) remains the documented fallback**, because quota
availability is not the same as host capacity — only a launch attempt proves the
latter, and this region has exactly one availability domain to try (§14.3).

**4.6 — Idle reclamation.** Oracle stops Always Free compute judged idle over a
7-day window, and a worker sleeping 23 hours a day looks exactly like that. It
therefore runs a continuous light poll loop with a heartbeat row — which also
gives §10 its liveness signal for free.

**4.7 — Secrets.** The LLM key and the Supabase service key live **only** on the
Oracle box. Neither enters Vercel's environment, so neither can reach a client
bundle. The browser never sees a model call.

**4.8 — Vision extraction runs on the worker too.** A screenshot uploaded in the
browser goes to Supabase Storage, a job row is written, the worker calls the
vision model and writes a *draft* row for confirmation. No image is retained
after confirmation.

---

## 5. Features

Eleven, ordered by tier so the dependency structure is visible. Each states the
question it answers and what would be lost by cutting it.

### Tier 1 — from data already in the database

Zero new fetching, zero block risk, zero API cost. `post_snapshots` has been
accumulating daily readings since the system launched and nothing has ever read
it as a time series.

#### 5.1 Lifecycle: evergreen, spike, or second wind

**Question:** *Does this video keep earning, or did it burn out in a week?*

From each post's snapshot history: the view-velocity curve, **half-life** (days
to reach half of current views), **decay shape**, and **second-wind detection**
(re-acceleration after decay — the algorithm picking a video back up).
Classification per video: **spike** (front-loaded, dead in days), **evergreen**
(still accumulating months later), **sleeper** (slow start, later climb).

For an agency deciding what to make more of, "this format still earns nine
months later" is worth more than any single-day number — and the data has been
there all along.

**Cut it and** the snapshot history stays a chart nobody derives anything from.

#### 5.2 Expected-curve alerts

**Question:** *Is this new video over- or under-performing, while we can still
do something about it?*

Pool the client's history into a typical accumulation curve per platform, then
compare each new video against it at day 1, 3, 7. Flag material divergence in
both directions: an over-performer is a promotion opportunity while it is still
live; an under-performer is a lesson while the shoot is still fresh.

Also yields a **projected final view count** with an honest range.

#### 5.3 Platform fit

**Question:** *Which platform suits which kind of content, for this client?*

The data model already groups the same content across platforms —
`content_items` → many `platform_posts`. Nobody has ever asked it the obvious
question: the same edit scored 3.1× baseline on TikTok and 0.4× on YouTube.
Across a library, with transcripts attached, that becomes *"this client's
explainer content wins on YouTube; their behind-the-scenes wins on TikTok"* —
a scheduling and budgeting decision, not a vanity metric.

**Cut it and** a structural advantage of the existing schema goes unused.

#### 5.4 Metadata patterns

**Question:** *Do our titles, lengths, and posting days matter?*

Title shape (length, question vs statement, numerals, emoji), video duration,
and day-of-week — each correlated against the existing boost score, computed in
code. Requires the timestamp-precision fix in §3.2 for time-of-day.

Modest individually; together they are the cheapest reliable input to a brief.

### Tier 2 — official API only

#### 5.5 Comment themes and sentiment

**Question:** *What is the audience saying, without reading 400 comments?*

Comments arrive via the official API (1 unit per 100). The model clusters them
into named themes with counts, assigns sentiment, and surfaces the negative
cluster separately — complaints are the actionable ones. Finally fills
`platform_posts.comment_sentiment`, a column that has existed since the first
content migration and has never been written to.

#### 5.6 Content gaps

**Question:** *What is the audience asking for that we have not made?*

Cross-references recurring questions in comments against the transcript corpus.
*"Fourteen comments across six videos ask about aftercare; no video covers it."*
That is a commissioned video, sourced from the audience.

Degrades gracefully: with no transcripts it still surfaces recurring questions,
just without the have-we-covered-it check.

### Tier 3 — client-supplied exports (§2)

#### 5.7 The import pipeline

CSV import for Studio/TikTok exports, vision-assisted screenshot extraction with
mandatory human confirmation, and the existing manual form — all writing
`post_analytics`. Per-client completeness tracking (§8.5) so gaps are chaseable.

#### 5.8 Click versus stay — the diagnosis OAuth was wanted for

**Question:** *Did nobody click, or did everybody click and leave?*

CTR against average percentage viewed separates the two failure modes that look
identical from outside. **Low CTR, high retention** = the content works, the
packaging failed — fix the thumbnail and title. **High CTR, low retention** =
the packaging over-promised — fix the hook or the edit. Different problems,
different owners on the team, and no public metric can tell them apart.

This is the highest-value item in the document per unit of effort, and it needs
one CSV per client per month.

#### 5.9 Thumbnail and title effectiveness

**Question:** *Which packaging earns the click?*

Cut in v2.0 for lack of an outcome variable; restored because Route A supplies
CTR. Thumbnail attributes (face present, text overlay, contrast, framing) via
the vision model, plus title patterns from §5.4, correlated against **CTR** —
the correct denominator, not views.

Strictly gated: it renders only for clients with CTR data on ≥8 videos, prints
the sample size next to every claim, and pools across the workspace only when it
says so.

#### 5.10 True retention, where it exists

Where an export supplies a real curve, it renders in the §8.2 panel labelled
**"Audience retention, from the channel's own analytics"** — visually and
verbally distinct from the replay map, never on the same axis. Where only 30s /
60s markers exist, those render as two honest points rather than an interpolated
curve pretending to be one.

### Tier 4 — public undocumented endpoints

#### 5.11 The transcript corpus — search, analysis, briefs

**Question (a):** *Have we covered this? What did we say about it?*
Postgres full-text search across every transcript, wired into the existing
`/content` search box so one control finds a video by title **or** by something
said inside it. Results show the matching line and timestamp. No AI, no API
cost — `tsvector` handles thousands of transcripts instantly.

**Question (b):** *What do our best videos have in common?*
The system computes the top/bottom quartile split by boost score and derives
opening structure, length, topic distribution, and call-to-action placement. The
model receives that computed table and writes the read. **Suppressed below 8
scored videos per client**, with the sample size printed beside every claim.

**Question (c):** *So what should we make next?*
The brief generator: given the corpus findings, the content gaps (§5.6), and the
platform-fit read (§5.3), draft the next video brief — angle, hook direction,
target length, platform, and the evidence behind each choice. This is where the
model earns its cost, because it closes the loop from measurement to action.
Every line is traceable to a computed input.

**A transcript attaches to the `content_item`, not the post** (§6.1) — so the
YouTube cut's transcript describes the TikTok and Instagram posts of the same
edit, and transcript-driven analysis covers all three platforms wherever a
YouTube version exists.

#### 5.12 The attention map, and what to cut next

**Question:** *Which moments did the audience replay — and which 30 seconds is
our next Short?*

The replay curve and transcript render together, locked to the same axis, with
cross-highlighting. The system finds the strongest sustained peaks
arithmetically; the model describes what is said at each.

Then the part that pays for itself: **the highest-sustained-replay window of a
long video is the best available candidate for a Short or Reel.** The system
proposes the segment with its in/out timestamps and the transcript of that
window, ready to hand to an editor. Repurposing decisions currently made on
instinct become evidence-led, and the existing role credits mean the resulting
Short is already attributable to whoever cuts it.

---

## 6. Data model

All workspace-scoped with RLS matching existing tables; the worker uses the
service key and is exempt, as the sync runner already is. **No OAuth token
storage anywhere — §0 removes the table that had it.**

```sql
-- 6.1 Transcript per CONTENT ITEM, not per post: the same edit posted to three
--     platforms has one transcript, and it describes all three.
video_transcripts (
  id, workspace_id, content_item_id → content_items,
  source_post_id  uuid,             -- which platform post it was pulled from
  source          text,             -- 'public' | 'manual' | 'import'
  language        text,
  is_generated    boolean,
  full_text       text,
  segments        jsonb,            -- [{start_ms, dur_ms, text}]
  search_vector   tsvector generated,
  fetched_at, created_at
)
-- unique (content_item_id); index gin (search_vector)

-- 6.2 Replay intensity. NOT retention -- the table name says so.
video_replay_map (
  id, workspace_id, platform_post_id → platform_posts,
  points          jsonb,  -- [{pct: 0.00..1.00, intensity: 0..1}]
  captured_at, created_at
)

-- 6.3 Lifecycle, derived from post_snapshots. Materialised because every
--     dashboard read would otherwise re-derive it from the full series.
post_lifecycle (
  id, workspace_id, platform_post_id → platform_posts,
  shape             text,     -- 'spike' | 'evergreen' | 'sleeper' | 'unknown'
  half_life_days    numeric,
  peak_daily_views  bigint,
  days_to_peak      integer,
  second_wind_at    timestamptz,
  projected_views   bigint,
  vs_expected_pct   numeric,  -- +/- against the client's typical curve
  computed_at
)

-- 6.4 Comments, stored raw enough to re-analyse without refetching.
post_comments (
  id, workspace_id, platform_post_id, external_id,
  author, text, like_count, published_at, fetched_at
)

-- 6.5 Every AI output, versioned by prompt so a prompt change re-runs cleanly.
ai_analyses (
  id, workspace_id,
  subject_type    text,   -- 'post' | 'content_item' | 'client'
  subject_id      uuid,
  kind            text,   -- 'attention_map' | 'comment_themes' | 'corpus'
                          -- | 'weekly_read' | 'brief' | 'packaging' | 'gaps'
  prompt_version  int,
  model           text,
  input_digest    text,             -- hash of the exact inputs
  output          jsonb,            -- structured, never free prose alone
  input_tokens, output_tokens,
  created_at
)
-- unique (subject_type, subject_id, kind, prompt_version, input_digest)
--   ⇒ identical inputs are never paid for twice

-- 6.6 The queue. This table IS the worker's API.
ingest_jobs (
  id, workspace_id,
  kind            text,   -- 'transcript' | 'replay' | 'comments' | 'lifecycle'
                          -- | 'analyse' | 'vision_extract' | 'weekly_read'
  subject_id      uuid,
  status          text,   -- 'pending' | 'running' | 'done' | 'failed' | 'unavailable'
  attempts        int,
  not_before      timestamptz,
  last_error      text,
  priority        int,
  created_at, updated_at
)
-- index (status, not_before) where status = 'pending'

-- 6.7 Changes to existing tables.
alter table content_items  add column description   text;      -- free corpus (§3.2)
alter table content_items  add column topic_labels  text[];    -- topicCategories
alter table platform_posts add column has_captions  boolean;   -- skip futile fetches
alter table platform_posts add column posted_at_ts  timestamptz; -- full precision
alter table post_analytics add constraint source_no_oauth
  check (source in ('manual','import','vision'));
drop table oauth_connections;                                   -- §0
alter table platforms drop column oauth_configured;             -- §0
```

`platform_posts.external_id` already holds the YouTube video id
([youtube.ts:340](src/lib/providers/youtube.ts:340)), so every fetcher's join key
exists today. `post_snapshots.shares`, `saves`, and `reach` already exist and
have never been written — Route B fills them for Instagram.

---

## 7. The AI layer

**7.1 — Provider-agnostic by contract.** One adapter: base URL, API key, model
name, from environment. Targets an OpenAI-compatible chat-completions shape.
Changing provider is a config change. A separate `vision_model` setting, since
extraction (§2.1 Route B) and prose may warrant different models.

**7.2 — The model narrates; it never computes.** Every prompt receives a
pre-computed table and writes only about what is in it. No prompt asks the model
to calculate a percentage, rank a list, or decide what counts as a peak. This is
the entire anti-hallucination strategy and it is not negotiable: a client report
that quietly invents a number is worse than no report.

**7.3 — Structured output.** Every analysis returns JSON against a fixed schema
(claims, evidence, confidence, sample size). The UI renders fields. A response
failing validation is retried once, then marked failed — never rendered raw.

**7.4 — Paid once per input.** `input_digest` hashes the exact inputs. Same
inputs + same prompt version = the stored result, no call.

**7.5 — A hard monthly budget.** A configured token ceiling per calendar month;
at 80% the admin panel warns, at 100% the worker queues instead of calling.
The LLM is the only cost in the platform, so it is the only thing that can
produce a surprise bill — it gets a hard stop, not a warning.

**7.6 — Vocabulary is constrained by prompt.** Prompts touching replay data are
given the §3.3 framing and forbidden the words *retention*, *drop-off*, and
*audience left*. Prompts touching Tier 3 data may use them, because there the
measurement is real. Mixing the two vocabularies is the single most likely way
this product says something false to a paying client.

**7.7 — Extraction is never trusted.** Vision output is a **draft**, rendered in
an editable form beside the source image, saved only on human confirmation.
Anything else puts OCR errors into client reporting.

**7.8 — Every claim is attributable.** Each rendered claim carries its sample
size and links to the videos behind it.

---

## 8. Interface and visualisation

No new top-level pages.

### 8.1 Content list (`/content`)

Search also covers transcripts, with matching line and timestamp. Two small
indicators per row: transcript present/absent, and lifecycle shape as a glyph
(spike / evergreen / sleeper) — the latter is the cheapest way to make §5.1
visible everywhere without adding a column of numbers.

### 8.2 Video page (`/content/[id]`)

**Transcript panel** — the primary addition, rendering whenever a transcript
exists, independent of everything else. Timestamped lines, in-page search, each
line linking to that moment in the embedded player.

**Lifecycle chart** — views accumulated over time as a line, with the client's
expected curve behind it in the de-emphasis gray. **Emphasis form**: this video
in accent, context in gray. Same unit, same axis. Peak, half-life, and any
second wind marked directly.

**Attention curve, when present** — a single-series **area chart**, x = percent
of video, y = replay intensity. One accent hue at low fill, 2px line, recessive
grid, crosshair and tooltip. No legend; the title names the series. Header states
what it is: *"Most-replayed moments — a relative attention signal, not audience
retention."* Where a Tier 3 export exists, a **separate** panel reads *"Audience
retention, from the channel's own analytics."* The two never share an axis.

**Never a second y-axis.** Nothing here is overlaid on a second scale. The
dual-axis chart is the most common way to make a chart lie and is banned.

**The transcript carries the heat.** Each line's left edge takes a **sequential
single-hue tint** — light to dark, more-is-darker, never a rainbow — for replay
intensity at that moment. This is where a heat encoding earns its place: against
the words, where it is actionable, rather than as a band repeating the curve.
Hovering either side highlights the other.

**The repurposing card** (§5.12): the proposed Short window with in/out
timestamps, its transcript, and a one-line reason.

**Packaging card** (§5.9, Tier 3 only): CTR and average percentage viewed as two
stat tiles with the click-vs-stay reading in a sentence beneath.

**Absence is stated, not hidden.** *"No replay data — YouTube only publishes it
for videos above a view threshold."* Silence reads as a bug; a sentence reads as
a system that knows what it knows.

### 8.3 Client page

Small multiples of recent attention curves at sparkline scale on a shared
y-scale — the percent-of-video x-axis (§3.5) is what makes different lengths
comparable at all. Plus the platform-fit read and the corpus card.

### 8.4 Reports — a fifth tab, "Insights"

The weekly read per client, dated, with computed inputs expandable beneath the
prose, and the current brief suggestions. Same range control as the other tabs.

### 8.5 Data panel (`/data`)

Queue depth by kind, worker heartbeat age, last successful fetch per source,
block state with cooldown remaining, month-to-date token spend against budget,
transcript coverage, and **per-client analytics completeness** — which clients
have sent exports, how recent, and what is missing. That last one turns §2.4's
social dependency into a visible, chaseable task rather than a silent gap.

Manual transcript paste and CSV/screenshot upload live here and on the video
page. With no official caption route, paste is a real feature: 30 seconds
permanently fixes any video the fetcher cannot reach, and a pasted transcript
feeds everything downstream identically.

### 8.6 House rules that still apply

Per-platform metrics are never summed. Text wears ink tokens, never series
colour. Entrance-only motion, flattened under reduced-motion. Both themes
designed, not flipped. Nearly every chart here is single-series or emphasis, so
almost no new categorical hues are introduced; any that are run through the
palette validator before shipping.

---

## 9. Capacity and cost

**Fragile-request footprint — the number that decides whether blocking is real.**
Transcripts are fetched **once and never again**; the `has_captions` pre-check
(§3.2) skips videos that have none; replay maps are fetched **once at ~28 days**
when the numbers have matured, then only on request. At ~30 new videos a month
that is **about 60 fragile requests a month — two a day**, jittered across the
day. Not a guarantee (§3.6), but the difference between looking like a person
and looking like a scraper.

**Tiers 1–3 add zero fragile requests.** Lifecycle is a local computation over
rows already stored; comments and enrichment ride the official API; imports are
files a human uploads.

**Storage.** A 10-minute transcript is ~8–10 KB; a replay map under 2 KB;
lifecycle rows are trivial. The existing 202-video library is **≈2 MB**. With
comments and five years of growth it stays well under 100 MB against Supabase's
500 MB. Screenshots are deleted after confirmation. No pruning policy needed.

**Quota.** ~1 unit per 50 videos for metadata, 1 per 100 comments — roughly 1%
of the 10,000-unit daily allowance.

**Compute and egress.** Dozens of calls a day; megabytes a month against 10 TB.

**LLM — the only cost.** Per new video: attention-map narration where replay
data exists (~3–4k in, ~600 out) and comment analysis (~2–3k in, ~400 out). Per
client per week: one read (~4–6k in, ~800 out). Per client per month: corpus
analysis (~8–12k in, ~1k out) and briefs (~6k in, ~1k out). Vision extraction is
per uploaded image, occasional. At 30 new videos and 10 clients: **roughly
400–500k input and 80k output tokens a month** — small at current mid-tier rates,
and bounded absolutely by §7.5.

**Backfill** of the existing library is a one-off of roughly 1M input tokens and
~400 fragile requests, spread across weeks by the same throttle.

---

## 10. Failure modes

| Failure | Behaviour |
|---|---|
| Video has no captions | Caught by the `has_captions` pre-check before any fragile request. Marked, never queued. |
| Captions exist but fetch fails | Two retries with long backoff, then `unavailable` permanently. Video page offers manual paste. |
| Replay data not published | `unavailable` — the normal case, not an error. Retried once at 90 days in case it crossed the threshold. |
| Our IP gets blocked | Detected by response signature → fragile fetchers pause for a cooldown; **Tiers 1–3, the AI layer and the whole app continue**. `/data` shows state and resume time. Auto-resumes. Escalation in §10.1. |
| Endpoint changes shape | Parse failure is a *failed job with the payload logged*, not a crash. Queue keeps draining. |
| Transcript library API changes | Version-pinned, call surface verified at install (§12 P4). |
| Client never sends exports | Tier 3 features stay dark for that client and say so; everything else is unaffected. `/data` shows it as an outstanding item. |
| Vision misreads a screenshot | Caught at the confirmation step, which is mandatory. Nothing is written unconfirmed. |
| LLM API down or over budget | Analyses queue; UI shows the last analysis with its date. Nothing renders blank. |
| Oracle instance reclaimed or lost | App unaffected — it only reads Supabase. Heartbeat age in `/data` surfaces the stall in minutes; recovery is re-running the provisioning script (§4.4). |
| Worker dies mid-job | Jobs are leased with a timeout; expired leases return to `pending`. Every fetcher is idempotent. |

**10.1 — If the IP is burned for good.** In order: rotate the instance's
ephemeral public IP (free on Oracle; may or may not land in a cleaner range);
fall back to manual paste, which keeps every downstream feature working; or
route fragile fetchers through a cheap rotating proxy — the only line item that
would push this past "the LLM is the sole cost," and explicitly a last resort.

**Manual effort in steady state:** collecting client exports monthly (§2.4), and
optionally pasting a transcript where captions are disabled. Everything else
runs itself.

---

## 11. Deliberately not built

- **Anything requiring channel-owner credentials** — hard constraint, and §0
  removes what exists.
- **Competitor transcript or replay scraping** — the most block-prone use of the
  path we now fully depend on.
- **Competitor *metadata* benchmarking** — worth noting it needs no scraping at
  all (the official API serves any public channel at ~1 unit per 50 videos), so
  it is a legitimate later phase rather than a cut. Out of v1 because it is a
  different product with a different buyer.
- **Social cross-link extraction** — the `accounts` table already holds every
  client's handle on every platform. This would scrape data we have.
- **TikTok and Instagram transcripts** — no comparable endpoint; would need
  media download plus paid speech-to-text. **Mitigated:** §6.1 attaches
  transcripts to the content item, so cross-posted edits are covered by their
  YouTube version, and §3.2 recovers Instagram caption text that is currently
  discarded.
- **Semantic search / embeddings** — full-text search answers the real question
  at zero cost. pgvector makes it a later addition, not a rewrite.
- **A second database on Oracle** — see §4.3.
- **Synchronous "analyse now"** — would put long calls on Vercel and make cost
  unpredictable. Everything queues.
- **Retaining uploaded screenshots** — extract, confirm, delete. No image store,
  no retention question to answer later.

---

## 12. Implementation prompts

Each ships independently and leaves the system working. **Verification bar for
every stage:** tsc clean · lint 0 errors · build passes · all unit suites · RLS
suite extended for new tables · every new surface proven with an authenticated
render probe. Each stage also carries its own **acceptance test** — the thing
that must be demonstrably true, not merely written.

**P0 — Remove OAuth.** Everything in §0: routes, connectors, table, column, UI
states, environment variables, plus the `post_analytics` source constraint. RLS
suite updated. Ships first and alone, so the constraint is true in the code
before anything is built on top of it.
*Accepts when:* `grep -ri oauth src/` returns nothing outside comments, the app
builds and every page renders, and inserting `post_analytics.source = 'oauth'`
is rejected by the database.

**P1 — Lifecycle.** `post_lifecycle`, the derivation over `post_snapshots`, the
expected-curve model, shape classification, the §8.2 chart and the `/content`
glyph. **Zero new data sources, immediate value** — the proof that Tier 1 was
worth reading.
*Accepts when:* every post with ≥3 snapshots gets a shape, half-life is
recomputed independently in a test and matches, and a video with one snapshot
reports `unknown` rather than a fabricated curve.

**P2 — Free enrichment.** `has_captions`, `topic_labels`, description and
Instagram caption persistence, full publish timestamps. Small, and everything
downstream is cheaper for it.
*Accepts when:* a sync run populates all four on new posts, and the backfill
leaves no null `has_captions` on YouTube posts.

**P3 — Schema, queue, worker.** The remaining tables, RLS, `ingest_jobs` with
leasing and backoff, and the Oracle service per §15. First job kind is
`comments` — official API, proving the pipeline end to end without touching
anything fragile.
*Accepts when:* §15.5 holds (rebuild from script, heartbeat visible), a killed
worker mid-job returns that job to `pending` within the lease timeout, and
comments land for a real video.

**P4 — Transcripts and search.** Public fetcher behind the queue, gated on
`has_captions`. **Version-pin the library and verify its call surface against the
installed version** — its API changed shape across major versions and older
static-method code will not run. Manual paste ships in the same stage. Then FTS
in `/content` search. Must be valuable with the model switched off.
*Accepts when:* a phrase spoken in a video is findable from `/content` search
and links to its timestamp, and a caption-less video is never queued.

**P5 — Client analytics import.** CSV importer on the existing `/import`
infrastructure, per-client completeness tracking, and the §5.8 click-vs-stay
panel. **The highest-value stage in the document**, and it depends on nothing
fragile.
*Accepts when:* a real Studio export imports without hand-editing, a malformed
file fails with a row-level message rather than a stack trace, and re-importing
the same file changes nothing.

**P6 — Replay map.** Fetcher at 28-day maturity, the attention chart, tinted
transcript strip, peak detection, cross-highlighting, empty states.
*Accepts when:* a video with no replay data renders the explanatory empty state,
and no UI string or prompt contains "retention" on a replay-sourced panel (§7.6).

**P7 — The AI layer.** Adapter, prompt versioning, schema-validated output,
`input_digest` caching, budget ceiling, §7.6 vocabulary constraints. Comment
themes and attention narration first — per-video and cacheable.
*Accepts when:* re-running an unchanged analysis makes zero API calls, a
schema-invalid response is retried once then marked failed, and the budget
ceiling provably stops calls when simulated as exhausted.

**P8 — Vision extraction.** Screenshot upload, worker-side extraction, mandatory
confirmation UI, image deletion after confirm.
*Accepts when:* nothing reaches `post_analytics` without an explicit
confirmation click, and the stored image is gone afterwards.

**P9 — Insights and briefs.** Corpus analysis with sample-size guards, platform
fit, metadata patterns, content gaps, packaging analysis, repurposing
suggestions, the weekly read, the fifth Reports tab, and the weekly schedule.

**P10 — Backfill and hardening.** Throttled backfill across weeks, the full
`/data` operations panel, and failure-mode tests: simulated block, endpoint shape
change, budget exhaustion, worker death mid-job, malformed CSV, vision
misread.

---

## 13. Open questions

1. **Will clients send Studio exports?** This single answer decides whether Tier
   3 — including the click-vs-stay diagnosis, the most valuable thing here —
   exists at all. Worth asking one client before P5 rather than building on an
   assumption.
2. **Which LLM provider and model, and does it do vision?** §9's budget assumes
   a mid-tier model; §2.1 Route B needs a vision-capable one, which may be a
   second model in the same adapter.
3. **Should the weekly read be emailed?** Designed as an in-app tab because the
   platform has no email capability. Adding one (Resend's free tier fits) is
   small, separate work — and it is what turns "automated client reports" from
   *available* into *delivered*.
4. **Does the client see any of this?** `/portal` exists for client users.
   Exposing a curated read is cheap, but changes who the writing is for.
5. **How far back should lifecycle analysis reach?** Snapshot history only goes
   back to launch, so older videos have partial curves. Suggest computing
   whatever is available and labelling the coverage, rather than excluding them.

---

## 14. The Oracle tenancy, as verified

Not guidance — **measured**. Every figure below came from signed API calls
against the live account, so the provisioning decisions in §15 rest on fact
rather than on what Oracle's marketing pages say.

**14.1 — Identity.** Tenancy `tiltedneedletools` (`TENLS-6209`), home region
**`ap-singapore-1`**, the only subscribed region. User
`tiltedneedletools@gmail.com`, `ACTIVE`, **MFA enabled** — worth recording,
because this account will hold the infrastructure the whole pipeline runs on.
Home region matches the rest of the stack (Supabase, Vercel), so the worker's
database round-trips stay in-region.

**14.2 — The home region is permanent.** It cannot be changed, and Always Free
resources exist only there. Already correct here; noted because it forecloses
"just move regions" as an answer to anything below.

**14.3 — There is exactly ONE availability domain:
`qJLL:AP-SINGAPORE-1-AD-1`.** This matters more than it looks. Multi-AD regions
let you retry a failed launch in AD-2 or AD-3 when one runs out of host
capacity. Singapore offers no such fallback: if capacity is out here, the only
options are wait or change shape. This is the single strongest argument for
keeping the AMD micro documented as a fallback (§4.5) and for treating the
instance as disposable (§4.4).

**14.4 — Both Always Free shapes are offered, and nothing is consumed.**

| Shape | Offered | Used | Quota shown |
|---|---|---|---|
| `VM.Standard.A1.Flex` (Ampere ARM) | yes | 0 cores | 41 OCPU / 277 GB |
| `VM.Standard.E2.1.Micro` (AMD) | yes | 0 cores | 2 OCPU |

Zero instances exist. Ubuntu images confirmed present for both:
`Canonical-Ubuntu-24.04-Minimal-aarch64-2026.06.29-0` for A1,
`Canonical-Ubuntu-24.04-2026.06.29-0` for the micro.

**14.5 — The quota shown is a trap, and this is the most important line in the
section.** That 41-OCPU / 277 GB A1 limit is **trial-era quota**, not the Always
Free allowance. Always Free is **4 OCPU and 24 GB total across all A1
instances**. Provisioning anywhere near the displayed limit would create
resources that are reclaimed — or billed — when the 30-day trial converts.

**Provision 4 OCPU / 24 GB and not one core more.** The console will happily let
you exceed it. Nothing in this system needs more.

**14.6 — Quota is not capacity.** `available: 41` means quota headroom, not that
41 cores are physically free on a host. "Out of host capacity" is a launch-time
error that quota checks cannot predict. The launch attempt is the only proof —
which is why §15 has an explicit fallback branch instead of assuming success.

**14.7 — Do not upgrade to Pay As You Go.** Upgrading is what makes ARM capacity
reliably available, and also what makes overspending possible. The whole cost
premise of this platform depends on staying on the free path.

**14.8 — Save the SSH private key at instance creation.** Offered once. Cheap to
recover from here (§4.4) but avoidable.

**14.9 — No inbound ports beyond SSH.** The design serves nothing (§4.2), so the
default security list needs no changes at all. Oracle's images also carry local
`iptables` rules on top of the cloud security list — the classic "I opened the
port and it still doesn't work." It never bites us, because we open nothing.

**14.10 — Guard against idle reclamation** (§4.6): the continuous poll loop
handles it; a once-daily cron would not. A 4-OCPU box running a tiny poller
looks *extremely* idle, so this matters more on the A1 than it would have on the
micro.

**14.11 — Local tooling notes**, both of which cost real time to diagnose:

- The **`oci-cli` will not install** on this machine — it ships help files whose
  paths exceed 260 characters and Windows Long Path support is disabled. Enabling
  it is a registry change. **Unnecessary:** the `oci` **Python SDK** installs
  cleanly, is what a provisioning script should use anyway, and is already
  installed and working.
- **`~/.oci/config` must not have a byte-order mark.** PowerShell's
  `Set-Content -Encoding utf8` writes one, and OCI's config parser fails with
  `MissingSectionHeaderError`. Write it with
  `[System.IO.File]::WriteAllText(path, text, UTF8Encoding($false))`.

**14.12 — Treat the instance as cattle.** Provisioning script in the repo,
secrets injected at deploy, `systemd` unit with `Restart=always`, unattended
security upgrades. Nothing on that box is ever the only copy of anything.

---

## 15. Provisioning runbook

The exact build, decided. Executed by a committed script (§4.4) using the Python
SDK, not by clicking through the console — so a rebuild after reclamation is one
command rather than a memory test.

**15.1 — Network.** One VCN with a single public subnet in
`qJLL:AP-SINGAPORE-1-AD-1`, an internet gateway, and a default route out. The
security list is left at its default: **SSH (22) inbound, everything outbound.**
No other ingress rule is ever added, because the worker listens on nothing.

**15.2 — The instance.**

| Setting | Value | Why |
|---|---|---|
| Shape | `VM.Standard.A1.Flex` | §4.5 |
| OCPUs / memory | **4 / 24 GB** | The Always Free ceiling, never the shown quota (§14.5) |
| Image | `Canonical-Ubuntu-24.04-Minimal-aarch64` | Verified present; minimal = less to patch |
| Boot volume | Default (~47 GB) | Well inside the 200 GB allowance |
| Public IP | Ephemeral | Free to release and re-request — the §10.1 escape hatch |
| Fallback | `VM.Standard.E2.1.Micro` + `Canonical-Ubuntu-24.04` | If launch returns out-of-host-capacity (§14.6) |

**15.3 — Host setup**, all scripted:

- `unattended-upgrades` for security patches
- a 2 GB swap file (insurance, not necessity, at 24 GB)
- Python 3 with a virtualenv for the worker
- a dedicated non-root `worker` user owning the service
- `systemd` unit: `Restart=always`, `RestartSec=10`, journald logging with size caps
- **no** web server, **no** reverse proxy, **no** certificates — there is nothing
  to serve

**15.4 — Secrets.** Two, injected at deploy into a root-owned `0600`
`EnvironmentFile` read by the systemd unit: the Supabase **service key** and the
**LLM API key**. Neither is ever committed, and neither is ever added to Vercel
(§4.7). Rotating either means editing one file and restarting one service.

**15.5 — Acceptance for the provisioning stage.** The instance is done when: the
systemd unit survives a reboot; the worker writes a heartbeat row Supabase can
see; `/data` shows that heartbeat age ticking; and terminating and re-running the
script from scratch produces a working instance without manual steps. If the
last one does not hold, §4.4's promise is false and the Oracle quirks in §14
become incidents again.

---

## 16. Security posture

Small, because the architecture removed most of the surface rather than
defending it.

- **No inbound service.** The worker polls outward (§4.2). There is no endpoint
  to authenticate, rate-limit, or patch — only SSH.
- **No OAuth tokens anywhere.** §0 deletes the table, the Vault references, the
  routes, and the client secrets. The most valuable credentials the old design
  would have held now do not exist.
- **Secrets live in exactly one place** — the worker's `EnvironmentFile`. The
  browser bundle, Vercel's environment, and the repository each hold none of
  them.
- **The service key is powerful.** It bypasses RLS by design, which is why it
  lives only on a machine with no inbound service and a non-root service user.
- **Client analytics are client data.** Uploaded exports and screenshots are
  business-sensitive; screenshots are deleted after confirmation (§11) and
  parsed values inherit the same RLS scoping as every other metric.
- **MFA is already on** the Oracle account (§14.1). Keep it there.
