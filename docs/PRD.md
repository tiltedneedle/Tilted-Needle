# Tilted Needle — Product Requirements Document

**Module:** Time Tracking & YouTube Performance Attribution
**Status:** Draft v0.1 — pending client review
**Last updated:** 2026-07-27

---

## 1. Summary

An internal operations app that merges two things most agencies keep separate:

1. **A full Clockify-equivalent time tracker** — who worked on what, for how long, at what cost.
2. **A YouTube performance layer** — how the videos that work produced actually performed.

Joining these is the point. Clockify alone tells you effort. YouTube alone tells you outcome. Together they answer the questions an agency actually gets asked:

- Which editor's videos retain viewers best, per hour spent?
- What did we actually cost this client per 1,000 views delivered?
- Is our highest-paid scriptwriter producing above-baseline hooks?

A standalone Clockify clone is a commodity. **The join is the product.**

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

## 4. The Attribution Constraint (read before designing dashboards)

The brief asks to "check why a video is boosting" *without* connecting client accounts. **These two requirements are in direct conflict**, and the PRD resolves it explicitly rather than papering over it.

### What each data source provides

| Metric | Data API v3 (key only) | Analytics API (owner OAuth) |
|---|---|---|
| Views, likes, comments | ✅ | ✅ |
| Title, tags, duration, publish time | ✅ | ✅ |
| Impressions & **CTR** | ❌ | ✅ |
| **Audience retention curve** | ❌ | ✅ |
| Average view duration / watch time | ❌ | ✅ |
| Traffic sources, demographics | ❌ | ✅ |
| Subscribers gained, revenue | ❌ | ✅ |

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

- **Baseline (always):** Data API v3 for every tracked channel. No client cooperation needed.
- **Enhanced (per client):** one-time read-only OAuth (`yt-analytics.readonly`) unlocks CTR and retention for that channel.
- The UI must **visibly label** which mode each channel is in. Enhanced-mode scores and baseline-mode scores are never mixed in a single ranking table without a marker.

**Product consequence:** true per-role attribution is a feature of *connected* channels. For unconnected channels the app reports outcome, not contribution. This must be stated plainly to the client — it is the difference between a defensible internal metric and a number that quietly misjudges people's work.

---

## 5. Performance Scoring Model

Designing this properly matters, because these numbers will affect how people are evaluated. A naive "average views per person" is actively unfair for four reasons: channel size dominates, older videos accumulate more views, view distributions are extremely heavy-tailed, and one lucky video beats fifty solid ones.

### Step 1 — Fix the measurement window

Never compare lifetime views across videos of different ages. Snapshot every video and evaluate at a fixed maturity, default **V₇ = views at 7 days** (configurable; V₂₈ for slower niches).

This requires storing a **time series**, not a current value — see §7 ingestion.

### Step 2 — Normalize against the channel's own baseline

```
baseline_c = median(V₇) over the channel's previous 10 videos
PerfIndex  = V₇(video) / baseline_c
```

A video at 2.0 did twice its channel's typical numbers. This makes a 50k-view video on a small channel and a 5M-view video on a large one directly comparable.

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

### Step 6 — Role-specific signal (connected channels only)

| Role | Primary signal | Rationale |
|---|---|---|
| Idea guy | CTR vs. channel baseline | Concept and title drive the click |
| Thumbnail/Videographer | CTR + first-frame retention | Visual draw |
| Script guy | Retention at 30s / 60s | The hook is the script's job |
| Editor | Retention curve AUC, avg view duration | Sustained watch is the edit |
| QC | Dislike ratio, comment sentiment, re-upload rate | Defect prevention |

Each computed as its own `PerfIndex` against the channel baseline, then run through Steps 3–5 identically.

### Step 7 — Present as tiers, not decimals

Surface percentile bands within role (Top 10% / Above / At / Below baseline) plus a confidence indicator driven by `n`. **Do not display a precise-looking number derived from three videos.**

### Guardrails
- Minimum 3 videos before a person is ranked publicly at all.
- Show sample size beside every score, always.
- Never rank across different roles — editors compete only with editors.

---

## 6. Functional Scope

Client selected the **full Clockify surface**. Documented in full here; sequenced in §9.

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

### 6.6 YouTube Module
- Channel registration per client; OAuth connect flow with clear status
- Video catalogue with automatic sync
- **Role assignment: the 5 entities per video** (extensible — roles are data, not enum)
- Metric snapshots and time-series charts
- Per-person dashboard: assigned videos, aggregate views/likes, rank, trend
- Per-client dashboard: total delivered views, videos shipped, spend, cost-per-1k-views
- Boost detection: flag videos exceeding baseline by configurable threshold
- Excel importer for historical backfill *(blocked — see §11)*

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
VIDEO      Channels · Videos · Performance     ← new module
```

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

channels           (client_id, yt_channel_id, connection_mode)
oauth_connections  (channel_id, encrypted refresh token, scopes, status)
videos             (channel_id, yt_video_id, published_at, ...)
video_snapshots    (video_id, captured_at, views, likes, comments)     -- public
video_analytics    (video_id, date, impressions, ctr, avd, retention)  -- OAuth only
video_assignments  (video_id, user_id, role_id)                        -- the 5 entities
roles              (name, signal_config)
scores             (user_id, role_id, period, score, n, percentile)
time_entries.video_id                                                  -- the join
```

Every tenant-scoped table carries `org_id`.

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

Full Clockify + full YouTube attribution + full multi-tenancy is a multi-quarter build. Sequenced so something is usable early:

| Phase | Contents | Why here |
|---|---|---|
| **0 — Foundation** | Auth, orgs, memberships, RLS baseline, schema | Everything depends on tenancy being right |
| **1 — Core tracking** | Timer, entries, projects/tasks/clients/tags, timesheet, basic reports | Replaces the Excel sheet; earliest real value |
| **1.5 — Clockify migration** | Import existing entries via API; **fuzzy-match descriptions → video records**; reconcile projects/tasks/clients | Turns years of history into the backfill Phase 3 needs |
| **2 — YouTube ingest** | Channels, video sync, snapshots, public metrics, video↔time join | Unlocks the differentiator |
| **3 — Scoring** | Baselines, PerfIndex, shrinkage, role dashboards, boost detection | Needs Phase 2 history to be meaningful |
| **4 — Billing** | Rates, budgets, expenses, invoicing, cost-per-1k-views | Revenue-facing |
| **5 — Client portal** | Client role, scoped dashboards, exports, shared links | External exposure — after RLS is battle-tested |
| **6 — OAuth analytics** | Analytics API, CTR/retention, per-role attribution | Gated on client cooperation |
| **7 — Team ops** | Approvals, PTO, scheduling, permissions | Scales with headcount |
| **8 — Advanced** | Kiosk, GPS, SSO, audit, public API, integrations | Enterprise surface |

**Phase 3 has a cold-start problem:** scoring needs ~10 videos of history per channel for a stable baseline.

Phase 1.5 is the mitigation. Because time-entry descriptions already carry video titles (§7.5), the existing Clockify account is itself a backfill source — pulled via the Clockify API, matched to YouTube videos by title. Done well, meaningful rankings exist on launch day rather than two months later. Match confidence must be surfaced for human review; a silently wrong match misattributes someone's work.

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
- Existing Clockify data exists and should be migrated (Phase 1.5)
- Time is already tracked per video via the description field (§7.5)

**Blocking:**
1. **Excel sheet still not provided.** Partially superseded by the screenshots, but needed if it holds fields Clockify does not (view counts, role assignments, ratings).
2. **Clockify API access** — an API key is required for Phase 1.5 migration. Confirm the plan tier permits export.
3. Will clients realistically grant read-only OAuth? Determines whether §5 Step 6 ever ships.
4. Requirements message was truncated mid-sentence — the final requirement is unknown.

**Needs decision:**
5. Scoring window — V₇ or V₂₈? Depends on typical view velocity per niche.
6. Shorts vs. long-form: separate baselines? (Strongly recommended — YN8 SF and YN8 YT LF suggest the split already exists operationally, and the view scales are incomparable.)
7. Are the 5 roles fixed, or configurable per workspace? Current task vocabulary (Editing, Revisions, Admin) is narrower than the 5-role model — how do they reconcile?
8. Can one person hold multiple roles on one video? (Assumed yes.)
9. **Are scores visible to the people being scored, or managers only?** Affects UI and morale considerably. Recommend deciding before any UI is built.
10. FULL vs LIMITED seat tiers — what exactly does a LIMITED member lose access to?
11. Do the three workspaces share a user directory and clients, or stay fully isolated?

**Handling note:** the reference screenshots contain team names and email addresses. That PII is deliberately excluded from this document, which lives in a public repository. Keep it out of committed files, fixtures, and seed data.
