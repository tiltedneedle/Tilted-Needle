# Tilted Needle — Product Requirements Document

**Module:** Cross-Platform Content Performance Dashboard (+ supporting time-tracking module)
**Status:** Draft v0.3 — re-centered on the performance dashboard per direct client feedback
**Last updated:** 2026-07-28

---

## 1. Summary

**The primary deliverable is one page**: a single-screen performance dashboard
where a manager picks a client, a video, or a person from a set of dropdown
filters and sees everything that matters about it, without navigating between
separate screens. Two audiences share that one page:

1. **Video / client performance** — for any client, every video they've had
   made, and for any video, its per-platform reach and the five people
   credited on it (idea, script, videographer, editor, QC), each ranked by
   how their work performed.
2. **Team / employee overview** — the people doing the work: their
   performance across every video they've touched, and what they're
   currently assigned to.

Time tracking exists **in support of this**, not as the headline feature. It
answers "how many hours did this cost" underneath the performance numbers; it
is not itself the product. An earlier draft of this PRD inverted that
emphasis and modeled the entire Clockify feature surface as the primary
build. That was a misreading of the brief, corrected here: **build the
dashboard first, keep time tracking as the supporting module the original
brief described it as** ("this is one module of the company app").

Clockify-specific integration (importing a Clockify account's history) is
**out of scope**. It solved a real problem — cold-starting the performance
model with history — but it is not close to the actual goal and should not
consume build effort disproportionate to its value. If historical backfill
matters later, the generic CSV/manual entry paths already in this app cover
it without a Clockify-specific integration.

**Platform-agnostic by construction.** Platforms are configuration, not code
branches: adding LinkedIn or Snapchat later must mean registering a connector,
not touching the scoring engine, the schema, or the dashboards. See §9.5.

---

## 1.1 The Dashboard (primary deliverable — read this first)

One route, one page. Everything below is a *section of that page*, not a
separate screen a manager has to navigate to. The data behind every section
already exists (content items, platform posts, snapshots, role assignments,
scores, tracked time) — this section specifies how it is *presented*: as one
filterable surface, not the half-dozen separate pages an earlier draft split
it into (`/content`, `/performance`, `/performance/[userId]`, `/clients/[id]`).

### 1.1.1 Filter bar (always visible, top of page)

- **Client** — dropdown, searchable. Selecting one scopes everything below to
  that client only.
- **Video** — dropdown, populated from the selected client's content once
  one is chosen. Selecting one drills into that single video's detail.
- **Person** — dropdown, independent of the client/video filters (a person
  works across clients). Selecting one scopes the page to that person.

These three combine, they don't replace each other: client + no video shows
the client's full roster of videos; client + video shows one video's detail;
person alone shows that person's cross-client record. At least one filter
must be selected — this page does not attempt to show everything for every
client at once.

### 1.1.2 Client view (Client selected, no video)

- Header stats: videos delivered, posts published, total tracked hours.
- **Per-platform reach table** — views/likes/comments/engagement per
  platform, never summed across platforms (PRD 5 Step 2 explains why).
- Video list for this client, each row showing its per-platform view chips —
  clicking a row drills into the Video view below.

### 1.1.3 Video view (Client + Video selected)

- Video metadata: title, subject, hook, length, produced date.
- Per-platform performance cards (views/likes/comments, snapshot history,
  CTR/retention when a connected account or manual entry has supplied them).
- **The five-role credit panel** — this is the feature described in the
  original brief and the one an earlier draft under-emphasized by putting it
  on a separate `/content/[id]` page:

  | Role | Credited person | This video's score for them |
  |---|---|---|
  | Idea | (assigned member) | tier + multiplier, per platform |
  | Script | (assigned member) | tier + multiplier, per platform |
  | Videographer | (assigned member) | tier + multiplier, per platform |
  | Editor | (assigned member) | tier + multiplier, per platform |
  | Quality Control | (assigned member) | tier + multiplier, per platform |

  Each row shows the assigned person's score **for this specific video**,
  computed by the existing scoring engine (§5) against their platform's own
  baseline — not a global average. Editable inline: reassign a role, adjust
  best-performing flag, add a metric snapshot, without leaving the page.

### 1.1.4 Person view (Person selected)

- Header stats: videos credited, roles held, hours tracked.
- **Overall performance**, broken down by role and by platform (never a
  single blended number — §5's guardrail applies here directly).
- List of every video they're credited on, each showing which role they held
  and that video's per-platform reach.
- This subsumes the earlier separate `/performance/[userId]` page.

### 1.1.5 Team / Employees section (own tab on the same page, not a filter)

The second audience from §1: not "drill into one person" but "see everyone."

- Roster table: every active team member, their roles held (aggregated
  across videos), overall score per role, and **current ongoing
  assignments** — which videos/projects they are credited on right now.
- Sortable by score, by role, by workload (open assignment count).
- Clicking a row jumps into that person's Person view (§1.1.4) rather than
  duplicating its content here.

### 1.1.6 What stays off this page

Time tracking's own working surfaces (the timer, the weekly timesheet grid,
invoicing, approvals, time off) remain their own pages — they are a
different task shape (data entry across a week) than this dashboard (read
and filter). This page consumes their *output* (hours, for the cost context)
without importing their UI.

---

## 2. Goals & Non-Goals

### Goals
- Replace the existing Excel tracker without losing any column the team relies on.
- Rank the 5 production roles fairly, accounting for channel size, video age, and sample size.
- Give clients a self-serve view of what was delivered for them.
- Track cost and billing accurately enough to invoice from.

### Non-Goals (v1)
- Competitor//public-channel scraping outside client channels.
- Automated video editing, publishing, or YouTube content management.
- Replacing the client's own YouTube Studio workflow.

### Explicit anti-goal
Do **not** present public-metric rankings as causal explanations of performance. See §4.

---

## 3. Users & Roles

| Role | Sees | Can do |
|---|---|---|
| **Owner / Admin** | Everything in the org | Billing, rates, members, integrations, delete |
| **Manager** | All projects + team reports | Approve timesheets, assign roles, set budgets |
| **Member** (the 5 production roles) | Own entries; assigned videos | Track time, submit timesheets, view own rank |
| **Client** | Only their own channels & reports | Read-only dashboards, export |

Multi-tenant with row-level isolation. A user may belong to multiple organizations with a different role in each.

---

## 3.5 Data Reality Check (from the live tracker, reviewed 2026-07-27)

The client tracking sheet was analysed: 7 client tabs, 159 posts. Two findings
contradict the original brief and reshape the product.

### Finding 1 — This is not a YouTube product

| Platform | Posts | Share |
|---|---:|---:|
| Instagram | 79 | 49.7% |
| TikTok | 77 | 48.4% |
| **YouTube** | **3** | **1.9%** |

The brief says "Tracking YouTube Videos." The data says Instagram and TikTok are
**98% of tracked output**. A YouTube-first build would address three posts.

All content is short-form: video lengths run 0:33–1:19. There is effectively no
long-form catalogue.

### Finding 2 — Role attribution has no data at all

| Column | Filled |
|---|---:|
| Views, Likes, Best Performing, Date Posted | 100% |
| Subject, Hook, Response in Comments, Video Length | 94% |
| Music Used | **0%** |
| Video Engagement | **0%** |
| Videographer, Editor, Time, Script, Video Idea, who QC | **0%** |

The 5-role columns exist on exactly one client tab and have **never been
filled**. The ranking system in §5 therefore has zero history to learn from, and
no backfill is possible from this source.

`Music Used` and `Video Engagement` are likewise aspirational — build them only
if someone commits to populating them.

### What this implies

1. **Platform priority inverts.** Instagram and TikTok first; YouTube becomes a
   minor third.
2. **Roles should be derived from tracked time, not typed twice.** Clockify
   already records who logged *Editing* or *Revisions* against a given video
   title. That is the same fact the role columns ask for, already being captured
   as a by-product of time tracking. Asking people to also fill a spreadsheet
   column is duplicate entry that has a 0% compliance record.
3. **Same content, many platforms.** The identical video is cross-posted and
   performs wildly differently — one post drew 77,600 views on Instagram and
   7,364 on TikTok. The model must be `content_item → platform_posts`, not
   `channel → video`, or cross-posted work is double-counted or averaged into
   nonsense.
4. **The qualitative columns are a workaround.** `Hook` records the literal
   opening line; `Response in Comments` grades sentiment. The team captures these
   by hand precisely because the APIs will not give them retention or CTR.

---

## 4. The Attribution Constraint (read before designing dashboards)

The brief asks to "check why a video is boosting" *without* connecting client accounts. **These two requirements are in direct conflict**, and the PRD resolves it explicitly rather than papering over it.

### What each platform actually allows

This is where the original advice needs correcting. YouTube is the *permissive*
platform — and it is the one they barely use.

| Platform | Without the client connecting an account | With client authorisation |
|---|---|---|
| **YouTube** | Data API v3 with just an API key: views, likes, comments, title, duration | Analytics API: CTR, retention, watch time, traffic sources, demographics |
| **Instagram** | **Nothing.** No public API for reading another account's post metrics | Graph API: needs an IG Business/Creator account linked to a Facebook Page, plus Meta app review. Gives reach, impressions, saves, shares, watch time |
| **TikTok** | **Nothing.** Display API needs user OAuth; the Research API is restricted to accredited academics | Display API: views, likes, comments, shares for the authorising account |
| **Facebook** | Effectively nothing. Public Page data is minimal and shrinking | Pages API with a Page access token: reach, impressions, 3-second and complete views, reactions |
| **LinkedIn / X / Snapchat** | Nothing meaningful | Each needs its own app review and OAuth; treat every addition as its own project |

YouTube is the outlier, not the template. Every other platform requires the
client to authorise, and Meta additionally requires app review before the
integration works for anyone outside the developer account.

### The consequence for 98% of their content

For YouTube, a public baseline is possible — views and likes need no permission.
**For Instagram and TikTok there is no public tier at all.** The choice is binary:
the client authorises, or the numbers are typed in by hand.

That is precisely why the tracking sheet exists, and why the brief worries about
"connecting the client's Meta account." There is no clever way around it — the
restriction is a platform policy, not a technical gap.

So the honest options for Instagram and TikTok are:

1. **Client authorises** (one-time, read-only, revocable) — the only route to
   automated, trustworthy metrics.
2. **Continued manual entry**, but moved into the app with validation and
   history instead of a spreadsheet.
3. **Assisted manual entry** — paste a post URL, the app scrapes the public page
   for view/like counts. Brittle, breaks without notice, and sits against both
   platforms' terms. Not recommended as a foundation.

### Why per-role attribution is harder here than on YouTube

### Why this decides the whole ranking design

Performance decomposes roughly as:

```
Views  ≈  Impressions × CTR × (retention-driven algorithmic amplification)
                        ↑                    ↑
                  thumbnail + title      hook + script + edit
                  (idea guy)             (script guy, editor)
```

**CTR isolates the idea/thumbnail work. Retention isolates the script and edit.** Both are owner-only.

With public data alone, every one of the 5 people on a video receives the *identical* signal — the view count. You can rank people by the outcome of videos they touched, but you **cannot attribute** that outcome to their specific contribution. A brilliant editor on a bad-thumbnail video scores badly, and a mediocre editor riding a great thumbnail scores well.

### Decision: hybrid, degrading gracefully

- **Manual entry is the guaranteed floor** for every account, on every platform. It is how the team works today and the only thing that works with zero client cooperation. Moving it into the app with validation, history, and no re-keying is itself a win.
- **Connected accounts** (IG/TikTok OAuth, YouTube OAuth) replace manual entry with automatic sync and unlock the deeper metrics.
- **YouTube only** additionally supports a keyless public baseline via Data API v3.
- The UI must **visibly label** each account's mode. Automatically-synced and hand-entered figures are never silently mixed in one ranking table.

**Product consequence:** true per-role attribution is a feature of *connected* accounts. For unconnected accounts the app reports outcome, not contribution — the difference between a defensible internal metric and a number that quietly misjudges people's work.

On Instagram and TikTok the gap is wider still: even connected accounts expose no per-second retention curve of the kind YouTube provides, so cleanly separating the scriptwriter's hook from the editor's pacing stays largely out of reach. What *is* available — reach, saves, shares, average watch time — supports a coarser split than the five-way one the brief imagines.

The team already senses this, which is why they hand-record `Hook` and `Response in Comments`: those columns are a human substitute for the retention data the platforms withhold.

---

## 5. Performance Scoring Model

Designing this properly matters, because these numbers will affect how people are evaluated. A naive "average views per person" is actively unfair for four reasons: channel size dominates, older videos accumulate more views, view distributions are extremely heavy-tailed, and one lucky video beats fifty solid ones.

### Step 1 — Fix the measurement window

Never compare lifetime views across videos of different ages. Snapshot every video and evaluate at a fixed maturity, default **V₇ = views at 7 days** (configurable; V₂₈ for slower niches).

This requires storing a **time series**, not a current value — see §7 ingestion.

### Step 2 — Score each platform separately, then average

**Platforms are scored in isolation. Nothing is pooled or interlinked.**

Each platform has its own metrics, its own definition of a view, and its own
notion of what "good" looks like. TikTok counts a view the instant playback
starts; Facebook historically counted at 3 seconds; YouTube long-form wants
~30; Instagram has redefined plays more than once. Instagram rewards saves and
shares, TikTok rewards completion, YouTube rewards click-through and retention.

So the pipeline is:

```
   Instagram posts ──▶ Instagram score   (Instagram's metrics, Instagram's baseline)
   TikTok posts    ──▶ TikTok score      (TikTok's metrics, TikTok's baseline)
   YouTube posts   ──▶ YouTube score     (YouTube's metrics, YouTube's baseline)
   Facebook posts  ──▶ Facebook score    (Facebook's metrics, Facebook's baseline)
                              │
                              ▼
                      Overall = mean(platform scores)
```

Within a platform:

```
baseline  = median(V₇) over the previous 10 posts on THAT account
PerfIndex = V₇(post) / baseline
```

The ratio is dimensionless, which is the whole trick: "1.8× this account's
normal" is a meaningful number on any platform, even though the raw counts
behind it are not comparable. Platform scores stay in their own lane right
through log-transform, recency weighting, and shrinkage (Steps 3–5); only the
finished per-platform scores are ever combined.

**Hard rules**

1. Never sum or average raw counts across platforms. A cross-platform view
   total is a presentation convenience at best, and must be labelled as a sum
   of incomparable units.
2. Baselines are per account, per platform. Never per client, never global.
3. Only fully-computed per-platform scores may be averaged into an overall.

**Cross-posted content** yields one score per platform it ran on, and its
overall is the mean of those — so a video that lands on Instagram and flops on
TikTok reads as genuinely mixed, rather than being rescued by whichever
platform happened to inflate the count.

#### The weighting decision

The default is an **unweighted mean**: every platform a person or piece of
content appears on counts once, regardless of volume.

This is the right default — it measures *how well the work performs on each
platform*, which is what a per-platform score is for. But the consequence needs
stating, because it will come up the first time someone disputes a ranking:

> A creator with 50 Instagram posts and 2 TikToks has TikTok contributing half
> their overall score.

If that reads as wrong for the team, the alternative is weighting each platform
by post count — which makes the overall track volume instead of quality. Both
are defensible; they answer different questions. Whichever is chosen, the UI
must always show the **per-platform breakdown beside the overall**, so nobody is
judged on a single blended figure whose composition is invisible.

Platforms with no posts in the period are excluded from the mean rather than
counted as zero. A missing platform is absence of evidence, not bad
performance.

### Step 3 — Log-transform

View distributions are log-normal; one viral outlier would otherwise dominate every average.

```
s = ln(PerfIndex)          // 0 = exactly at baseline, positive = over
```

### Step 4 — Recency weighting

```
w_time = 0.5 ^ (age_days / 90)     // 90-day half-life
```

### Step 5 — Shrinkage toward the role mean (the important part)

Someone with two videos should not top the leaderboard on luck. Empirical-Bayes shrinkage pulls small samples toward the average for their role:

```
personRaw  = Σ(w_time · s) / Σ(w_time)
n          = effective video count for that person+role
k          = 5                                  // tunable prior strength
Score      = (n / (n + k)) · personRaw  +  (k / (n + k)) · roleMean
```

With n=1 the score is ~83% role-average. At n=20 it is ~80% their own record. Confidence rises only as evidence does.

### Step 6 — Role-specific signal (connected accounts only)

Signals are declared per platform in the connector registry (§9.5), because
each platform exposes a different set. The same role is therefore judged on
different evidence depending on where the content ran — which is exactly the
point of scoring platforms separately.

| Role | YouTube | Instagram | TikTok | Facebook |
|---|---|---|---|---|
| Idea | CTR vs. baseline | Reach ÷ follower count | Views vs. baseline | Reach vs. baseline |
| Videographer / thumbnail | CTR + first-frame retention | Cover-frame reach | Early drop-off | 3s view rate |
| Script | Retention at 30s / 60s | Avg watch time | Completion rate | Avg watch time |
| Editor | Retention AUC, avg view duration | Avg watch time, saves | Completion rate, re-watch | Complete views |
| QC | Dislike ratio, comment sentiment | Comment sentiment | Comment sentiment | Reaction mix |

Where a platform cannot supply a role's signal, that role is **not scored on
that platform** — it is not silently substituted with views. A role with no
usable signal anywhere in the period is reported as "insufficient data", never
as a low score.

Until accounts are connected, no platform supplies these, and §5 falls back to
outcome-only scoring (Steps 1–5) for everyone on the content.

Each computed as its own `PerfIndex` against the channel baseline, then run through Steps 3–5 identically.

### Step 7 — Present as tiers, not decimals

Surface percentile bands within role (Top 10% / Above / At / Below baseline) plus a confidence indicator driven by `n`. **Do not display a precise-looking number derived from three videos.**

### Guardrails
- Minimum 3 posts before a person is ranked publicly at all — applied **per
  platform**, so a strong Instagram record cannot lend false confidence to a
  two-post TikTok score.
- Show sample size beside every score, always.
- Never rank across different roles — editors compete only with editors.
- **Always display the per-platform breakdown next to the overall.** The overall
  is a summary of the platform scores, never a replacement for them.

---

## 6. Functional Scope

The dashboard in §1.1 is the headline deliverable. What follows is the
supporting time-tracking module: real, and still built to the same standard,
but explicitly secondary to §1.1 — not something to expand at the dashboard's
expense.

### 6.1 Time Tracking (Core)
- Live timer (start/stop/resume), manual entry, bulk edit, duplicate
- Timesheet grid (weekly), calendar view, drag-to-create
- Projects → tasks → subtasks; clients; tags; descriptions
- Billable/non-billable flag per entry
- Idle detection, Pomodoro, reminders
- Required-fields enforcement, time rounding rules
- Favourites and recent entries

### 6.2 Billing & Rates
- Hourly billable rates: workspace → member → project → task precedence
- Cost rates (internal) for margin reporting
- Project budgets and time estimates, with alert thresholds
- Expenses (fixed + per-unit), receipt attachments
- Invoices from tracked time and expenses; tax, discount, statuses
- Currency per client

### 6.3 Team Management
- Approvals: timesheet submission → manager review → lock
- Time off: policies, accrual, balances, holidays, requests
- Scheduling: capacity planning, assignments, milestones
- User groups, granular per-resource permissions
- Invitations, deactivation, seat management

### 6.4 Reporting
- Summary, detailed, weekly reports
- Group by project/client/user/tag/task/date
- Saved reports, scheduled email delivery, shared public links
- Export: CSV, XLSX, PDF
- Custom fields on entries/projects, reportable

### 6.5 Advanced (later phases)
- Kiosk mode, GPS, screenshots, activity tracking
- SSO/SAML, SCIM
- Audit log, webhooks, public API
- QuickBooks/Xero export

### 6.6 Content & Performance Data Layer

This is the data and logic the dashboard in §1.1 is built on — the dashboard
is the presentation of this layer, not a separate feature.

- Channel/account registration per client; OAuth connect flow with clear status
- Video catalogue with automatic sync
- **Role assignment: the 5 entities per video** (extensible — roles are data, not enum)
- Metric snapshots and time-series charts
- Boost detection: flag videos exceeding baseline by configurable threshold
- Historical backfill, if ever needed: generic CSV upload or manual entry.
  **Not** a bespoke Clockify integration — see §1 and §13 for why that was
  removed from scope.

### 6.7 The Join (differentiator)
- Link time entries to specific videos
- **Hours per video**, by role
- **Cost per video** (cost rates × hours) → **cost per 1,000 views**
- ROI leaderboard: performance per hour invested, not just performance
- Client profitability: billed vs. cost vs. delivered reach

---

## 7. Information Architecture (derived from the live Clockify workspace)

Reference screenshots were reviewed. Structure below mirrors what the team already uses, so muscle memory carries over.

### 7.1 Navigation

```
TRACK      Timesheet · Time Tracker · Calendar
ANALYZE    Dashboard · Reports
MANAGE     Projects · Team · Clients
CONTENT    Content · Accounts · Performance     ← new module
```

"Content" rather than "Videos", and "Accounts" rather than "Channels": one piece
of content fans out to several platform accounts, and the navigation should say
so.

Workspace switcher pinned top-left. **The team runs at least three separate workspaces** (a London entity, a Dubai entity, and a partner brand). Workspace switching is a first-class, high-frequency action — not a settings-page afterthought.

### 7.2 Dashboard

| Element | Behaviour |
|---|---|
| Scope controls | Project selector · **Only me / Team** toggle · month navigator with ‹ › stepping |
| KPI row | Total time · Top Project · Top Client (em-dash when none) |
| Daily bar chart | One bar per day across the period, segmented and colour-coded by project |
| Donut + breakdown | Ranked list: entity · duration · **percentage share**, donut total in centre |
| Most tracked activities | Top-N panel (selector: Top 10), each row = activity name + `Project: Task` + duration |

### 7.3 Reports

Four tabs: **Summary · Detailed · Weekly · Shared**.

- **Period:** preset ranges (This week…) with ‹ › stepping
- **Filter bar:** Team · Client · Project · Task · Tag · Status · Description · Kiosk
- **Filter visibility:** a FILTER menu toggles which filter chips are shown
- **Every entity picker needs:** inline search · Select all · **Active/Archived show-toggle** · null option (`Without Client`, `Without description`)
- **Explicit `APPLY FILTER`** — filters do not auto-apply. Deliberate: these queries are expensive.
- **Two-level Group by** (e.g. Project → Description) plus a secondary grouping dimension (Billability)
- **Rounding toggle** on totals
- Results table: entry-count badge · title · duration, sortable
- Bar chart + donut alongside the table
- **Export** (CSV/XLSX/PDF) · Print · **Share link** (the Shared tab lists these)

### 7.4 Team

- Tabs: **FULL · LIMITED · GROUPS** — two seat tiers plus group management
- Filters: All/Active/Inactive · Role · Group · name/email search
- Table: Name · Email · Role · Group
- **Deactivated members render struck-through and remain visible** — history must survive departures. Never hard-delete a member.

### 7.5 The finding that matters most

In the live workspace the hierarchy is:

```
Project      = client or content line   (Youmi · YN8 SF · YN8 YT LF · Ameerh Long Form)
Task         = production stage         (Editing · Revisions · Admin)
Description  = THE VIDEO TITLE          (Youmi Beauty Vlog · Podcast with JJ · Drifting with AP Dhillon)
```

**The team is already tracking time per video — in a free-text description field.**

That is the entire YouTube join, sitting in an unindexed string. It means:

1. **Historical backfill is possible today.** Existing entries can be fuzzy-matched to YouTube videos by title, giving real hours-per-video from day one instead of waiting for new data.
2. **`time_entries.video_id` replaces the convention with a real foreign key** — no more typos splitting one video across three spellings.
3. **Task names are already role-shaped.** *Editing* and *Revisions* map onto the 5-role model. Roles should extend the existing task vocabulary, not compete with it.

Migration should keep the description field free-text *and* add the video link, so nothing breaks while the team adopts it.

---

## 8. Design System

Target: **Notion's calm, content-first feel** applied to a data-dense tool.

### 8.1 The tension to manage

Notion is airy and text-led. Clockify is a dense grid people hit dozens of times a day. Applying Notion's generous spacing naively to a timesheet would push a week's rows below the fold and make the tool *slower to use*.

Resolution: Notion's **surface language** (restraint, subtle borders, muted palette, typographic hierarchy, hover-revealed controls) with **dense, purpose-built data layouts**. Airy chrome, compact data.

### 8.2 Language

- Neutral grey-scale base; colour reserved for data, status, and one accent
- Subtle 1px borders over drop shadows; shadows only for true elevation (menus, modals)
- Hover-revealed row actions — no permanent button clutter
- Slash-command / command palette (`⌘K`) for navigation and quick entry
- Inline editing everywhere; avoid modal round-trips for single-field edits
- Dark mode as a first-class theme (the team already works in dark Clockify)

### 8.3 Motion — deliberately restrained

The team will use the timer **50+ times a day**. Animation that delights on first use becomes friction on the five-hundredth.

| Rule | Value |
|---|---|
| Interaction feedback | 120–180 ms |
| Layout transitions | 200–260 ms |
| Easing | `cubic-bezier(0.2, 0, 0, 1)` |
| Never animate | Timesheet grid cells, report table rows, running-timer digits |

Worth animating: timer start/stop state change, optimistic entry insertion, panel and drawer transitions, chart draw-in on first paint only, drag-to-create on the calendar, toast and undo affordances.

**`prefers-reduced-motion` must disable all non-essential motion.** Non-negotiable — this is an accessibility requirement, not a preference.

Suggested stack: Framer Motion for orchestration, CSS transitions for simple state, View Transitions API for route changes, virtualised lists (TanStack Virtual) so long report tables stay at 60fps.

### 8.4 Perceived speed beats animation

Time tracking lives or dies on responsiveness. Optimistic updates on every mutation, skeletons only past ~300 ms, aggressive caching of the project/task/client pickers, and full keyboard operation for the tracker. A snappy interface with restrained motion will feel better than a slower one with elaborate transitions.

---

## 9. Data & Ingestion

### Snapshot cadence
Fixed-window scoring requires history. Tapering schedule keeps quota low:

| Video age | Frequency |
|---|---|
| 0–48 h | Hourly |
| 2–30 days | Daily |
| > 30 days | Weekly |

### Quota
Data API v3: 10,000 units/day. `videos.list` = 1 unit and accepts **50 IDs per call**. 3,000 tracked videos refreshed daily ≈ 60 units. Quota is not a practical constraint for public metrics; batch aggressively regardless.

### 9.5 Platform connector registry

Platforms must never be a hardcoded enum or a `switch` in the scoring engine.
Each is a row in a registry declaring what it can actually provide:

```
platforms (
  slug,                    -- instagram | tiktok | youtube | facebook | ...
  display_name,
  auth_model,              -- none | oauth | oauth_with_app_review
  supports_public_read,    -- true only for youtube today
  view_semantics,          -- immediate | 3s | 30s | unclear  (see §5 Step 2)
  available_metrics,       -- ['views','likes','comments','shares','saves',...]
  scoring_config,          -- which metric drives each role on THIS platform
  maturity_window_days,    -- V7 on fast platforms, V28 where reach accrues slowly
  refresh_policy
)
```

`scoring_config` and `maturity_window_days` are what make "each platform scored
by its own policies" data rather than code. A platform whose reach builds over
weeks gets a longer window without touching the scoring engine.

Everything downstream reads from this:

- **Ingestion** picks a connector by slug; each implements one interface
  (`listPosts`, `fetchMetrics`, `refreshToken`).
- **The UI** shows only the metrics a platform actually reports, instead of
  rendering empty CTR columns for TikTok.
- **Scoring** stays untouched, because it consumes normalised `PerfIndex`
  values rather than raw platform fields.
- **Manual entry** is itself a connector (`auth_model: none`), so a
  hand-entered post flows through exactly the same pipeline as an API-synced
  one, distinguished only by `platform_posts.source`.

That last point matters more than it looks: it means the product works on day
one with zero integrations, and every platform that gets connected later
upgrades the data in place without a migration or a second code path.

**Adding a platform should be: write a connector, insert a registry row.**
If a new platform ever requires touching the scoring engine or the dashboards,
the abstraction has leaked and should be fixed rather than worked around.

### Reliability
- Ingestion is idempotent and resumable; store `last_synced_at` per video.
- Deleted/privated videos are soft-flagged, never hard-deleted (history must survive).
- OAuth refresh-token failures must alert, not silently degrade to stale data.

### Schema sketch

```
organizations                 -- the tenant; a company may run several
workspaces                    -- London / Dubai / partner brand, switchable
memberships                   -- (user, workspace, role, seat_type, is_active)
user_groups, user_group_members
clients, projects, tasks, tags
time_entries, time_entry_tags
rates, budgets, expenses, invoices, invoice_lines
approvals, time_off_policies, time_off_requests
custom_fields, custom_field_values, audit_log

-- Cross-posting is the norm: one video ships to Instagram and TikTok and
-- performs very differently on each. Content and post are separate entities,
-- or cross-posted work gets double-counted.
content_items      (client_id, title, subject, hook, length_seconds,
                    music_used, produced_at)
platforms          (slug, auth_model, view_semantics, available_metrics, ...)
                    -- registry, not an enum (§9.5)
accounts           (client_id, platform_slug, handle, connection_mode)
oauth_connections  (account_id, encrypted refresh token, scopes, status)
platform_posts     (content_item_id, account_id, platform_post_id, posted_at,
                    source: 'api' | 'manual')
post_snapshots     (platform_post_id, captured_at, views, likes, comments,
                    shares, saves)
post_analytics     (platform_post_id, date, reach, impressions, ctr,
                    avg_watch_seconds)              -- connected accounts only
content_assignments (content_item_id, user_id, role_id, source)
                    -- source: 'derived' from tracked time, or 'manual'
roles              (name, signal_config)
-- Scores are stored per platform. The overall is the mean of these rows, never
-- a separately-computed figure, so the breakdown can always be shown beside it.
platform_scores    (user_id, role_id, platform_slug, period, score, n, percentile)
time_entries.content_item_id                        -- the join
```

Every tenant-scoped table carries `org_id`.

---

## 9.6 Architecture Constraint — Supabase + Vercel only

**No separate backend service.** This is a deliberate constraint, held until
something concrete forces otherwise.

Current runtime dependencies, in full:

```
next  react  react-dom  @supabase/ssr  @supabase/supabase-js
```

That is the whole list. No ORM, no state-management library, no UI kit, no icon
package, no date library, no API server.

| Concern | Where it lives |
|---|---|
| UI + routing | Next.js App Router on Vercel |
| Server logic | Server Components and Server Actions — no separate API tier |
| Auth & sessions | Supabase Auth via `@supabase/ssr`, refreshed in `proxy.ts` |
| Authorisation | Postgres RLS, not application code |
| Database | Supabase Postgres, schema in `supabase/migrations` |
| Migrations | Supabase CLI over `--db-url` |

### How later phases stay inside this envelope

The phases most likely to tempt a backend, and how they avoid one:

- **Scheduled metric ingestion** → Vercel Cron hitting a Route Handler, or
  Supabase `pg_cron` for database-side work. Neither is a new service.
- **OAuth token storage/refresh** → Supabase Vault for encryption; refresh runs
  in the same scheduled handler.
- **Long-running imports** (CSV backfill, bulk sync) → chunked and
  resumable behind a Route Handler, so no job queue is required.
- **Score recomputation** → a Postgres function on a schedule; the maths in
  §5 is plain SQL-friendly arithmetic.
- **Webhooks from platforms** → Route Handlers.

### What would justify revisiting

Adopt something new only when one of these is actually observed, not
anticipated:

- Ingestion exceeding Vercel's function timeout even when chunked
- A genuine need for durable job retries with backoff across many connectors
- Real-time fan-out beyond what Supabase Realtime handles

Until then, extra infrastructure is cost and operational surface with no
corresponding benefit.

---

## 10. Security

The repository is **public** and the Supabase publishable key ships in the browser bundle. Row Level Security is therefore the *only* thing standing between tenants.

- **RLS enabled on every table, no exceptions.** A single table without it exposes all tenants.
- Policies keyed on `org_id` via the authenticated user's membership.
- Client-role users restricted to their own `client_id` subtree.
- **The service_role key must never reach the browser** — server-side routes only.
- **YouTube OAuth refresh tokens are the crown jewels.** Encrypted at rest (Supabase Vault), never returned to any client, never logged. A leak here exposes client analytics.
- Audit log for rate changes, role assignments, approvals, and score recomputation.
- Rotate the credentials already exposed during setup before any real data lands.

---

## 11. Proposed Phasing

Sequenced so the actual deliverable — the dashboard in §1.1 — lands as early
as the data it depends on allows, not last:

| Phase | Contents | Why here |
|---|---|---|
| **0 — Foundation** | Auth, orgs, memberships, RLS baseline, schema | Everything depends on tenancy being right |
| **1 — Core tracking** | Timer, entries, projects/tasks/clients/tags, timesheet, basic reports | Supporting module (§1); replaces the Excel sheet |
| **2 — Content layer (manual)** | Platform registry, accounts, content items, cross-post links, manual metric entry, content↔time join | Works with zero client cooperation; feeds §1.1 directly |
| **2.5 — Platform connectors** | Instagram and TikTok OAuth first (98% of output), then YouTube, then Facebook | Ordered by actual volume, not by API convenience |
| **3 — Scoring** | Baselines, PerfIndex, shrinkage, role tiers, boost detection | The maths behind every score §1.1 displays |
| **3.5 — The Dashboard (§1.1)** | Single filterable page: client/video/person views, 5-role credit panel, team/employee roster | **The primary deliverable.** Everything before this phase exists to feed it. |
| **4 — Billing** | Rates, budgets, expenses, invoicing, cost-per-1k-views | Revenue-facing; supporting-module scope |
| **5 — Client portal** | Client role, scoped dashboards, exports, shared links | External exposure — after RLS is battle-tested |
| **6 — Deep analytics** | Retention, CTR, reach and saves where each platform exposes them; per-role attribution | Gated on client authorisation and per-platform capability |
| **7 — Team ops** | Approvals, PTO, scheduling, permissions | Supporting-module scope; scales with headcount |
| **8 — Advanced** | Kiosk, GPS, SSO, audit, public API, integrations | Enterprise surface, supporting-module scope |

**Phase 3 has a cold-start problem:** scoring needs ~10 videos of history per
channel for a stable baseline, so freshly-onboarded clients see thin scores
for the first few weeks. This is disclosed, not solved by a bespoke
migration tool: a generic CSV upload (§6.6) is the backfill path if a client
wants to seed history faster, and it is the same size of effort as building
one Clockify-specific integration would have been, without the narrowness.

---

## 12. Success Metrics

- Excel tracker retired within 30 days of Phase 1.
- ≥90% of tracked videos have all 5 roles assigned.
- Time-entry capture within 5% of actual (spot-audited).
- ≥3 client channels OAuth-connected by end of Phase 6.
- Every client dashboard answers "what did we deliver for you" without manual prep.

---

## 13. Open Questions

**Resolved by the workspace screenshots:**
- Navigation, dashboard, report, and team layouts — captured in §7
- Multi-workspace is a real requirement, not hypothetical
- Time is already tracked per video via the description field (§7.5)

**Resolved by direct client feedback (this revision):**
- The dashboard in §1.1 is the primary deliverable, not the time-tracking module
- Clockify-specific integration is out of scope — CSV/manual entry covers backfill instead

**Resolved by the tracking sheet (§3.5):**
- Platform mix is Instagram/TikTok, not YouTube
- Role columns exist but have never been filled — no attribution history
- Content is cross-posted; all of it short-form
- The team reliably records views, likes, comments, subject, hook, and sentiment

**Blocking:**
1. **Will clients authorise Instagram/TikTok access?** For 98% of content there is no public fallback, so this single answer decides whether the product automates anything or remains structured manual entry.
2. **Do we derive roles from tracked time instead of asking for them?** Recommended: the spreadsheet columns have 0% compliance, while the same fact is already captured by time entries.
4. Requirements message was truncated mid-sentence — the final requirement is unknown.

**Needs decision:**
5. Scoring window per platform — V₇ or V₂₈? Now set per platform in the registry, but each needs a starting value based on how fast reach accrues there.
5a. **Overall score weighting** — unweighted mean across platforms (default, measures quality per platform) or weighted by post count (tracks volume)? See §5 Step 2.
6. Shorts vs. long-form: separate baselines? (Strongly recommended — YN8 SF and YN8 YT LF suggest the split already exists operationally, and the view scales are incomparable.)
7. Are the 5 roles fixed, or configurable per workspace? Current task vocabulary (Editing, Revisions, Admin) is narrower than the 5-role model — how do they reconcile?
8. Can one person hold multiple roles on one video? (Assumed yes.)
9. **Are scores visible to the people being scored, or managers only?** Affects UI and morale considerably. Recommend deciding before any UI is built.
10. FULL vs LIMITED seat tiers — what exactly does a LIMITED member lose access to?
11. Do the three workspaces share a user directory and clients, or stay fully isolated?

**Handling note:** the reference screenshots contain team names and email addresses. That PII is deliberately excluded from this document, which lives in a public repository. Keep it out of committed files, fixtures, and seed data.
